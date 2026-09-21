// ------------------------------------------------------------------
// Sprints 1-3 · Service worker (módulo ES). Orquesta el flujo
// popup → service worker → content script:
//   Sprint 1: extracción de la paleta con respaldo de captura.
//   Sprint 2: aplicar/retirar la simulación en vivo.
//   Sprint 3: evaluación completa (extracción + contraste WCAG en la
//   página + distinguibilidad con la paleta simulada), resultado
//   persistido en chrome.storage.session para el panel lateral, e
//   insignia numérica en el icono con los pares que incumplen.
// ------------------------------------------------------------------

import { extractFromCapture } from "../core/extraccion/captura.js";
import { mergePalettes } from "../core/extraccion/consolidacion.js";
import {
  computeDistinguishability,
  simulateForConfig,
  DEFAULT_CONFUSION_THRESHOLD
} from "../core/evaluacion/distinguibilidad.js";
import { rgbToHex } from "../core/color/conversion.js";

// Protocolos donde una extensión no puede inyectar código.
const RESTRICTED_PROTOCOLS = ["chrome:", "chrome-extension:", "edge:", "about:", "devtools:", "view-source:"];
const RESTRICTED_HOSTS = ["chromewebstore.google.com"];

// Color de fondo de la insignia (token --error de la paleta del proyecto).
const BADGE_BACKGROUND = "#965860";

// Máximo de colores de serie que entran en la matriz de distinguibilidad.
const MAX_SERIES_COLORS = 20;

/** ¿Es una página interna del navegador o la tienda de extensiones? */
function isRestrictedUrl(url) {
  try {
    const parsed = new URL(url);
    return RESTRICTED_PROTOCOLS.includes(parsed.protocol) || RESTRICTED_HOSTS.includes(parsed.hostname);
  } catch (error) {
    return true;
  }
}

/** Devuelve la pestaña activa o un objeto de error listo para responder. */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { error: { ok: false, error: "no-active-tab" } };
  }
  // Sin permiso "tabs", la URL solo es visible si activeTab fue concedido
  // para esa pestaña (clic en el icono). URL ausente = aún sin acceso; no
  // confundirlo con una página interna del navegador.
  if (typeof tab.url !== "string" || tab.url === "") {
    return { error: { ok: false, error: "no-access" } };
  }
  if (isRestrictedUrl(tab.url || "")) {
    // Se incluye la URL para que la interfaz pueda decir QUÉ pestaña
    // rechazó (caso típico: chrome://extensions tras recargar la extensión).
    return { error: { ok: false, error: "unsupported-page", url: tab.url || "" } };
  }
  return { tab };
}

/**
 * Envía un mensaje al content script. Si el envío falla porque aún no está
 * inyectado ("Receiving end does not exist"), lo inyecta y reintenta.
 */
async function forwardToContent(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (firstError) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content/content-script.js"]
    });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

/** Respuesta uniforme cuando la inyección es imposible. */
function injectionFailure(tab, error) {
  return {
    ok: false,
    error: "injection-failed",
    // El caso típico en el banco de pruebas: archivos file:// sin el
    // permiso "Permitir acceso a URL de archivo" activado.
    isFileUrl: (tab.url || "").startsWith("file:"),
    detail: String(error)
  };
}

/** Nivel 3 (captura): completa la respuesta cuando el nivel 2 no bastó. */
async function extendWithCapture(response, tab) {
  if (!(response && response.ok && response.needsCapture)) return response;
  try {
    const capture = await extractFromCapture(tab.windowId);
    response.palette = mergePalettes(response.palette, capture.entries, "capture");
    response.levels = [...response.levels, "capture"];
    response.approximate = true;
  } catch (captureError) {
    // La captura es un respaldo: si falla se informa sin invalidar el resto.
    response.captureError = String(captureError);
  }
  return response;
}

/** Configuración de simulación persistida por el popup (sprint 2). */
async function loadSimulationConfig() {
  try {
    const stored = await chrome.storage.local.get(["simulationType", "simulationSeverity"]);
    return {
      type: typeof stored.simulationType === "string" ? stored.simulationType : "none",
      severity: typeof stored.simulationSeverity === "number" ? stored.simulationSeverity : 1
    };
  } catch (error) {
    return { type: "none", severity: 1 };
  }
}

/** Flujo de extracción del sprint 1 (lo sigue usando EXTRACT_PALETTE). */
async function handleExtraction() {
  const { tab, error } = await getActiveTab();
  if (error) return error;
  let response;
  try {
    response = await forwardToContent(tab.id, { type: "EXTRACT_PALETTE" });
  } catch (injectionError) {
    return injectionFailure(tab, injectionError);
  }
  return extendWithCapture(response, tab);
}

/**
 * Evaluación completa del sprint 3: extracción + contraste (en la página,
 * colores declarados) + distinguibilidad (aquí, paleta simulada con la
 * configuración vigente del usuario y el método exacto del sprint 2).
 * El resultado se guarda por pestaña para que lo lea el panel lateral.
 */
async function handleFullEvaluation() {
  const { tab, error } = await getActiveTab();
  if (error) return error;

  let response;
  try {
    response = await forwardToContent(tab.id, { type: "RUN_EVALUATION" });
  } catch (injectionError) {
    return injectionFailure(tab, injectionError);
  }
  if (!response || !response.ok) return response;
  response = await extendWithCapture(response, tab);

  // Distinguibilidad sobre los colores de serie, simulados con la
  // configuración seleccionada. Se calcula también la matriz de los
  // colores originales para poder distinguir "confundible solo bajo
  // simulación" de "confundible siempre".
  const simulationConfig = await loadSimulationConfig();
  const seriesColors = (response.palette || [])
    .filter((color) => color.roles.includes("series"))
    .slice(0, MAX_SERIES_COLORS);
  const simulatedRgbs = seriesColors.map((color) => simulateForConfig(color.rgb, simulationConfig));

  const distinguishability = {
    config: simulationConfig,
    threshold: DEFAULT_CONFUSION_THRESHOLD,
    colors: seriesColors.map((color, index) => ({
      hex: color.hex,
      rgb: color.rgb,
      simulatedHex: rgbToHex(simulatedRgbs[index]),
      simulatedRgb: simulatedRgbs[index]
    })),
    simulated: computeDistinguishability(simulatedRgbs, { threshold: DEFAULT_CONFUSION_THRESHOLD }),
    original: computeDistinguishability(seriesColors.map((color) => color.rgb), {
      threshold: DEFAULT_CONFUSION_THRESHOLD
    })
  };

  const contrast = response.contrast || { text: [], graphics: [] };
  const failingContrast =
    contrast.text.filter((group) => !group.passes).length +
    contrast.graphics.filter((group) => !group.passes).length;
  const badgeCount = failingContrast + distinguishability.simulated.conflicts.length;

  // Insignia numérica por pestaña: pares que incumplen.
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND, tabId: tab.id });
  await chrome.action.setBadgeText({ text: String(badgeCount), tabId: tab.id });

  const payload = {
    ...response,
    approximate: response.approximate === true,
    distinguishability,
    badgeCount,
    evaluatedAt: Date.now()
  };
  await chrome.storage.session.set({ ["evaluation:" + tab.id]: payload });
  return payload;
}

/** Reenvía al content script las órdenes de simulación del sprint 2. */
async function handleSimulationMessage(message) {
  const { tab, error } = await getActiveTab();
  if (error) return error;
  try {
    return await forwardToContent(tab.id, message);
  } catch (injectionError) {
    return injectionFailure(tab, injectionError);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "EXTRACT_PALETTE") {
    handleExtraction()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "unexpected", detail: String(error) }));
    return true; // respuesta asíncrona
  }
  if (message && message.type === "RUN_EVALUATION") {
    handleFullEvaluation()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "unexpected", detail: String(error) }));
    return true;
  }
  if (
    message &&
    (message.type === "APPLY_SIMULATION" ||
      message.type === "CLEAR_SIMULATION" ||
      message.type === "PREVIEW_PALETTE" ||
      message.type === "CLEAR_PREVIEW")
  ) {
    handleSimulationMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "unexpected", detail: String(error) }));
    return true;
  }
  return false;
});

// Ajuste de UX (post-Sprint 3): el clic en el icono abre directamente el
// panel lateral, que concentra controles, extracción y resultados en una
// sola superficie; el popup queda como página auxiliar mínima.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// La insignia se limpia al cambiar de pestaña…
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
});

// …y al recargar o navegar, junto con la evaluación guardada de esa pestaña.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
    chrome.storage.session.remove("evaluation:" + tabId).catch(() => {});
  }
});

// ------------------------------------------------------------------
// Service worker (módulo ES). Orquesta el flujo panel → service worker
// → content script: habilita el panel lateral por pestaña, inyecta el
// content script bajo demanda, completa la extracción con la captura
// (RF01), reenvía simulación y previsualización (RF02, RF03, RF07) y
// calcula la distinguibilidad de la paleta simulada (RF05).
// Sprints 1 a 3; panel por pestaña desde la versión 0.6.0.
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

// Color de fondo de la insignia (token --error del tema claro).
const BADGE_BACKGROUND = "#7F2B00";

// Máximo de colores de serie que entran en la matriz de distinguibilidad.
const MAX_SERIES_COLORS = 20;

const PANEL_PATH = "src/ui/panel/panel.html";

// ------------------------------------------------------------------
// Panel lateral por pestaña. El manifest declara la ruta, pero el panel
// nace deshabilitado para todas las pestañas; el clic en el icono lo
// habilita y lo abre solo para la pestaña pulsada. No hay popup:
// action.onClicked no se dispara si hay default_popup declarado.
// ------------------------------------------------------------------

/** Deshabilita el panel como opción global (estado de partida). */
function disablePanelGlobally() {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(disablePanelGlobally);
chrome.runtime.onStartup.addListener(disablePanelGlobally);

chrome.action.onClicked.addListener((tab) => {
  if (!tab || !tab.id) return;
  try {
    // Habilitar y abrir dentro del mismo gesto del clic, sin await entre
    // ambas llamadas: sidePanel.open exige un gesto de usuario y esperar
    // a setOptions lo consumía cuando el service worker arrancaba en frío
    // (el primer clic tras recargar no abría). El navegador procesa las
    // dos llamadas en orden, así que el panel ya está habilitado al abrir.
    chrome.sidePanel.setOptions({ tabId: tab.id, path: PANEL_PATH, enabled: true }).catch(() => {});
    chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  } catch (error) {
    // Sin sidePanel disponible no hay superficie alternativa: se ignora.
  }
});

/** ¿Es una página interna del navegador o la tienda de extensiones? */
function isRestrictedUrl(url) {
  try {
    const parsed = new URL(url);
    return RESTRICTED_PROTOCOLS.includes(parsed.protocol) || RESTRICTED_HOSTS.includes(parsed.hostname);
  } catch (error) {
    return true;
  }
}

/**
 * Resuelve la pestaña sobre la que actuar. Los mensajes del panel traen
 * su tabId (cada panel está ligado a su pestaña); sin él se usa la
 * pestaña activa de la ventana enfocada. Devuelve { tab } o { error }
 * con la respuesta de error ya construida.
 */
async function resolveTab(message) {
  let tab = null;
  if (message && typeof message.tabId === "number") {
    try {
      tab = await chrome.tabs.get(message.tabId);
    } catch (error) {
      tab = null;
    }
  }
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  if (!tab || !tab.id) {
    return { error: { ok: false, error: "no-active-tab" } };
  }
  // Sin permiso "tabs", la URL solo es visible con acceso de host a la
  // pestaña. URL ausente = aún sin acceso; no confundirlo con una
  // página interna del navegador.
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

/** Simulación guardada para la pestaña (sim:<tabId>); sin ella, ninguna. */
async function loadSimulationConfig(tabId) {
  try {
    const stored = await chrome.storage.session.get("sim:" + tabId);
    const sim = stored["sim:" + tabId];
    return {
      type: sim && typeof sim.type === "string" ? sim.type : "none",
      severity: sim && typeof sim.severity === "number" ? sim.severity : 1
    };
  } catch (error) {
    return { type: "none", severity: 1 };
  }
}

/**
 * Evaluación completa: extracción (RF01) + contraste WCAG calculado en
 * la página sobre los colores declarados (RF04) + distinguibilidad
 * calculada aquí con la paleta simulada según la configuración de la
 * pestaña (RF05). Devuelve la carga completa y la guarda por pestaña
 * para que la lea el panel lateral.
 */
async function handleFullEvaluation(message) {
  const { tab, error } = await resolveTab(message);
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
  // configuración de esta pestaña. Se calcula también la matriz de los
  // colores originales para poder distinguir "confundible solo bajo
  // simulación" de "confundible siempre".
  const simulationConfig = await loadSimulationConfig(tab.id);
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
    // Dirección y título del dashboard evaluado, para el reporte (RF08).
    url: tab.url || "",
    title: tab.title || "",
    approximate: response.approximate === true,
    distinguishability,
    badgeCount,
    evaluatedAt: Date.now()
  };
  await chrome.storage.session.set({ ["evaluation:" + tab.id]: payload });
  return payload;
}

/** Reenvía al content script las órdenes de simulación y previsualización. */
async function handleSimulationMessage(message) {
  const { tab, error } = await resolveTab(message);
  if (error) return error;
  try {
    return await forwardToContent(tab.id, message);
  } catch (injectionError) {
    return injectionFailure(tab, injectionError);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "GET_PAGE_STATE") {
    // Consulta de estado sin inyección de respaldo: si el content script
    // no existe (página recargada o nunca evaluada), la página no puede
    // tener estilos inyectados y se responde el estado vacío.
    (async () => {
      const { tab, error } = await resolveTab(message);
      if (error) return { ok: true, filter: { active: false, config: null }, previewActive: false, unreachable: true };
      try {
        return await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_STATE" });
      } catch (sendError) {
        return { ok: true, filter: { active: false, config: null }, previewActive: false, unreachable: true };
      }
    })()
      .then(sendResponse)
      .catch(() => sendResponse({ ok: true, filter: { active: false, config: null }, previewActive: false }));
    return true;
  }
  if (message && message.type === "RUN_EVALUATION") {
    handleFullEvaluation(message)
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

// La insignia se limpia al cambiar de pestaña…
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
});

// …y al recargar o navegar, junto con la evaluación, la simulación y el
// estado de interfaz guardados de esa pestaña. El panel sigue habilitado
// para la pestaña (opción por pestaña intacta): navegar no lo cierra,
// solo descarta lo evaluado, porque la página nueva ya no lo es.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});
    chrome.storage.session
      .remove(["evaluation:" + tabId, "ui:" + tabId, "sim:" + tabId])
      .catch(() => {});
  }
});

// Al cerrar la pestaña se descarta todo su estado guardado;
// la opción del panel de esa pestaña muere con ella.
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session
    .remove(["evaluation:" + tabId, "ui:" + tabId, "sim:" + tabId])
    .catch(() => {});
});

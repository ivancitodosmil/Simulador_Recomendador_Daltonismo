// ------------------------------------------------------------------
// Service worker (módulo ES). Orquesta el flujo panel → service worker
// → content script: habilita el panel lateral por pestaña, inyecta el
// content script en todos los marcos, suspende los efectos visuales
// mientras se lee la página, fusiona la extracción de cada marco y la
// completa con la captura recortada (RF01), decide entre filtro CSS y
// simulación por captura y reenvía simulación y previsualización (RF02,
// RF03, RF07), calcula la distinguibilidad de la paleta simulada (RF05)
// y restablece la pestaña a «Ninguna» cuando la página cambia. Sprints
// 1 a 3; panel por pestaña desde 0.6.0; marcos, captura recortada,
// simulación por captura y cambio de página desde 1.0.0.
// ------------------------------------------------------------------

import { extractFromCapture } from "../core/extraccion/captura.js";
import { mergePalettes, mergeFramePalettes, countRecolorable } from "../core/extraccion/consolidacion.js";
import { composeFrames, captureRegions } from "../core/extraccion/marcos.js";
import { mergeContrastResults, addApproximateSeriesContrast } from "../core/evaluacion/contraste-wcag.js";
import {
  computeDistinguishability,
  simulateForConfig,
  DEFAULT_CONFUSION_THRESHOLD
} from "../core/evaluacion/distinguibilidad.js";
import { rgbToHex } from "../core/color/conversion.js";
import { decideSimulationMode, isNearlyUniform } from "../core/simulacion/imagen.js";

// Protocolos donde una extensión no puede inyectar código.
const RESTRICTED_PROTOCOLS = ["chrome:", "chrome-extension:", "edge:", "about:", "devtools:", "view-source:"];
const RESTRICTED_HOSTS = ["chromewebstore.google.com"];

// Color de fondo de la insignia (token --error del tema claro).
const BADGE_BACKGROUND = "#7F2B00";

// Máximo de colores de serie que entran en la matriz de distinguibilidad.
const MAX_SERIES_COLORS = 20;

// Croma C*ab mínimo para que un color de serie cuente como color de datos.
const DATA_CHROMA_MIN = 6;

// Tiempo que se deja pintar el filtro antes de comprobar si dejó la página en blanco.
const FILTER_SETTLE_MS = 600;

// Dos avisos de navegación del mismo cambio (onCommitted y onUpdated) se
// tratan como uno si llegan en este margen.
const NAVIGATION_DEBOUNCE_MS = 300;

const PANEL_PATH = "src/ui/panel/panel.html";
const CONTENT_SCRIPT = "src/content/content-script.js";

// Marcos inyectados en cada pestaña en la última evaluación o simulación:
// permite consultar el estado de la página sin volver a inyectar. Es
// memoria del service worker: si se reinicia, se consulta el marco superior.
const frameIdsByTab = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    // Se incluye la URL para que la interfaz pueda decir qué pestaña
    // rechazó (caso típico: chrome://extensions tras recargar la extensión).
    return { error: { ok: false, error: "unsupported-page", url: tab.url || "" } };
  }
  return { tab };
}

/**
 * Inyecta el content script en todos los marcos de la pestaña (el guard
 * del script evita duplicar listeners) y devuelve sus frameId. Los marcos
 * sin acceso (sandbox sin scripts, otro origen sin permiso) no aparecen:
 * el nivel 3 los captura recortados. Si la inyección en todos los marcos
 * falla, se intenta al menos en el superior; si tampoco, lanza el error.
 */
async function injectAllFrames(tabId) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: [CONTENT_SCRIPT] });
  } catch (error) {
    results = await chrome.scripting.executeScript({ target: { tabId }, files: [CONTENT_SCRIPT] });
  }
  const frameIds = [];
  for (const result of results || []) {
    if (typeof result.frameId === "number" && !frameIds.includes(result.frameId)) frameIds.push(result.frameId);
  }
  if (!frameIds.includes(0)) frameIds.unshift(0);
  frameIdsByTab.set(tabId, frameIds);
  return frameIds;
}

/** Envía un mensaje a un marco concreto (rechaza si no responde). */
function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}

/** Envía un mensaje a cada marco y recoge su respuesta (null si no responde). */
async function sendToFrames(tabId, frameIds, message) {
  return Promise.all(
    frameIds.map(async (frameId) => {
      try {
        return { frameId, response: await sendToFrame(tabId, frameId, message) };
      } catch (error) {
        return { frameId, response: null };
      }
    })
  );
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

// ------------------------------------------------------------------
// Capturas. captureVisibleTab admite dos llamadas por segundo; todas las
// capturas pasan por aquí para respetar esa cuota esperando si hace falta.
// ------------------------------------------------------------------
const captureTimes = [];

async function captureTab(windowId) {
  const now = Date.now();
  while (captureTimes.length && now - captureTimes[0] > 1000) captureTimes.shift();
  if (captureTimes.length >= 2) await delay(1000 - (now - captureTimes[0]) + 50);
  captureTimes.push(Date.now());
  if (captureTimes.length > 2) captureTimes.shift();
  return chrome.tabs.captureVisibleTab(windowId, { format: "png" });
}

/** Captura reducida (64×36) para comprobar si la página quedó uniforme. */
async function captureThumbnail(windowId) {
  const dataUrl = await captureTab(windowId);
  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const canvas = new OffscreenCanvas(64, 36);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, 64, 36);
  bitmap.close();
  return context.getImageData(0, 0, 64, 36);
}

/** ¿Hay algún color de serie cromático dentro de una zona de gráficos? */
function hasChromaticDataColors(palette) {
  return palette.some(
    (color) =>
      color.roles.includes("series") &&
      color.inCharts === true &&
      color.lab &&
      Math.hypot(color.lab.a, color.lab.b) >= DATA_CHROMA_MIN
  );
}

/** Suma de una métrica de stats en todos los marcos. */
function sumStat(responses, key) {
  return responses.reduce((sum, response) => sum + ((response.stats && response.stats[key]) || 0), 0);
}

/**
 * Evaluación completa: con los efectos visuales suspendidos en todos los
 * marcos, cada marco extrae su paleta (RF01) y su contraste WCAG sobre
 * los colores declarados (RF04); el service worker compone las zonas,
 * captura recortadas las que ningún marco pudo leer, fusiona paletas y
 * contrastes y calcula la distinguibilidad con la paleta simulada según
 * la configuración de la pestaña (RF05). Devuelve la carga completa y la
 * guarda por pestaña para que la lea el panel lateral.
 */
async function handleFullEvaluation(message) {
  const { tab, error } = await resolveTab(message);
  if (error) return error;

  let frameIds;
  try {
    frameIds = await injectAllFrames(tab.id);
  } catch (injectionError) {
    return injectionFailure(tab, injectionError);
  }

  const startedAt = Date.now();
  let payload;
  try {
    // Cada marco confirma que retiró filtro, capa y previsualización
    // (también los restos marcados por otra instancia) antes de leer.
    const suspended = await sendToFrames(tab.id, frameIds, { type: "SUSPEND_VISUALS" });
    const stalePreviewRestored = suspended.reduce(
      (sum, result) => sum + ((result.response && result.response.staleRestored) || 0),
      0
    );
    const results = await sendToFrames(tab.id, frameIds, { type: "RUN_EVALUATION" });
    const top = results.find((result) => result.frameId === 0);
    if (!top || !top.response) {
      return { ok: false, error: "extraction-failed", detail: "El marco principal no respondió." };
    }
    if (!top.response.ok) return top.response;

    const responses = results.filter((result) => result.response && result.response.ok).map((result) => result.response);
    const composition = composeFrames(results);
    let palette = mergeFramePalettes(
      responses.map((response) => ({ palette: response.palette, domObservations: response.domObservations }))
    );
    let contrast = mergeContrastResults(responses.map((response) => response.contrast));
    const levels = [];
    for (const level of ["dom-svg", "canvas"]) {
      if (responses.some((response) => (response.levels || []).includes(level))) levels.push(level);
    }

    // Nivel 3 solo donde hace falta: iframes sin inyectar, canvas
    // ilegibles o zonas de gráficos e imágenes sin ningún color cromático
    // de datos.
    const regions = captureRegions(composition, {
      hasChromaticData: hasChromaticDataColors(palette),
      paletteEmpty: palette.length === 0
    });
    let approximate = false;
    let captureError;
    let captureBackground = null;
    if (regions.length) {
      try {
        const capture = await extractFromCapture(tab.windowId, regions, composition.viewport, captureTab);
        if (capture.entries.length) {
          palette = mergePalettes(palette, capture.entries, "capture");
          levels.push("capture");
          approximate = true;
          // Acromático dominante del recorte: fondo contra el que se
          // aproxima el contraste de las series capturadas.
          const dominant = capture.entries.find((entry) => entry.role === "background");
          if (dominant) captureBackground = { hex: rgbToHex(dominant.rgb), rgb: dominant.rgb };
        }
      } catch (captureFailure) {
        // La captura es un respaldo: si falla se informa sin invalidar el resto.
        captureError = String(captureFailure);
      }
    }

    // Las series sin par propio (canvas o captura, sin elemento) reciben un
    // par 1.4.11 aproximado contra el fondo dominante de su zona o el de la
    // página: ninguna serie queda sin contraste evaluado.
    contrast = addApproximateSeriesContrast(palette, contrast, {
      pageBackground: top.response.pageBackground || null,
      canvasBackground: (responses.find((response) => response.canvasBackground) || {}).canvasBackground || null,
      captureBackground
    });

    // Distinguibilidad sobre los colores de serie, simulados con la
    // configuración de esta pestaña. Se calcula también la matriz de los
    // colores originales para poder distinguir "confundible solo bajo
    // simulación" de "confundible siempre".
    const simulationConfig = await loadSimulationConfig(tab.id);
    const seriesColors = palette.filter((color) => color.roles.includes("series")).slice(0, MAX_SERIES_COLORS);
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

    const failingContrast =
      contrast.text.filter((group) => !group.passes).length +
      contrast.graphics.filter((group) => !group.passes).length;
    const badgeCount = failingContrast + distinguishability.simulated.conflicts.length;

    // Insignia numérica por pestaña: pares que incumplen.
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND, tabId: tab.id });
    await chrome.action.setBadgeText({ text: String(badgeCount), tabId: tab.id });

    payload = {
      ok: true,
      palette,
      contrast,
      levels,
      approximate,
      captureError,
      // Elementos recoloreables por color, sumados en todos los marcos: si
      // las series consideradas no tienen ninguno, la previsualización no
      // está disponible.
      recolorable: countRecolorable(palette, responses.map((response) => response.registryCounts || {})),
      // Dirección y título del dashboard evaluado, para el reporte (RF08).
      url: tab.url || "",
      title: tab.title || "",
      stats: {
        frames: responses.length,
        framesTotal: frameIds.length,
        iframesNotInjected: composition.iframeZones.filter((zone) => !zone.injected).length,
        chartZones: composition.chartZones.length,
        // Gráficos con marcas, zonas vacías e imágenes grandes, sumados en
        // todos los marcos: el panel distingue «sin gráficos», «gráficos
        // sin datos» y «sin colores de datos».
        zoneSummary: ["marked", "empty", "images"].reduce((summary, key) => {
          summary[key] = responses.reduce((sum, response) => sum + ((response.zoneSummary && response.zoneSummary[key]) || 0), 0);
          return summary;
        }, {}),
        captureRegions: regions.length,
        nodesVisited: sumStat(responses, "nodesVisited"),
        truncated: responses.some((response) => response.stats && response.stats.truncated === true),
        containerTag: top.response.stats ? top.response.stats.containerTag : "body",
        domObservations: sumStat(responses, "domObservations"),
        canvasTotal: sumStat(responses, "canvasTotal"),
        canvasFailed: sumStat(responses, "canvasFailed"),
        stalePreviewRestored: stalePreviewRestored + sumStat(responses, "stalePreviewRestored")
      },
      elapsedMs: Date.now() - startedAt,
      distinguishability,
      badgeCount,
      evaluatedAt: Date.now()
    };
  } finally {
    // Pase lo que pase, la página recupera su filtro, su capa y su previsualización.
    await sendToFrames(tab.id, frameIds, { type: "RESTORE_VISUALS" });
  }
  await chrome.storage.session.set({ ["evaluation:" + tab.id]: payload });
  return payload;
}

// ------------------------------------------------------------------
// Simulación. El filtro CSS va solo al marco superior: su contenedor
// engloba los iframes y un filtro CSS también transforma su contenido,
// así que aplicarlo dentro los simularía dos veces. Cuando el filtro no
// puede actuar (documento de imagen, imagen grande, canvas WebGL como
// Figma, o página que queda en blanco al filtrar) se simula por captura:
// se captura la pestaña con la capa oculta y el content script muestra
// la captura simulada píxel a píxel en una capa fija.
// ------------------------------------------------------------------

/** Captura la pestaña (con la capa oculta) y la muestra simulada. */
async function startCaptureSimulation(tab, config) {
  await sendToFrame(tab.id, 0, { type: "HIDE_OVERLAY" }).catch(() => null);
  const dataUrl = await captureTab(tab.windowId);
  const shown = await sendToFrame(tab.id, 0, { type: "SHOW_SIMULATED_OVERLAY", dataUrl, config });
  return shown && shown.ok ? { ok: true, mode: "capture" } : { ok: false, error: "overlay-failed" };
}

/** Decide filtro o captura, aplica y comprueba que la página no quedó en blanco. */
async function applySimulation(tab, message) {
  const config = message.config;
  const state = await sendToFrame(tab.id, 0, { type: "GET_PAGE_STATE" }).catch(() => null);
  const current = state && state.filter ? state.filter : { active: false, mode: "filter" };

  // Ya en modo captura: solo cambia la severidad, sin volver a capturar.
  if (current.active && current.mode === "capture") {
    const updated = await sendToFrame(tab.id, 0, { type: "UPDATE_SIMULATED_OVERLAY", config }).catch(() => null);
    if (updated && updated.ok) return { ok: true, mode: "capture" };
  }

  const profile = await sendToFrame(tab.id, 0, { type: "PAGE_PROFILE" }).catch(() => null);
  if (decideSimulationMode(profile) === "capture") {
    await sendToFrame(tab.id, 0, { type: "CLEAR_SIMULATION" }).catch(() => null);
    return startCaptureSimulation(tab, config);
  }

  // Filtro CSS. En la primera aplicación, si hay canvas o iframes, se
  // compara una captura reducida antes y después: una página que no era
  // uniforme y queda uniforme es una página en blanco por el filtro.
  const needsCheck = !current.active && profile && profile.ok && (profile.canvasCount > 0 || profile.iframeCount > 0);
  let before = null;
  if (needsCheck) {
    try {
      before = await captureThumbnail(tab.windowId);
    } catch (error) {
      before = null;
    }
  }
  const applied = await sendToFrame(tab.id, 0, message);
  if (!(applied && applied.ok)) return applied;
  if (before && !isNearlyUniform(before)) {
    await delay(FILTER_SETTLE_MS);
    try {
      const after = await captureThumbnail(tab.windowId);
      if (isNearlyUniform(after)) {
        await sendToFrame(tab.id, 0, { type: "CLEAR_SIMULATION" }).catch(() => null);
        return startCaptureSimulation(tab, config);
      }
    } catch (error) {
      // Sin captura no se puede comprobar: se mantiene el filtro.
    }
  }
  return { ...applied, mode: "filter" };
}

/**
 * Reenvía las órdenes de simulación y previsualización. La previsualización
 * va a todos los marcos, porque cada uno recolorea los elementos de su
 * propio registro.
 */
async function handleSimulationMessage(message) {
  const { tab, error } = await resolveTab(message);
  if (error) return error;
  let frameIds;
  try {
    frameIds = await injectAllFrames(tab.id);
  } catch (injectionError) {
    return injectionFailure(tab, injectionError);
  }

  if (message.type === "APPLY_SIMULATION") {
    try {
      return await applySimulation(tab, message);
    } catch (sendError) {
      return injectionFailure(tab, sendError);
    }
  }
  if (message.type === "CLEAR_SIMULATION") {
    try {
      return await sendToFrame(tab.id, 0, message);
    } catch (sendError) {
      return injectionFailure(tab, sendError);
    }
  }

  const results = await sendToFrames(tab.id, frameIds, message);
  const responses = results.map((result) => result.response).filter(Boolean);
  if (message.type === "CLEAR_PREVIEW") {
    return { ok: true, restored: responses.reduce((sum, response) => sum + (response.restored || 0), 0) };
  }
  // PREVIEW_PALETTE: un color cuenta como «sin elementos» solo si ningún
  // marco lo recoloreó (los de canvas, por ejemplo).
  const applied = responses.filter((response) => response.ok);
  if (!applied.length) {
    const noRegistry = responses.some((response) => response.error === "no-registry");
    return { ok: false, error: noRegistry ? "no-registry" : "preview-failed" };
  }
  const recoloredHexes = new Set();
  let recolored = 0;
  for (const response of applied) {
    recolored += response.recolored || 0;
    for (const hex of response.recoloredHexes || []) recoloredHexes.add(hex);
  }
  return { ok: true, recolored, entriesWithoutElements: (message.mapping || []).length - recoloredHexes.size };
}

/**
 * Estado real de la página sin inyección de respaldo: si el content script
 * no existe (página recargada o nunca evaluada), la página no puede tener
 * estilos inyectados y se responde el estado vacío. El filtro lo informa
 * el marco superior; la previsualización, cualquier marco conocido.
 */
async function handlePageState(message) {
  const empty = { ok: true, filter: { active: false, config: null, mode: "filter" }, previewActive: false, unreachable: true };
  const { tab, error } = await resolveTab(message);
  if (error) return empty;
  const frameIds = frameIdsByTab.get(tab.id) || [0];
  const results = await sendToFrames(tab.id, frameIds, { type: "GET_PAGE_STATE" });
  const top = results.find((result) => result.frameId === 0);
  if (!top || !top.response) return empty;
  return {
    ok: true,
    filter: top.response.filter || { active: false, config: null, mode: "filter" },
    previewActive: results.some((result) => result.response && result.response.previewActive === true)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "GET_PAGE_STATE") {
    handlePageState(message)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: true, filter: { active: false, config: null, mode: "filter" }, previewActive: false }));
    return true;
  }
  if (message && message.type === "RECAPTURE_SIMULATION" && sender && sender.tab) {
    // La capa por captura pide una captura nueva tras un cambio de vista.
    captureTab(sender.tab.windowId)
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((error) => sendResponse({ ok: false, error: "capture-failed", detail: String(error) }));
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

// ------------------------------------------------------------------
// Cambio de página en la pestaña: carga nueva (onCommitted del marco
// principal u onUpdated en «loading») o cambio de ruta sin recarga
// (pushState, replaceState, cambio de fragmento). Lo que se veía ya no
// es lo evaluado: la simulación vuelve a «Ninguna», se retiran filtro,
// capa y previsualización si siguen puestos, se descarta la evaluación
// y se deja la señal cambio:<tabId> para que el panel se actualice.
// Solo afecta a la pestaña en la que cambió la página.
// ------------------------------------------------------------------
const lastUrlByTab = new Map();
const lastResetByTab = new Map();

async function resetTabAfterNavigation(tabId, url, reason) {
  const now = Date.now();
  if (now - (lastResetByTab.get(tabId) || 0) < NAVIGATION_DEBOUNCE_MS) return;
  lastResetByTab.set(tabId, now);
  if (url) lastUrlByTab.set(tabId, url);

  if (reason === "ruta") {
    // Mismo documento: los efectos pueden seguir puestos sobre la vista nueva.
    const frameIds = frameIdsByTab.get(tabId) || [0];
    await sendToFrames(tabId, [0], { type: "CLEAR_SIMULATION" });
    await sendToFrames(tabId, frameIds, { type: "CLEAR_PREVIEW" });
  } else {
    // Documento nuevo: los content scripts anteriores ya no existen.
    frameIdsByTab.delete(tabId);
  }
  chrome.action.setBadgeText({ text: "", tabId }).catch(() => {});

  try {
    const stored = await chrome.storage.session.get(["evaluation:" + tabId, "sim:" + tabId]);
    const sim = stored["sim:" + tabId];
    const hadSomething = Boolean(stored["evaluation:" + tabId]) || (sim && sim.type && sim.type !== "none");
    await chrome.storage.session.remove(["evaluation:" + tabId, "ui:" + tabId, "sim:" + tabId]);
    // La señal solo si había algo que descartar: así el panel no avisa
    // cuando la pestaña simplemente navega sin haber evaluado nada.
    if (hadSomething) await chrome.storage.session.set({ ["cambio:" + tabId]: { at: now, reason } });
  } catch (error) {
    // Sin almacenamiento de sesión no hay nada guardado que descartar.
  }
}

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  resetTabAfterNavigation(details.tabId, details.url, "carga");
});

const onRouteChange = (details) => {
  if (details.frameId !== 0) return;
  // replaceState con la misma dirección no es un cambio de página.
  if (lastUrlByTab.get(details.tabId) === details.url) return;
  resetTabAfterNavigation(details.tabId, details.url, "ruta");
};
chrome.webNavigation.onHistoryStateUpdated.addListener(onRouteChange);
chrome.webNavigation.onReferenceFragmentUpdated.addListener(onRouteChange);

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
    resetTabAfterNavigation(tabId, changeInfo.url || null, "carga");
  }
});

// Al cerrar la pestaña se descarta todo su estado guardado;
// la opción del panel de esa pestaña muere con ella.
chrome.tabs.onRemoved.addListener((tabId) => {
  frameIdsByTab.delete(tabId);
  lastUrlByTab.delete(tabId);
  lastResetByTab.delete(tabId);
  chrome.storage.session
    .remove(["evaluation:" + tabId, "ui:" + tabId, "sim:" + tabId, "cambio:" + tabId])
    .catch(() => {});
});

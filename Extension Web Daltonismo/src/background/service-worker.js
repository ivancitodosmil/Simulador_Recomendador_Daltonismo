// ------------------------------------------------------------------
// Sprints 1-2 · Service worker (módulo ES). Orquesta el flujo
// popup → service worker → content script para la extracción de la
// paleta (sprint 1) y para aplicar o retirar la simulación en vivo
// (sprint 2). Si el content script aún no está inyectado, lo inyecta
// bajo demanda con chrome.scripting; si la página tiene canvas
// ilegibles o no aporta colores, recurre al nivel 3 (captura).
// ------------------------------------------------------------------

import { extractFromCapture } from "../core/extraccion/captura.js";
import { mergePalettes } from "../core/extraccion/consolidacion.js";

// Protocolos donde una extensión no puede inyectar código.
const RESTRICTED_PROTOCOLS = ["chrome:", "chrome-extension:", "edge:", "about:", "devtools:", "view-source:"];
const RESTRICTED_HOSTS = ["chromewebstore.google.com"];

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
  if (isRestrictedUrl(tab.url || "")) {
    return { error: { ok: false, error: "unsupported-page" } };
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

/** Flujo de extracción del sprint 1, con respaldo de captura (nivel 3). */
async function handleExtraction() {
  const { tab, error } = await getActiveTab();
  if (error) return error;

  let response;
  try {
    response = await forwardToContent(tab.id, { type: "EXTRACT_PALETTE" });
  } catch (injectionError) {
    return {
      ok: false,
      error: "injection-failed",
      // El caso típico en el banco de pruebas: archivos file:// sin el
      // permiso "Permitir acceso a URL de archivo" activado.
      isFileUrl: (tab.url || "").startsWith("file:"),
      detail: String(injectionError)
    };
  }

  if (response && response.ok && response.needsCapture) {
    try {
      const capture = await extractFromCapture(tab.windowId);
      response.palette = mergePalettes(response.palette, capture.entries, "capture");
      response.levels = [...response.levels, "capture"];
      response.approximate = true;
    } catch (captureError) {
      // La captura es un respaldo: si falla se informa sin invalidar el resto.
      response.captureError = String(captureError);
    }
  }
  return response;
}

/** Reenvía al content script las órdenes de simulación del sprint 2. */
async function handleSimulationMessage(message) {
  const { tab, error } = await getActiveTab();
  if (error) return error;
  try {
    return await forwardToContent(tab.id, message);
  } catch (injectionError) {
    return {
      ok: false,
      error: "injection-failed",
      isFileUrl: (tab.url || "").startsWith("file:"),
      detail: String(injectionError)
    };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "EXTRACT_PALETTE") {
    handleExtraction()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "unexpected", detail: String(error) }));
    return true; // respuesta asíncrona
  }
  if (message && (message.type === "APPLY_SIMULATION" || message.type === "CLEAR_SIMULATION")) {
    handleSimulationMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "unexpected", detail: String(error) }));
    return true;
  }
  return false;
});

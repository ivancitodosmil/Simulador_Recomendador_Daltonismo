// ------------------------------------------------------------------
// Sprint 1 · Service worker (módulo ES). Orquesta el flujo:
// popup → service worker → content script → respuesta con la paleta.
// Si el content script aún no está inyectado, lo inyecta bajo demanda
// con chrome.scripting; si la página tiene canvas ilegibles o no
// aporta colores, recurre al nivel 3 (captura de pestaña).
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

/**
 * Pide la paleta al content script. Si el envío falla porque aún no está
 * inyectado ("Receiving end does not exist"), lo inyecta y reintenta.
 */
async function requestFromContent(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PALETTE" });
  } catch (firstError) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content/content-script.js"]
    });
    return await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PALETTE" });
  }
}

/** Flujo completo de extracción sobre la pestaña activa. */
async function handleExtraction() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) {
    return { ok: false, error: "no-active-tab" };
  }
  if (isRestrictedUrl(tab.url || "")) {
    return { ok: false, error: "unsupported-page" };
  }

  let response;
  try {
    response = await requestFromContent(tab.id);
  } catch (error) {
    return {
      ok: false,
      error: "injection-failed",
      // El caso típico en el banco de pruebas: archivos file:// sin el
      // permiso "Permitir acceso a URL de archivo" activado.
      isFileUrl: (tab.url || "").startsWith("file:"),
      detail: String(error)
    };
  }

  if (response && response.ok && response.needsCapture) {
    try {
      const capture = await extractFromCapture(tab.windowId);
      response.palette = mergePalettes(response.palette, capture.entries, "capture");
      response.levels = [...response.levels, "capture"];
      response.approximate = true;
    } catch (error) {
      // La captura es un respaldo: si falla se informa sin invalidar el resto.
      response.captureError = String(error);
    }
  }
  return response;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "EXTRACT_PALETTE") {
    handleExtraction()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: "unexpected", detail: String(error) }));
    return true; // respuesta asíncrona
  }
  return false;
});

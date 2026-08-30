// ------------------------------------------------------------------
// Sprint 1 · Content script. No está declarado en el manifest: el
// service worker lo inyecta bajo demanda con chrome.scripting. Por eso
// es un script clásico que carga los módulos ES del núcleo con import()
// dinámico (los módulos están en web_accessible_resources).
// Ejecuta los niveles 1 (DOM/SVG) y 2 (canvas) y responde con la paleta
// consolidada; el nivel 3 (captura) lo decide el service worker.
// ------------------------------------------------------------------

(() => {
  // Evita registrar el listener dos veces si se inyecta de nuevo.
  if (globalThis.__dashboardColorEvaluatorReady) return;
  globalThis.__dashboardColorEvaluatorReady = true;

  let modulesPromise = null;

  /** Carga perezosa (y única) de los módulos ES del núcleo. */
  function loadModules() {
    if (!modulesPromise) {
      modulesPromise = Promise.all([
        import(chrome.runtime.getURL("src/core/extraccion/dom-svg.js")),
        import(chrome.runtime.getURL("src/core/extraccion/canvas.js")),
        import(chrome.runtime.getURL("src/core/extraccion/consolidacion.js"))
      ]).then(([domSvg, canvasModule, consolidation]) => ({ domSvg, canvasModule, consolidation }));
    }
    return modulesPromise;
  }

  /** Ejecuta la extracción completa dentro de la página. */
  async function extractPalette() {
    const startTime = performance.now();
    const { domSvg, canvasModule, consolidation } = await loadModules();

    const domResult = domSvg.extractDomSvgColors();

    let canvasResult = { entries: [], canvasTotal: 0, canvasFailed: 0 };
    try {
      canvasResult = canvasModule.extractCanvasColors(domResult.container);
    } catch (error) {
      canvasResult = { entries: [], canvasTotal: 0, canvasFailed: 1 };
    }

    const { palette, registry } = consolidation.consolidateObservations(
      domResult.observations,
      canvasResult.entries
    );

    // El registro hex → elementos se queda en la página para los sprints de
    // simulación y recomendación (no es serializable en el mensaje).
    globalThis.__dashboardColorRegistry = registry;

    const levels = [];
    if (domResult.observations.length) levels.push("dom-svg");
    if (canvasResult.entries.length) levels.push("canvas");

    return {
      ok: true,
      palette,
      levels,
      // Si hubo canvas ilegibles o no se encontró nada, el service worker
      // puede recurrir al nivel 3 (captura de pestaña).
      needsCapture: canvasResult.canvasFailed > 0 || palette.length === 0,
      stats: {
        nodesVisited: domResult.visited,
        truncated: domResult.truncated,
        containerTag: domResult.containerTag,
        domObservations: domResult.observations.length,
        canvasTotal: canvasResult.canvasTotal,
        canvasFailed: canvasResult.canvasFailed
      },
      elapsedMs: performance.now() - startTime
    };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "PING") {
      sendResponse({ ok: true });
      return false;
    }
    if (message && message.type === "EXTRACT_PALETTE") {
      extractPalette()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "extraction-failed", detail: String(error) }));
      return true; // respuesta asíncrona
    }
    return false;
  });
})();

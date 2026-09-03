// ------------------------------------------------------------------
// Sprints 1-2 · Content script. No está declarado en el manifest: el
// service worker lo inyecta bajo demanda con chrome.scripting. Por eso
// es un script clásico que carga los módulos ES del núcleo con import()
// dinámico (los módulos están en web_accessible_resources).
// Sprint 1: niveles 1 (DOM/SVG) y 2 (canvas) de extracción.
// Sprint 2: aplica y retira el filtro SVG de simulación sobre el
// contenedor del dashboard.
// ------------------------------------------------------------------

(() => {
  // Evita registrar el listener dos veces si se inyecta de nuevo.
  if (globalThis.__dashboardColorEvaluatorReady) return;
  globalThis.__dashboardColorEvaluatorReady = true;

  let extractionModulesPromise = null;
  let filterModulePromise = null;
  let wcagModulePromise = null;

  // Contenedor resuelto en la última extracción: la simulación lo reutiliza
  // para aplicar el filtro exactamente sobre la misma área analizada.
  let cachedContainer = null;

  // Observaciones color-elemento de la última extracción: la evaluación de
  // contraste (sprint 3) las necesita con sus referencias vivas.
  let lastObservations = [];

  /** Carga perezosa (y única) de los módulos de extracción. */
  function loadExtractionModules() {
    if (!extractionModulesPromise) {
      extractionModulesPromise = Promise.all([
        import(chrome.runtime.getURL("src/core/extraccion/dom-svg.js")),
        import(chrome.runtime.getURL("src/core/extraccion/canvas.js")),
        import(chrome.runtime.getURL("src/core/extraccion/consolidacion.js"))
      ]).then(([domSvg, canvasModule, consolidation]) => ({ domSvg, canvasModule, consolidation }));
    }
    return extractionModulesPromise;
  }

  /** Carga perezosa del módulo del filtro de simulación. */
  function loadFilterModule() {
    if (!filterModulePromise) {
      filterModulePromise = import(chrome.runtime.getURL("src/core/simulacion/filtro-svg.js"));
    }
    return filterModulePromise;
  }

  /** Carga perezosa del módulo de evaluación WCAG (sprint 3). */
  function loadWcagModule() {
    if (!wcagModulePromise) {
      wcagModulePromise = import(chrome.runtime.getURL("src/core/evaluacion/contraste-wcag.js"));
    }
    return wcagModulePromise;
  }

  /** Ejecuta la extracción completa dentro de la página (sprint 1). */
  async function extractPalette() {
    const startTime = performance.now();
    const { domSvg, canvasModule, consolidation } = await loadExtractionModules();

    const domResult = domSvg.extractDomSvgColors();
    cachedContainer = domResult.container;
    lastObservations = domResult.observations;

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

  /**
   * Evaluación completa (sprint 3): extracción + contraste WCAG sobre los
   * colores declarados, con las relaciones color-elemento aún vivas.
   * La distinguibilidad la calcula el service worker con la paleta simulada.
   */
  async function runFullEvaluation() {
    const extraction = await extractPalette();
    let contrast = { text: [], graphics: [] };
    try {
      const wcagModule = await loadWcagModule();
      contrast = wcagModule.evaluateWcagContrast(lastObservations);
    } catch (error) {
      contrast = { text: [], graphics: [], error: String(error) };
    }
    return { ...extraction, contrast };
  }

  /** Aplica el filtro de simulación sobre el contenedor (sprint 2). */
  async function applySimulation(config) {
    const filterModule = await loadFilterModule();
    filterModule.applySimulationFilter(config, cachedContainer);
    return { ok: true };
  }

  /** Retira el filtro y restaura la página (sprint 2). */
  async function clearSimulation() {
    const filterModule = await loadFilterModule();
    filterModule.clearSimulationFilter();
    return { ok: true };
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
    if (message && message.type === "RUN_EVALUATION") {
      runFullEvaluation()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "extraction-failed", detail: String(error) }));
      return true;
    }
    if (message && message.type === "APPLY_SIMULATION") {
      applySimulation(message.config)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "simulation-failed", detail: String(error) }));
      return true;
    }
    if (message && message.type === "CLEAR_SIMULATION") {
      clearSimulation()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "simulation-failed", detail: String(error) }));
      return true;
    }
    return false;
  });
})();

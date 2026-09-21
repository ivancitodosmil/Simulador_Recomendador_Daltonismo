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

  /** Carga perezosa de los módulos de color para la previsualización. */
  let colorModulesPromise = null;
  function loadColorModules() {
    if (!colorModulesPromise) {
      colorModulesPromise = Promise.all([
        import(chrome.runtime.getURL("src/core/color/conversion.js")),
        import(chrome.runtime.getURL("src/core/color/diferencia.js"))
      ]).then(([conversion, difference]) => ({ conversion, difference }));
    }
    return colorModulesPromise;
  }

  // ------------------------------------------------------------------
  // Previsualización de la paleta propuesta (sprint 4, RF07).
  // MECANISMO: sustitución por ESTILOS EN LÍNEA sobre los elementos del
  // registro color-elemento de la extracción. El estilo en línea gana a
  // los atributos SVG y a las reglas CSS (incluidas las variables), y
  // al desactivar se restaura el valor en línea previo exacto de cada
  // propiedad tocada, dejando el documento como estaba. Se recolorean
  // las propiedades fill, stroke, background-color y color cuyo valor
  // computado coincide con el color original (ΔE00 < 2.5, el mismo
  // umbral de agrupación de la consolidación).
  // CASO CANVAS (exclusión documentada): los colores muestreados de un
  // canvas no tienen elementos en el registro, así que no pueden
  // recolorearse sin redibujar el gráfico, cosa que solo puede hacer la
  // librería que lo pintó. Esos colores se cuentan y se informan como
  // entriesWithoutElements para que el panel lo comunique.
  // La previsualización convive con el filtro de simulación: este opera
  // como filtro CSS del contenedor y aquella como estilos en línea de
  // elementos, sin pisarse entre sí.
  // ------------------------------------------------------------------
  let previewChanges = null;
  const PREVIEW_PROPERTIES = ["fill", "stroke", "background-color", "color"];
  const PREVIEW_MATCH_DELTA = 2.5;

  /** Aplica la paleta propuesta. mapping: [{fromHex, toHex}] */
  async function applyPalettePreview(mapping) {
    clearPalettePreview();
    const registry = globalThis.__dashboardColorRegistry;
    if (!registry || registry.size === 0) {
      return { ok: false, error: "no-registry" };
    }
    const { conversion, difference } = await loadColorModules();
    const changes = [];
    let entriesWithoutElements = 0;

    for (const entry of mapping) {
      const elements = registry.get(entry.fromHex) || [];
      if (!elements.length) {
        entriesWithoutElements += 1; // típicamente colores de canvas
        continue;
      }
      const fromLab = conversion.rgbToLab(conversion.hexToRgb(entry.fromHex));
      for (const element of elements) {
        if (!element || !element.isConnected) continue;
        const style = getComputedStyle(element);
        for (const property of PREVIEW_PROPERTIES) {
          const parsed = conversion.parseCssColor(style.getPropertyValue(property));
          if (!parsed || parsed.a < 0.05) continue;
          if (difference.ciede2000(conversion.rgbToLab(parsed), fromLab) >= PREVIEW_MATCH_DELTA) continue;
          changes.push({
            element,
            property,
            previousValue: element.style.getPropertyValue(property),
            previousPriority: element.style.getPropertyPriority(property)
          });
          element.style.setProperty(property, entry.toHex);
        }
      }
    }
    previewChanges = changes;
    return { ok: true, recolored: changes.length, entriesWithoutElements };
  }

  /** Retira la previsualización restaurando los estilos en línea previos. */
  function clearPalettePreview() {
    if (!previewChanges) return { ok: true, restored: 0 };
    let restored = 0;
    for (const change of previewChanges) {
      try {
        if (change.previousValue) {
          change.element.style.setProperty(change.property, change.previousValue, change.previousPriority);
        } else {
          change.element.style.removeProperty(change.property);
        }
        restored += 1;
      } catch (error) {
        // El elemento desapareció del documento: no hay nada que restaurar.
      }
    }
    previewChanges = null;
    return { ok: true, restored };
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
    if (message && message.type === "PREVIEW_PALETTE") {
      applyPalettePreview(message.mapping || [])
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "preview-failed", detail: String(error) }));
      return true;
    }
    if (message && message.type === "CLEAR_PREVIEW") {
      sendResponse(clearPalettePreview());
      return false;
    }
    return false;
  });
})();

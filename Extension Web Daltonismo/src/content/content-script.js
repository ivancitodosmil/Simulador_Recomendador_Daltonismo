// ------------------------------------------------------------------
// Content script. No va en el manifest: el service worker lo inyecta
// bajo demanda en todos los marcos con chrome.scripting, por eso es un
// script clásico que carga los módulos ES del núcleo
// (web_accessible_resources) con import() dinámico. En cada marco extrae
// la paleta (RF01), evalúa el contraste con los elementos vivos (RF04),
// aplica el filtro de simulación o la capa de simulación por captura
// (RF02, RF03) y la previsualización de la propuesta (RF07), y suspende
// todo ello mientras se lee la página para que los colores extraídos
// sean los reales. Sprints 1 a 4; marcos, lectura con los efectos
// suspendidos y simulación por captura desde la versión 1.0.0.
// ------------------------------------------------------------------

(() => {
  // Evita registrar el listener dos veces si se inyecta de nuevo.
  if (globalThis.__dashboardColorEvaluatorReady) return;
  globalThis.__dashboardColorEvaluatorReady = true;

  let extractionModulesPromise = null;
  let filterModulePromise = null;
  let wcagModulePromise = null;
  let colorModulesPromise = null;
  let imageSimulationPromise = null;

  // Contenedor resuelto en la última extracción: la simulación lo reutiliza
  // para aplicar el filtro exactamente sobre la misma área analizada.
  let cachedContainer = null;

  // Observaciones color-elemento de la última extracción: la evaluación de
  // contraste las necesita con sus referencias vivas.
  let lastObservations = [];

  // Zonas canvas de la última extracción: su fondo CSS efectivo sirve de
  // fondo para el contraste aproximado de los colores muestreados.
  let lastCanvasZones = [];

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

  /** Carga perezosa del módulo de evaluación WCAG. */
  function loadWcagModule() {
    if (!wcagModulePromise) {
      wcagModulePromise = import(chrome.runtime.getURL("src/core/evaluacion/contraste-wcag.js"));
    }
    return wcagModulePromise;
  }

  /** Carga perezosa de los módulos de color para la previsualización. */
  function loadColorModules() {
    if (!colorModulesPromise) {
      colorModulesPromise = Promise.all([
        import(chrome.runtime.getURL("src/core/color/conversion.js")),
        import(chrome.runtime.getURL("src/core/color/diferencia.js"))
      ]).then(([conversion, difference]) => ({ conversion, difference }));
    }
    return colorModulesPromise;
  }

  /** Carga perezosa de la simulación píxel a píxel (capa por captura). */
  function loadImageSimulationModule() {
    if (!imageSimulationPromise) {
      imageSimulationPromise = import(chrome.runtime.getURL("src/core/simulacion/imagen.js"));
    }
    return imageSimulationPromise;
  }

  /** Identificador del marco de un iframe (Chrome 117+); -1 si no se puede saber. */
  function frameIdOf(element) {
    try {
      return typeof chrome.runtime.getFrameId === "function" ? chrome.runtime.getFrameId(element) : -1;
    } catch (error) {
      return -1;
    }
  }

  // Tope de la espera de pintado: en una pestaña oculta o una ventana
  // minimizada los cuadros de animación no llegan y la lectura no debe colgarse.
  const PAINT_WAIT_MAX_MS = 300;

  /** Dos cuadros de animación (o el tope): garantiza que la página se pintó con el estado actual. */
  function twoFrames() {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, PAINT_WAIT_MAX_MS);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }));
    });
  }

  // ------------------------------------------------------------------
  // Perfil de la página para decidir el modo de simulación: documento de
  // imagen, imagen grande en la vista o canvas WebGL (Figma) que el
  // filtro CSS no puede transformar.
  // ------------------------------------------------------------------
  const OVERLAY_ID = "evaluador-cromatico-simulacion-captura";

  /** Área visible de un elemento dentro de la ventana (px²). */
  function visibleArea(element) {
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
    const height = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    return width * height;
  }

  function pageProfile() {
    const viewArea = Math.max(1, innerWidth * innerHeight);
    let imageShare = 0;
    for (const image of document.images) imageShare = Math.max(imageShare, visibleArea(image) / viewArea);
    let webglShare = 0;
    let canvasCount = 0;
    for (const canvas of document.querySelectorAll("canvas")) {
      if (canvas.id === OVERLAY_ID) continue;
      canvasCount += 1;
      // Un canvas que no entrega contexto 2D ya tiene otro (WebGL): el
      // filtro CSS no transforma su contenido. Es la misma comprobación
      // que hace el nivel 2 de la extracción.
      let is2d = true;
      try {
        is2d = canvas.getContext("2d") !== null;
      } catch (error) {
        is2d = false;
      }
      if (!is2d) webglShare += visibleArea(canvas) / viewArea;
    }
    return {
      isImageDocument: /^image\//.test(document.contentType || ""),
      imageShare: Math.min(1, imageShare),
      webglShare: Math.min(1, webglShare),
      canvasCount,
      iframeCount: document.querySelectorAll("iframe").length,
      viewport: { width: innerWidth, height: innerHeight }
    };
  }

  // ------------------------------------------------------------------
  // Simulación por captura: una capa fija del tamaño de la vista, con
  // pointer-events none, que muestra la captura de la pestaña simulada
  // píxel a píxel con las mismas matrices del cálculo. La captura la
  // hace el service worker (captureVisibleTab) con la capa oculta; al
  // cambiar la severidad se recalcula desde la captura guardada; al
  // desplazarse, redimensionar o soltar el puntero, la capa se oculta y
  // se pide una captura nueva con un retardo para no saturar.
  // ------------------------------------------------------------------
  const RECAPTURE_DELAY = 700;
  let overlay = null;
  let recaptureTimer = null;

  function ensureOverlay() {
    if (overlay && overlay.element.isConnected) return overlay;
    if (overlay) removeOverlay();
    const element = document.createElement("canvas");
    element.id = OVERLAY_ID;
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100vw",
      height: "100vh",
      pointerEvents: "none",
      zIndex: "2147483647",
      display: "none"
    });
    (document.documentElement || document.body).appendChild(element);
    const onViewChange = () => scheduleRecapture();
    window.addEventListener("scroll", onViewChange, { capture: true, passive: true });
    window.addEventListener("wheel", onViewChange, { capture: true, passive: true });
    window.addEventListener("pointerup", onViewChange, { capture: true, passive: true });
    window.addEventListener("resize", onViewChange, { passive: true });
    overlay = { element, capture: null, config: null, onViewChange, recaptures: 0 };
    return overlay;
  }

  /** Decodifica la captura (data: URL PNG) a ImageData. */
  async function decodeCapture(dataUrl) {
    const blob = await (await fetch(dataUrl)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    return context.getImageData(0, 0, canvas.width, canvas.height);
  }

  /** Pinta la captura guardada simulada con la configuración vigente. */
  async function renderOverlay() {
    if (!overlay || !overlay.capture) return;
    const { simulateImageData } = await loadImageSimulationModule();
    const simulated = simulateImageData(overlay.capture, overlay.config);
    const element = overlay.element;
    element.width = simulated.width;
    element.height = simulated.height;
    element.getContext("2d").putImageData(new ImageData(simulated.data, simulated.width, simulated.height), 0, 0);
    element.style.display = "block";
  }

  async function showSimulatedOverlay(dataUrl, config) {
    const current = ensureOverlay();
    current.capture = await decodeCapture(dataUrl);
    current.config = config;
    await renderOverlay();
    return { ok: true, mode: "capture", width: current.capture.width, height: current.capture.height };
  }

  async function updateOverlayConfig(config) {
    if (!overlay || !overlay.capture) return { ok: false, error: "no-overlay" };
    overlay.config = config;
    await renderOverlay();
    return { ok: true, mode: "capture" };
  }

  /** Oculta la capa y espera a que la página se pinte sin ella (antes de capturar). */
  async function hideOverlay() {
    if (overlay) overlay.element.style.display = "none";
    await twoFrames();
    return { ok: true };
  }

  function removeOverlay() {
    if (!overlay) return;
    clearTimeout(recaptureTimer);
    recaptureTimer = null;
    window.removeEventListener("scroll", overlay.onViewChange, { capture: true });
    window.removeEventListener("wheel", overlay.onViewChange, { capture: true });
    window.removeEventListener("pointerup", overlay.onViewChange, { capture: true });
    window.removeEventListener("resize", overlay.onViewChange);
    overlay.element.remove();
    overlay = null;
  }

  /** La vista cambió: la capa se oculta ya y se pide una captura nueva tras el retardo. */
  function scheduleRecapture() {
    if (!overlay || suspendedState) return;
    overlay.element.style.display = "none";
    clearTimeout(recaptureTimer);
    recaptureTimer = setTimeout(recapture, RECAPTURE_DELAY);
  }

  async function recapture() {
    recaptureTimer = null;
    if (!overlay || suspendedState) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: "RECAPTURE_SIMULATION" });
      if (!overlay || !response || !response.ok) return;
      overlay.capture = await decodeCapture(response.dataUrl);
      overlay.recaptures += 1;
      await renderOverlay();
    } catch (error) {
      // Sin service worker a mano: la capa sigue oculta hasta el siguiente cambio de vista.
    }
  }

  // ------------------------------------------------------------------
  // Previsualización de la paleta propuesta (RF07).
  // Mecanismo: sustitución por estilos en línea sobre los elementos del
  // registro color-elemento de la extracción. El estilo en línea gana a
  // los atributos SVG y a las reglas CSS (incluidas las variables), y
  // al desactivar se restaura el valor en línea previo exacto de cada
  // propiedad tocada, dejando el documento como estaba. Se recolorean
  // las propiedades fill, stroke, background-color y color cuyo valor
  // computado coincide con el color original (ΔE00 < 2.5, el mismo
  // umbral de agrupación de la consolidación).
  // Caso canvas (exclusión documentada): los colores muestreados de un
  // canvas no tienen elementos en el registro, así que no pueden
  // recolorearse sin redibujar el gráfico, cosa que solo puede hacer la
  // librería que lo pintó. Esos colores se informan con recoloredHexes
  // para que el service worker cuente los que ningún marco recoloreó.
  // La previsualización convive con el filtro de simulación: este opera
  // como filtro CSS del contenedor y aquella como estilos en línea de
  // elementos, sin pisarse entre sí. Con la capa por captura, se pide
  // una captura nueva para que la capa la refleje.
  // ------------------------------------------------------------------
  let previewChanges = null;
  let lastPreviewMapping = null;
  const PREVIEW_PROPERTIES = ["fill", "stroke", "background-color", "color"];
  const PREVIEW_MATCH_DELTA = 2.5;

  // Marca en cada elemento recoloreado con sus valores en línea previos.
  // La memoria de este script muere al recargar la extensión o al cambiar
  // de instancia; la marca permite que cualquier instancia detecte y
  // retire una previsualización que quedó puesta en la página.
  const PREVIEW_MARK = "data-evaluador-cromatico-previa";

  /** Elementos que cumplen el selector en el documento y en sus shadow roots abiertos. */
  function queryAllDeep(selector, root = document) {
    const found = Array.from(root.querySelectorAll(selector));
    for (const host of root.querySelectorAll("*")) {
      if (host.shadowRoot) found.push(...queryAllDeep(selector, host.shadowRoot));
    }
    return found;
  }

  function readMark(element) {
    try {
      const saved = JSON.parse(element.getAttribute(PREVIEW_MARK));
      return saved && saved.props ? saved : null;
    } catch (error) {
      return null;
    }
  }

  /** Devuelve al elemento sus valores en línea previos y le quita la marca. */
  function restoreMarkedElement(element, saved) {
    for (const property of Object.keys(saved.props)) {
      const previous = saved.props[property];
      if (previous.value) element.style.setProperty(property, previous.value, previous.priority || "");
      else element.style.removeProperty(property);
    }
    if (!saved.had && element.getAttribute("style") === "") element.removeAttribute("style");
    element.removeAttribute(PREVIEW_MARK);
  }

  /** Retira toda previsualización marcada en la página; devuelve cuántos elementos restauró. */
  function restoreMarkedElements() {
    let count = 0;
    for (const element of queryAllDeep("[" + PREVIEW_MARK + "]")) {
      const saved = readMark(element);
      if (saved) {
        restoreMarkedElement(element, saved);
        count += 1;
      } else {
        element.removeAttribute(PREVIEW_MARK);
      }
    }
    return count;
  }

  function countMarkedElements() {
    return queryAllDeep("[" + PREVIEW_MARK + "]").length;
  }

  /**
   * Elementos del registro para un color: la clave exacta o, si la fusión
   * entre marcos cambió el representante del grupo, las claves a menos de
   * ΔE00 2,5 del color pedido.
   */
  function registryElements(registry, hex, conversion, difference) {
    const exact = registry.get(hex);
    if (exact && exact.length) return exact;
    const lab = conversion.rgbToLab(conversion.hexToRgb(hex));
    const elements = [];
    for (const [key, list] of registry) {
      if (difference.ciede2000(conversion.rgbToLab(conversion.hexToRgb(key)), lab) < PREVIEW_MATCH_DELTA) {
        elements.push(...list);
      }
    }
    return elements;
  }

  /** Aplica la paleta propuesta. mapping: [{fromHex, toHex}] */
  async function applyPalettePreview(mapping) {
    clearPalettePreview();
    const registry = globalThis.__dashboardColorRegistry;
    if (!registry || registry.size === 0) {
      return { ok: false, error: "no-registry" };
    }
    const { conversion, difference } = await loadColorModules();
    const changes = [];
    const recoloredHexes = [];

    for (const entry of mapping) {
      const elements = registryElements(registry, entry.fromHex, conversion, difference);
      if (!elements.length) continue; // sin elementos en este marco (canvas u otro marco)
      const before = changes.length;
      const fromLab = conversion.rgbToLab(conversion.hexToRgb(entry.fromHex));
      for (const element of elements) {
        if (!element || !element.isConnected) continue;
        const style = getComputedStyle(element);
        for (const property of PREVIEW_PROPERTIES) {
          const parsed = conversion.parseCssColor(style.getPropertyValue(property));
          if (!parsed || parsed.a < 0.05) continue;
          if (difference.ciede2000(conversion.rgbToLab(parsed), fromLab) >= PREVIEW_MATCH_DELTA) continue;
          const previousValue = element.style.getPropertyValue(property);
          const previousPriority = element.style.getPropertyPriority(property);
          // Restauración exacta: si el elemento no tenía atributo style,
          // al limpiar se retira también el atributo vacío que queda.
          const saved = readMark(element) || { had: element.hasAttribute("style"), props: {} };
          if (!saved.props[property]) saved.props[property] = { value: previousValue, priority: previousPriority };
          changes.push({ element, property, previousValue, previousPriority, hadStyleAttribute: saved.had });
          element.style.setProperty(property, entry.toHex);
          element.setAttribute(PREVIEW_MARK, JSON.stringify(saved));
        }
      }
      if (changes.length > before) recoloredHexes.push(entry.fromHex);
    }
    previewChanges = changes;
    lastPreviewMapping = mapping;
    if (overlay) scheduleRecapture();
    return { ok: true, recolored: changes.length, recoloredHexes, entriesWithoutElements: mapping.length - recoloredHexes.length };
  }

  /**
   * Retira la previsualización restaurando los estilos en línea previos:
   * primero lo que recordó esta instancia y después cualquier elemento
   * que siga marcado (restos de otra instancia). Devuelve cuántos de cada.
   */
  function clearPalettePreview() {
    let restored = 0;
    if (previewChanges) {
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
      // Segunda pasada: elimina los atributos style vacíos que este módulo creó y las marcas.
      for (const change of previewChanges) {
        try {
          if (!change.hadStyleAttribute && change.element.getAttribute("style") === "") {
            change.element.removeAttribute("style");
          }
          change.element.removeAttribute(PREVIEW_MARK);
        } catch (error) {
          // Elemento fuera del documento.
        }
      }
    }
    const stale = restoreMarkedElements();
    const hadSomething = Boolean(previewChanges) || stale > 0;
    previewChanges = null;
    lastPreviewMapping = null;
    if (overlay && hadSomething) scheduleRecapture();
    return { ok: true, restored, stale };
  }

  // ------------------------------------------------------------------
  // Suspensión de los efectos visuales durante la lectura. El filtro de
  // simulación y la capa por captura cambian lo que se ve (y lo que
  // captura el nivel 3), así que se retiran antes de extraer y se
  // restauran exactamente después. La previsualización se retira y no se
  // restaura: una lectura siempre deja el interruptor apagado, y así se
  // elimina también cualquier resto marcado por otra instancia. Dos
  // cuadros de animación garantizan que la página se pintó sin ellos.
  // ------------------------------------------------------------------
  let suspendedState = null;

  async function suspendVisuals() {
    if (suspendedState) return { ok: true, already: true };
    const state = { filter: null, overlay: false };
    if (filterModulePromise) {
      const filterModule = await filterModulePromise;
      const filterState = filterModule.getSimulationFilterState();
      if (filterState.active) {
        state.filter = { config: filterState.config, target: filterModule.getSimulationFilterTarget() };
        filterModule.clearSimulationFilter();
      }
    }
    if (overlay && overlay.element.style.display !== "none") {
      state.overlay = true;
      overlay.element.style.display = "none";
    }
    const cleared = clearPalettePreview();
    const previewRemoved = cleared.restored + cleared.stale;
    suspendedState = state;
    if (state.filter || state.overlay || previewRemoved) await twoFrames();
    return { ok: true, filter: Boolean(state.filter), overlay: state.overlay, previewRemoved, staleRestored: cleared.stale };
  }

  async function restoreVisuals() {
    if (!suspendedState) return { ok: true };
    const state = suspendedState;
    suspendedState = null;
    if (state.filter) {
      const filterModule = await loadFilterModule();
      filterModule.applySimulationFilter(state.filter.config, state.filter.target || cachedContainer);
    }
    if (state.overlay && overlay) overlay.element.style.display = "block";
    return { ok: true };
  }

  /** Ejecuta la extracción completa dentro de este marco (niveles 1 y 2). */
  async function extractPalette() {
    const startTime = performance.now();
    const { domSvg, canvasModule, consolidation } = await loadExtractionModules();

    // Comprobación final antes de leer: ningún elemento puede seguir con
    // la marca de previsualización; si lo hay, recupera su color original.
    const stalePreviewRestored = restoreMarkedElements();

    const domResult = domSvg.extractDomSvgColors();
    cachedContainer = domResult.container;
    lastObservations = domResult.observations;

    // Nivel 2 sobre los canvas de las zonas de gráficos (también los de
    // shadow roots); los ilegibles van a la captura recortada.
    const canvasZones = domResult.zones.filter((zone) => zone.kind === "canvas");
    lastCanvasZones = canvasZones;
    let canvasResult = { entries: [], canvasTotal: 0, canvasFailed: 0, failedRects: [] };
    try {
      canvasResult = canvasModule.extractCanvasColors(canvasZones.map((zone) => zone.element));
    } catch (error) {
      canvasResult = {
        entries: [],
        canvasTotal: canvasZones.length,
        canvasFailed: canvasZones.length,
        failedRects: canvasZones.map((zone) => zone.rect)
      };
    }

    const { palette, registry } = consolidation.consolidateObservations(
      domResult.observations,
      canvasResult.entries
    );

    // El registro hex → elementos se queda en la página para la
    // previsualización (no es serializable en el mensaje).
    globalThis.__dashboardColorRegistry = registry;

    const levels = [];
    if (domResult.observations.length) levels.push("dom-svg");
    if (canvasResult.entries.length) levels.push("canvas");

    // Zonas serializables: los iframes llevan su marco hijo para que el
    // service worker sepa si los extrajo su propio script o hay que
    // capturarlos recortados.
    const zones = domResult.zones.map((zone) =>
      zone.kind === "iframe"
        ? { kind: "iframe", rect: zone.rect, src: zone.element.src || "", childFrameId: frameIdOf(zone.element) }
        : { kind: zone.kind, rect: zone.rect }
    );

    // Elementos recoloreables por color (DOM y SVG con elemento): el panel
    // decide con ellos si la previsualización está disponible.
    const registryCounts = {};
    for (const [hex, elements] of registry) registryCounts[hex] = elements.length;

    // Resumen de zonas para el panel: gráficos con marcas (svg con marcas
    // y canvas con algo pintado), zonas vacías (svg sin marcas,
    // contenedores de gráfico vacíos, canvas en blanco) e imágenes grandes.
    const canvasEmpty = canvasResult.canvasEmpty || 0;
    const zoneSummary = {
      marked: domResult.zones.filter((zone) => zone.kind === "svg").length + Math.max(0, canvasZones.length - canvasEmpty),
      empty: (domResult.emptyZones || 0) + canvasEmpty,
      images: domResult.zones.filter((zone) => zone.kind === "imagen").length
    };

    return {
      ok: true,
      palette,
      levels,
      zones,
      zoneSummary,
      failedCanvasRects: canvasResult.failedRects || [],
      frame: domResult.frame,
      url: location.href,
      domObservations: domResult.observations.length,
      registryCounts,
      stats: {
        nodesVisited: domResult.visited,
        truncated: domResult.truncated,
        containerTag: domResult.containerTag,
        domObservations: domResult.observations.length,
        canvasTotal: canvasResult.canvasTotal,
        canvasFailed: canvasResult.canvasFailed,
        stalePreviewRestored
      },
      elapsedMs: performance.now() - startTime
    };
  }

  /**
   * Evaluación completa del marco: extracción + contraste WCAG sobre los
   * colores declarados, con las relaciones color-elemento aún vivas y los
   * efectos visuales suspendidos (si el service worker no lo hizo ya). La
   * distinguibilidad la calcula el service worker con la paleta fusionada.
   */
  async function runFullEvaluation() {
    const wasSuspended = Boolean(suspendedState);
    if (!wasSuspended) await suspendVisuals();
    try {
      const extraction = await extractPalette();
      let contrast = { text: [], graphics: [] };
      // Fondos para el contraste aproximado de las series sin elemento: el
      // de la página (body) y el fondo CSS efectivo del canvas más grande.
      let pageBackground = null;
      let canvasBackground = null;
      try {
        const wcagModule = await loadWcagModule();
        contrast = wcagModule.evaluateWcagContrast(lastObservations);
        pageBackground = wcagModule.backgroundEntry(document.body);
        const area = (zone) => zone.rect.width * zone.rect.height;
        const largestCanvas = lastCanvasZones.reduce((best, zone) => (!best || area(zone) > area(best) ? zone : best), null);
        if (largestCanvas) canvasBackground = wcagModule.backgroundEntry(largestCanvas.element);
      } catch (error) {
        contrast = { text: [], graphics: [], error: String(error) };
      }
      return { ...extraction, contrast, pageBackground, canvasBackground };
    } finally {
      if (!wasSuspended) await restoreVisuals();
    }
  }

  /** Aplica el filtro de simulación sobre el contenedor (retira la capa por captura si la había). */
  async function applySimulation(config) {
    removeOverlay();
    const filterModule = await loadFilterModule();
    filterModule.applySimulationFilter(config, cachedContainer);
    return { ok: true, mode: "filter" };
  }

  /** Retira el filtro y la capa por captura y restaura la página. */
  async function clearSimulation() {
    removeOverlay();
    if (filterModulePromise) {
      const filterModule = await filterModulePromise;
      filterModule.clearSimulationFilter();
    }
    return { ok: true };
  }

  /** Estado real de la simulación en este marco: filtro CSS o capa por captura. */
  async function simulationState() {
    if (overlay && overlay.capture) return { active: true, config: overlay.config, mode: "capture" };
    let filter = { active: false, config: null };
    if (filterModulePromise) {
      const filterModule = await filterModulePromise;
      filter = filterModule.getSimulationFilterState();
    }
    return { ...filter, mode: "filter" };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "GET_PAGE_STATE") {
      // Reconciliación: el panel pregunta qué tiene la página realmente.
      // Si el módulo del filtro nunca se cargó, no puede haber filtro
      // (solo este módulo lo aplica).
      // La previsualización cuenta como activa si esta instancia la recuerda
      // o si quedan elementos marcados por otra instancia.
      simulationState()
        .then((filter) => sendResponse({
          ok: true,
          filter,
          previewActive: (Array.isArray(previewChanges) && previewChanges.length > 0) || countMarkedElements() > 0
        }))
        .catch(() => sendResponse({ ok: true, filter: { active: false, config: null, mode: "filter" }, previewActive: false }));
      return true;
    }
    if (message && message.type === "PAGE_PROFILE") {
      try {
        sendResponse({ ok: true, ...pageProfile() });
      } catch (error) {
        sendResponse({ ok: false, error: "profile-failed", detail: String(error) });
      }
      return false;
    }
    if (message && message.type === "SUSPEND_VISUALS") {
      suspendVisuals()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "suspend-failed", detail: String(error) }));
      return true;
    }
    if (message && message.type === "RESTORE_VISUALS") {
      restoreVisuals()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "restore-failed", detail: String(error) }));
      return true;
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
    if (message && message.type === "SHOW_SIMULATED_OVERLAY") {
      showSimulatedOverlay(message.dataUrl, message.config)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "overlay-failed", detail: String(error) }));
      return true;
    }
    if (message && message.type === "UPDATE_SIMULATED_OVERLAY") {
      updateOverlayConfig(message.config)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: "overlay-failed", detail: String(error) }));
      return true;
    }
    if (message && message.type === "HIDE_OVERLAY") {
      hideOverlay()
        .then(sendResponse)
        .catch(() => sendResponse({ ok: true }));
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

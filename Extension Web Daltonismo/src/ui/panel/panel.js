// ------------------------------------------------------------------
// Lógica del panel lateral: simulación por pestaña (RF02, RF03), resumen,
// paleta (RF01), contraste (RF04), distinguibilidad (RF05), series
// consideradas y recomendación con previsualización (RF06, RF07),
// exportación del reporte (RF08) y tema claro/oscuro. Sprints 3 a 5;
// panel por pestaña desde 0.6.0 y diseño de la maqueta desde 0.6.3.
//
// Modelo por pestaña: el service worker habilita el panel por pestaña;
// la simulación de la página es por pestaña y su único control es el
// desplegable (elegir aplica, «Ninguna» retira); evaluation:, sim: y
// ui:<tabId> viven en chrome.storage.session y la reconciliación con la
// página (GET_PAGE_STATE) es la fuente de verdad.
//
// Tema: mientras el usuario no elige, manda el sistema; la elección se
// guarda en chrome.storage.local (global) y se espeja en localStorage
// para que tema.js la aplique antes del primer pintado. Sin iconos ni
// glifos salvo el sol y la luna del selector; ningún estado se comunica
// solo con color.
// ------------------------------------------------------------------

import { rgbToHex, rgbToLab } from "../../core/color/conversion.js";
import {
  computeDistinguishability,
  simulateForConfig,
  DEFAULT_CONFUSION_THRESHOLD
} from "../../core/evaluacion/distinguibilidad.js";
import { recommendPalette } from "../../core/recomendacion/algoritmo.js";
import { ciede2000 } from "../../core/color/diferencia.js";
import { buildReportData } from "../../core/reporte/generador.js";

const byId = (id) => document.getElementById(id);

const evaluateButton = byId("evaluate-button");
const evaluationScope = byId("evaluation-scope");
const evaluationIntro = byId("evaluation-intro");
const clearButton = byId("clear-button");
const exportButton = byId("export-button");
const statusElement = byId("panel-status");
const simulationStatus = byId("simulation-status");
const announcerElement = byId("panel-announcer");
const tabStateElement = byId("tab-state");
const themeGroup = byId("theme-group");
const themeRadios = Array.from(themeGroup.querySelectorAll("[role=radio]"));
const approximateNotice = byId("approximate-notice");
const truncatedNotice = byId("truncated-notice");
const captureNote = byId("capture-note");
const emptyState = byId("empty-state");
const summaryBlock = byId("summary-block");
const summarySeries = byId("summary-series");
const bandOriginal = byId("band-original");
const bandSimulated = byId("band-simulated");
const bandSimulatedLabel = byId("band-simulated-label");
const statContrastValue = byId("stat-contrast-value");
const statContrastText = byId("stat-contrast-text");
const statConflictsValue = byId("stat-conflicts-value");
const statConflictsText = byId("stat-conflicts-text");
const statLevelValue = byId("stat-level-value");
const statLevelText = byId("stat-level-text");
const statApproxValue = byId("stat-approx-value");
const statApproxText = byId("stat-approx-text");
const deficiencySelect = byId("deficiency-select");
const severitySlider = byId("severity-slider");
const severityValue = byId("severity-value");
const simulationHelp = byId("simulation-help");
const paletteSection = byId("palette-section");
const paletteCount = byId("palette-count");
const levelsElement = byId("levels");
const simulatedHeader = byId("simulated-header");
const paletteList = byId("palette-list");
const contrastSection = byId("contrast-section");
const contrastCount = byId("contrast-count");
const textPairsList = byId("text-pairs");
const graphicPairsList = byId("graphic-pairs");
const distSection = byId("distinguishability-section");
const distCount = byId("distinguishability-count");
const distConfigElement = byId("distinguishability-config");
const thresholdInput = byId("threshold-input");
const matrixContainer = byId("matrix-container");
const matrixLegend = byId("matrix-legend");
const conflictList = byId("conflict-list");
const recommendationSection = byId("recommendation-section");
const recommendationScheme = byId("recommendation-scheme");
const compliantCard = byId("compliant-card");
const recommendationTitle = byId("recommendation-title");
const recommendationReason = byId("recommendation-reason");
const recommendationNotice = byId("recommendation-notice");
const recommendationOverview = byId("recommendation-overview");
const recommendationBody = byId("recommendation-body");
const proposalExport = byId("proposal-export");
const compliantExport = byId("compliant-export");
const kpiIterations = byId("kpi-iterations");
const kpiSwaps = byId("kpi-swaps");
const kpiDelta = byId("kpi-delta");
const bandRecOriginal = byId("band-rec-original");
const bandRecProposed = byId("band-rec-proposed");
const familySelect = byId("family-select");
const seriesSummary = byId("series-summary");
const seriesReview = byId("series-review");
const seriesPanel = byId("series-panel");
const seriesCaptureNote = byId("series-capture-note");
const seriesSelectionList = byId("series-selection");
const previewToggle = byId("preview-toggle");
const previewNote = byId("preview-note");

// Nota de la previsualización: la del HTML (gráficos en canvas no se
// modifican) o la de no disponible, cuando ninguna serie considerada tiene
// elementos recoloreables o la simulación va por captura.
const PREVIEW_CANVAS_TEXT = previewNote.textContent.trim().replace(/\s+/g, " ");
const PREVIEW_UNAVAILABLE_TEXT =
  "No disponible en esta página: los gráficos están dibujados en canvas o vienen de una captura. La propuesta solo se puede ver en el panel y en el reporte.";

const SIMULATION_LABELS = {
  none: "sin simulación",
  protanopia: "protanopía",
  deuteranopia: "deuteranopía",
  tritanopia: "tritanopía"
};

const LEVEL_LABELS = {
  "dom-svg": "Nivel 1 · DOM y SVG",
  "canvas": "Nivel 2 · Muestreo de canvas",
  "capture": "Nivel 3 · Captura de pestaña (aproximado)"
};

const LEVEL_SHORT = { "dom-svg": "DOM y SVG", "canvas": "canvas", "capture": "captura" };

const ROLE_LABELS = {
  background: "fondo",
  text: "texto",
  series: "serie",
  border: "borde"
};

const ERROR_MESSAGES = {
  "unsupported-page": "Esta página no se puede evaluar: es una página interna del navegador o de la tienda de extensiones.",
  "no-access": "La extensión aún no tiene acceso a esta pestaña. Haz clic en el icono de la extensión con esa pestaña en primer plano y vuelve a pulsar «Extraer paleta y evaluar».",
  "no-active-tab": "No se encontró una pestaña activa que evaluar.",
  "injection-failed": "No se pudo acceder a la página para analizarla.",
  "extraction-failed": "La extracción falló dentro de la página.",
  "unexpected": "Ocurrió un error inesperado durante la evaluación."
};

const SIMULATION_HELP = {
  default: "Se aplica solo a esta pestaña. Elige «Ninguna» para ver los colores originales.",
  tritanopia: "En tritanopía la severidad no se gradúa (método de Brettel) y el filtro sobre la página es una aproximación; la paleta del panel usa el cálculo exacto."
};

// Resultado honesto cuando ninguna serie es un color de datos, según lo
// que haya en la página: sin zonas de gráficos, zonas vacías o gráficos
// con marcas pero sin ningún color cromático de datos.
const NO_DATA_COLORS_TEXT =
  "No se detectaron colores de datos en los gráficos. Revisa que el dashboard esté visible o usa la captura.";
const NO_CHARTS_TEXT =
  "Esta página no tiene gráficos que evaluar. El contraste de textos y bordes sigue disponible en Contraste.";
const EMPTY_CHARTS_TEXT =
  "Los gráficos de esta página no muestran datos todavía. Carga datos o cambia el filtro y vuelve a evaluar.";
const NO_DATA_HEADINGS = {
  "no-charts": ["Sin gráficos", NO_CHARTS_TEXT],
  "empty-charts": ["Gráficos sin datos", EMPTY_CHARTS_TEXT],
  "no-data-colors": ["Sin colores de datos", NO_DATA_COLORS_TEXT]
};

/**
 * Causa de «sin colores de datos» según las zonas de la evaluación: sin
 * gráficos (ni svg con marcas, ni canvas, ni imágenes grandes, ni iframes
 * sin inyectar), gráficos vacíos (solo zonas sin marcas) o gráficos con
 * marcas sin color cromático. Las evaluaciones sin resumen de zonas
 * conservan el mensaje general.
 */
function noDataKind(evaluation) {
  const stats = evaluation.stats || {};
  const summary = stats.zoneSummary;
  if (!summary) return "no-data-colors";
  const charts = (summary.marked || 0) + (summary.images || 0) + (stats.iframesNotInjected || 0);
  if (charts === 0 && (summary.empty || 0) === 0) return "no-charts";
  if (charts === 0) return "empty-charts";
  return "no-data-colors";
}

// Máximo de series en la matriz (coherente con el service worker).
const MAX_SERIES_COLORS = 20;

// Escala de las cifras de los pares conflictivos (ΔE00 de 0 a 50).
const SCALE_MAX = 50;

const state = {
  tabId: null,
  evaluation: null,
  threshold: DEFAULT_CONFUSION_THRESHOLD,
  simulation: { type: "none", severity: 1 },
  series: [],
  simulatedRgbs: [],
  distSimulated: null,
  distOriginal: null,
  filterOnPage: false,
  family: "qualitative",
  recommendation: null,
  previewActive: false,
  // Propuesta aplicada en la página: deficiencia y clave de la
  // correspondencia; decide si un cambio de propuesta se refresca.
  previewApplied: null,
  seriesSelection: new Map(),
  seriesNotes: new Map(),
  selectionSource: null,
  ui: { family: null, collapsed: {}, scrollY: 0, selection: null, selectionEvaluatedAt: null },
  restoringSections: false,
  suggestionAdopted: null,
  theme: null,
  // Desenlace bajo las tres deficiencias (sin simulación), para el reporte.
  overview: null,
  // Ninguna serie es un color de datos: la recomendación no se calcula.
  noDataColors: false,
  noDataKind: "no-data-colors",
  // Cómo se simula en la página: filtro CSS o capa por captura (WebGL, imágenes).
  simulationMode: "filter"
};

/** Número con coma decimal. */
function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals).replace(".", ",");
}

/** Primera letra en mayúscula. */
function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Crea un elemento con clase y texto opcionales. */
function el(tag, className = "", text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

// ------------------------------------------------------------------
// Tema: sistema por defecto, elección manual global y sin parpadeo
// ------------------------------------------------------------------

// Preferencia del sistema: manda mientras el usuario no elige.
const systemDark = matchMedia("(prefers-color-scheme: dark)");

/** Tema que se ve ahora: el elegido o, si no hay elección, el del sistema. */
function effectiveTheme() {
  return state.theme || (systemDark.matches ? "oscuro" : "claro");
}

/**
 * Sincroniza el selector con el tema efectivo: la pieza se desliza a la
 * opción que corresponde (data-valor), aria-checked la marca y solo ella
 * entra en el orden de tabulación. Que la elección venga del sistema o
 * del usuario no cambia lo que se ve, solo lo que se guarda.
 */
function syncThemeGroup() {
  const effective = effectiveTheme();
  themeGroup.dataset.valor = effective;
  for (const radio of themeRadios) {
    const checked = radio.dataset.tema === effective;
    radio.setAttribute("aria-checked", String(checked));
    radio.tabIndex = checked ? 0 : -1;
  }
}

/** Aplica el tema (null = seguir al sistema) y sincroniza el grupo. */
function applyTheme(theme) {
  state.theme = theme === "claro" || theme === "oscuro" ? theme : null;
  const root = document.documentElement;
  if (state.theme) root.setAttribute("data-tema", state.theme);
  else root.removeAttribute("data-tema");
  try {
    // Espejo síncrono para tema.js (antes del primer pintado).
    if (state.theme) localStorage.setItem("tema", state.theme);
    else localStorage.removeItem("tema");
  } catch (error) {
    // Sin localStorage: el tema se aplica igualmente en esta sesión.
  }
  syncThemeGroup();
}

// Si manda el sistema y el sistema cambia, el selector lo refleja.
systemDark.addEventListener("change", () => {
  if (!state.theme) syncThemeGroup();
});


/** Lee la preferencia global guardada (chrome.storage.local). */
async function loadTheme() {
  try {
    const stored = await chrome.storage.local.get(["tema"]);
    applyTheme(stored.tema || null);
  } catch (error) {
    applyTheme(null);
  }
}

/** Elección manual: se aplica, se guarda y vale para todas las pestañas. */
function chooseTheme(theme) {
  applyTheme(theme);
  try {
    chrome.storage.local.set({ tema: theme });
  } catch (error) {
    // Sin almacenamiento: queda aplicado en esta sesión.
  }
  const radio = themeRadios.find((item) => item.dataset.tema === theme);
  if (radio) radio.focus();
}

// ------------------------------------------------------------------
// Estado de interfaz por pestaña
// ------------------------------------------------------------------

function saveUiState() {
  if (!state.tabId) return;
  try {
    chrome.storage.session.set({ ["ui:" + state.tabId]: state.ui });
  } catch (error) {
    // Sin almacenamiento se sigue funcionando en memoria.
  }
}

let scrollSaveTimer = null;

/** Guarda la posición de desplazamiento con un retardo de 250 ms. */
function scheduleScrollSave() {
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    state.ui.scrollY = window.scrollY;
    saveUiState();
  }, 250);
}

/** Abre o pliega las secciones y las casillas de series según lo guardado para la pestaña. */
function restoreSectionState() {
  state.restoringSections = true;
  for (const section of document.querySelectorAll("details.bloque")) {
    const key = section.dataset.section;
    if (!key) continue;
    // Sin preferencia guardada todas las secciones salen abiertas; el
    // plegado se recuerda solo en esta pestaña hasta volver a evaluar.
    const collapsed = state.ui.collapsed && typeof state.ui.collapsed[key] === "boolean"
      ? state.ui.collapsed[key]
      : false;
    section.open = !collapsed;
  }
  state.restoringSections = false;
  // Las casillas de series consideradas siguen la misma regla: abiertas
  // salvo que el usuario las haya plegado en esta pestaña.
  setSeriesPanelOpen(!(state.ui.collapsed && state.ui.collapsed.series === true));
}

// ------------------------------------------------------------------
// Estados: texto y forma
// ------------------------------------------------------------------

/** Pinta un estado en el elemento, con la marca «Aviso» o «Error» delante del texto. */
function renderStatusInto(element, kind, text) {
  element.className = "estado";
  element.replaceChildren();
  if (kind === "warning" || kind === "error") {
    const mark = el("strong", "estado-marca estado-marca--" + (kind === "error" ? "error" : "aviso"),
      kind === "error" ? "Error" : "Aviso");
    element.append(mark, " ");
  }
  element.append(text);
  element.hidden = false;
}

/**
 * Mensajes de estado por tarjeta: target "simulation" (simulación
 * aplicada o retirada, cambio de página) va en «Simulación»; el resto
 * (evaluación terminada o descartada, previsualización, reporte, errores)
 * en «Evaluación de accesibilidad». Solo hay un mensaje a la vez y cada
 * acción del usuario lo borra antes de hablar: nunca queda uno que
 * contradiga el estado actual.
 */
function setStatus(kind, text, target = "evaluation") {
  clearStatus();
  renderStatusInto(target === "simulation" ? simulationStatus : statusElement, kind, text);
}

function clearStatus() {
  for (const element of [statusElement, simulationStatus]) {
    element.textContent = "";
    element.hidden = true;
  }
}

function announce(text) {
  announcerElement.textContent = "";
  setTimeout(() => { announcerElement.textContent = text; }, 50);
}

function verdictPill(kind, word) {
  return el("span", "pastilla pastilla--" + kind, word);
}

/**
 * Campo relleno: el texto visible del valor sigue al select, cambie por
 * teclado, ratón o asignación desde el código.
 */
function syncFieldValue(select) {
  const field = select.closest(".campo");
  const value = field ? field.querySelector(".val") : null;
  const option = select.options[select.selectedIndex];
  if (value && option) value.textContent = option.text;
}

function setEvaluateButtonState(done) {
  // Principal antes de evaluar; tonal («Volver a evaluar») después, y la
  // lista de qué se analiza se oculta para ahorrar espacio.
  evaluateButton.classList.toggle("btn-principal", !done);
  evaluateButton.classList.toggle("btn-tonal", done);
  evaluateButton.textContent = done ? "Volver a evaluar" : "Evaluar accesibilidad";
  evaluateButton.setAttribute(
    "aria-label",
    done ? "Volver a evaluar la accesibilidad cromática de esta pestaña"
      : "Evaluar la accesibilidad cromática de la página actual"
  );
  evaluationScope.hidden = done;
  evaluationIntro.hidden = done;
}

function renderTabState() {
  const evaluation = state.evaluation;
  if (evaluation && evaluation.ok) {
    const when = new Date(evaluation.evaluatedAt || Date.now());
    const time = when.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    tabStateElement.textContent = "Evaluada a las " + time + " · " + Math.round(evaluation.elapsedMs || 0) + " ms";
  } else {
    tabStateElement.textContent = "Pestaña sin evaluar";
  }
}

/** Insignia del icono: pares que incumplen más pares confundibles. */
function updateBadge() {
  if (!state.tabId || !state.evaluation || !state.evaluation.ok) return;
  const contrast = state.evaluation.contrast || { text: [], graphics: [] };
  const failingContrast =
    (contrast.text || []).filter((group) => !group.passes).length +
    (contrast.graphics || []).filter((group) => !group.passes).length;
  const conflictCount = state.distSimulated ? state.distSimulated.conflicts.length : 0;
  chrome.action.setBadgeBackgroundColor({ color: "#7F2B00", tabId: state.tabId }).catch(() => { });
  chrome.action.setBadgeText({ text: String(failingContrast + conflictCount), tabId: state.tabId }).catch(() => { });
}

// ------------------------------------------------------------------
// Muestras y bandas
// ------------------------------------------------------------------

/** Muestra cuadrada de 16 px (decorativa; el hex va siempre al lado). */
function swatch(hex) {
  const node = el("span", "m");
  node.style.backgroundColor = hex;
  node.setAttribute("aria-hidden", "true");
  return node;
}

/** Par original|simulada en una sola muestra con borde. */
function pairSwatch(originalHex, simulatedHex) {
  const node = el("span", "par");
  node.setAttribute("aria-hidden", "true");
  const a = el("span");
  a.style.backgroundColor = originalHex;
  const b = el("span");
  b.style.backgroundColor = simulatedHex;
  node.append(a, b);
  return node;
}

/** Banda de colores: un segmento por color, sin texto (decorativa). */
function fillBand(bandElement, hexes) {
  bandElement.replaceChildren();
  bandElement.setAttribute("aria-hidden", "true");
  for (const hex of hexes) {
    const segment = el("span");
    segment.style.backgroundColor = hex;
    bandElement.append(segment);
  }
}

/** Series consideradas (marcadas) o, si no hay ninguna marcada, todas. */
function consideredSeries() {
  const selected = state.series.filter((color) => isSeriesSelected(color.hex));
  return selected.length ? selected : state.series;
}

// ------------------------------------------------------------------
// Simulación por pestaña
// ------------------------------------------------------------------

function simulateColor(rgb) {
  return simulateForConfig(rgb, state.simulation);
}

function updateSimulationControls() {
  const { type, severity } = state.simulation;
  deficiencySelect.value = type;
  syncFieldValue(deficiencySelect);
  severitySlider.value = String(severity);
  severityValue.textContent = formatNumber(severity, 1);
  const sliderDisabled = type === "tritanopia" || type === "none";
  severitySlider.disabled = sliderDisabled;
  severitySlider.setAttribute("aria-disabled", String(sliderDisabled));
  simulationHelp.textContent = type === "tritanopia" ? SIMULATION_HELP.tritanopia : SIMULATION_HELP.default;
  const label = type === "none" ? "Sin simulación" : capitalize(SIMULATION_LABELS[type]);
  simulatedHeader.textContent = label;
  bandSimulatedLabel.textContent = label;
  captureNote.hidden = !(type !== "none" && state.simulationMode === "capture");
}

function persistTabSimulation() {
  if (!state.tabId) return;
  try {
    chrome.storage.session.set({ ["sim:" + state.tabId]: { ...state.simulation } });
    if (state.simulation.type !== "none") {
      chrome.storage.local.set({ lastSimulation: { ...state.simulation } });
    }
  } catch (error) {
    // Sin almacenamiento disponible se sigue funcionando en memoria.
  }
}

async function loadTabSimulation() {
  if (!state.tabId) return;
  try {
    const stored = await chrome.storage.session.get("sim:" + state.tabId);
    const sim = stored["sim:" + state.tabId];
    if (sim && typeof sim.type === "string" && sim.type in SIMULATION_LABELS) {
      state.simulation.type = sim.type;
      if (typeof sim.severity === "number" && Number.isFinite(sim.severity)) {
        state.simulation.severity = Math.min(1, Math.max(0, sim.severity));
      }
    }
  } catch (error) {
    // Valores por defecto (sin simulación).
  }
}

async function loadSuggestedSimulation() {
  try {
    const stored = await chrome.storage.local.get(["lastSimulation"]);
    const last = stored.lastSimulation;
    if (last && typeof last.type === "string" && last.type in SIMULATION_LABELS && last.type !== "none") {
      return {
        type: last.type,
        severity: typeof last.severity === "number" ? Math.min(1, Math.max(0, last.severity)) : 1
      };
    }
  } catch (error) {
    // Sin sugerencia.
  }
  return null;
}

/**
 * Sincroniza el filtro de la página con el desplegable: página simulada
 * ⟺ desplegable con deficiencia. La confirmación solo se anuncia a los
 * lectores de pantalla (el desplegable ya dice qué simulación hay).
 */
async function syncPageFilter({ announce: sayIt = true } = {}) {
  const { type, severity } = state.simulation;
  const shouldApply = type !== "none";
  if (!shouldApply && !state.filterOnPage) return;
  const message = shouldApply
    ? { type: "APPLY_SIMULATION", config: { type, severity }, tabId: state.tabId }
    : { type: "CLEAR_SIMULATION", tabId: state.tabId };
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!(response && response.ok)) {
      if (shouldApply) {
        state.filterOnPage = false;
        setStatus("warning", "La simulación no se pudo aplicar sobre esta página (no es accesible); la paleta simulada del panel sí se actualiza.", "simulation");
      }
      return;
    }
    state.filterOnPage = shouldApply;
    const previousMode = state.simulationMode;
    state.simulationMode = shouldApply && response.mode === "capture" ? "capture" : "filter";
    updateSimulationControls();
    // El modo decide si la previsualización está disponible.
    if (previousMode !== state.simulationMode) renderRecommendation();
    if (!sayIt) return;
    announce(shouldApply
      ? "Simulación de " + SIMULATION_LABELS[type] + " aplicada sobre la página."
      : "Simulación retirada: la página recuperó sus colores originales.");
  } catch (error) {
    if (shouldApply) {
      state.filterOnPage = false;
      setStatus("warning", "No se pudo comunicar con la página para aplicar la simulación.", "simulation");
    }
  }
}

function onSimulationChanged() {
  persistTabSimulation();
  updateSimulationControls();
  renderPalette();
  renderDistinguishability();
  syncPageFilter({ announce: true });
}

// ------------------------------------------------------------------
// Resumen: bandas y marcador
// ------------------------------------------------------------------

/** Valor del marcador: cifra grande + «de N» pequeño; palabra debajo. */
function setStat(valueElement, textElement, { figure, total = null, text, tone = "" }) {
  valueElement.replaceChildren(figure);
  if (total !== null) {
    // Espacio real antes de «de N»: los lectores de pantalla no ven el margen.
    valueElement.append(" ", el("small", "", "de " + total));
  }
  valueElement.className = "v" + (tone ? " " + tone : "");
  textElement.textContent = text;
}

function updateSummary() {
  const evaluation = state.evaluation;
  if (!evaluation || !evaluation.ok) {
    summaryBlock.hidden = true;
    return;
  }
  summaryBlock.hidden = false;

  // Bandas: series consideradas en visión típica y simuladas.
  const considered = consideredSeries();
  fillBand(bandOriginal, considered.map((color) => color.hex));
  fillBand(bandSimulated, considered.map((color) => rgbToHex(simulateColor(color.rgb))));
  summarySeries.textContent = state.series.length + (state.series.length === 1 ? " serie" : " series");

  const contrast = evaluation.contrast || { text: [], graphics: [] };
  const textGroups = contrast.text || [];
  const graphicGroups = contrast.graphics || [];
  const totalPairs = textGroups.length + graphicGroups.length;
  const failing = textGroups.filter((g) => !g.passes).length + graphicGroups.filter((g) => !g.passes).length;
  setStat(statContrastValue, statContrastText, {
    figure: String(failing),
    total: totalPairs,
    text: failing === 1 ? "par incumple" : "pares incumplen",
    tone: failing > 0 ? "mal" : ""
  });

  const n = state.series.length;
  const totalCombinations = n * (n - 1) / 2;
  const conflicts = state.distSimulated ? state.distSimulated.conflicts.length : 0;
  setStat(statConflictsValue, statConflictsText, {
    figure: String(conflicts),
    total: totalCombinations,
    text: n < 2 ? "sin series que comparar" : conflicts === 1 ? "par confundible" : "pares confundibles",
    tone: conflicts > 0 ? "mal" : ""
  });

  const levels = (evaluation.levels || []).map((level) => LEVEL_SHORT[level] || level);
  setStat(statLevelValue, statLevelText, {
    figure: String(levels.length),
    text: (levels.length === 1 ? "nivel, " : "niveles, ") + (levels.join(" + ") || "ninguno")
  });

  const colors = (evaluation.palette || []).length;
  const approximate = evaluation.approximate === true;
  setStat(statApproxValue, statApproxText, {
    figure: String(colors),
    text: (colors === 1 ? "color, " : "colores, ") + (approximate ? "aproximada" : "exacta"),
    tone: approximate ? "avi" : ""
  });
}

// ------------------------------------------------------------------
// Paleta detectada
// ------------------------------------------------------------------

function buildPaletteRow(color) {
  const row = el("div", "r");
  const simulatedHex = rgbToHex(simulateColor(color.rgb));
  row.append(pairSwatch(color.hex, simulatedHex));

  const original = el("span");
  original.append(el("span", "mono hex", color.hex));
  const roles = color.roles.map((role) => ROLE_LABELS[role] || role).join(" · ");
  const share = (color.share * 100).toFixed(1).replace(".", ",") + " %";
  const examples = color.examples && color.examples.length ? " · " + color.examples.join(", ") : "";
  original.append(el("span", "rol", roles + " · " + share + examples));
  row.append(original);

  const simulated = el("span");
  simulated.append(el("span", "mono hex", simulatedHex));
  row.append(simulated);
  return row;
}

function renderPalette() {
  paletteList.replaceChildren();
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  for (const color of palette) paletteList.append(buildPaletteRow(color));
}

// ------------------------------------------------------------------
// Contraste
// ------------------------------------------------------------------

function buildContrastRow(group, kind) {
  const row = el("div", "rc");

  // Muestra: «Aa» pintado con el texto sobre su fondo, o barra del objeto.
  let sample;
  if (kind === "text") {
    sample = el("div", "muestra-txt", "Aa");
    sample.style.color = group.foreground.hex;
    sample.style.backgroundColor = group.background.hex;
  } else {
    sample = el("div", "muestra-obj");
    sample.style.backgroundColor = group.background.hex;
    const bar = el("span", group.ratio < 1.3 ? "tenue" : "");
    bar.style.backgroundColor = group.foreground.hex;
    sample.append(bar);
  }
  sample.setAttribute("aria-hidden", "true");
  row.append(sample);

  const figures = el("div");
  const num = el("span", "mono num", formatNumber(group.ratio));
  num.append(el("small", "", ":1"));
  figures.append(num);
  const detail = el("span", "qd");
  detail.append(el("code", "", group.foreground.hex), " sobre ", el("code", "", group.background.hex));
  // Par aproximado: color muestreado (canvas o captura) sin elemento,
  // comparado con el fondo dominante de su zona.
  const parts = group.approximate
    ? [" · aproximado: sin elemento, comparado con el fondo dominante" + (group.source === "capture" ? " de la captura" : " del canvas")]
    : [" · " + group.count + (group.count === 1 ? " elemento" : " elementos")];
  if (group.largeText) parts.push("texto grande, umbral " + formatNumber(group.threshold, 1) + ":1");
  if (!group.approximate && group.examples && group.examples.length) parts.push(group.examples.slice(0, 3).join(", "));
  detail.append(parts.join(" · "));
  figures.append(detail);
  row.append(figures);

  row.append(group.passes ? verdictPill("cumple", "Cumple") : verdictPill("incumple", "Incumple"));
  return row;
}

function renderPairList(listElement, groups, kind, emptyText) {
  listElement.replaceChildren();
  if (!groups || groups.length === 0) {
    listElement.append(el("p", "sin-datos", emptyText));
    return;
  }
  for (const group of groups) listElement.append(buildContrastRow(group, kind));
}

// ------------------------------------------------------------------
// Distinguibilidad: matriz (triángulo inferior) y pares con escala
// ------------------------------------------------------------------

function renderMatrix() {
  matrixContainer.replaceChildren();
  const size = state.series.length;
  if (size < 2) return;

  const table = el("table", "matriz");
  const caption = el("caption", "solo-lector",
    "Diferencias ΔE00 entre series simuladas; solo se muestra el triángulo inferior.");
  table.append(caption);

  // Encabezado: una muestra por columna (series 1 a n-1).
  const head = el("thead");
  const headRow = el("tr");
  headRow.append(el("th"));
  for (let j = 0; j < size - 1; j += 1) {
    const th = el("th");
    th.scope = "col";
    th.append(swatch(state.series[j].hex), el("span", "solo-lector", "serie " + (j + 1) + " " + state.series[j].hex));
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head);

  const body = el("tbody");
  for (let i = 1; i < size; i += 1) {
    const row = el("tr");
    const rowHeader = el("th", "fila");
    rowHeader.scope = "row";
    rowHeader.append(swatch(state.series[i].hex), " " + (i + 1), el("span", "solo-lector", " " + state.series[i].hex));
    row.append(rowHeader);
    for (let j = 0; j < size - 1; j += 1) {
      const cell = el("td");
      if (j < i) {
        const delta = state.distSimulated.matrix[i][j];
        const conflict = delta < state.threshold;
        cell.className = conflict ? "x" : "v";
        cell.textContent = formatNumber(delta, 1);
        if (conflict) cell.append(el("span", "solo-lector", " confundible"));
      } else {
        cell.className = "vacia";
      }
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  matrixContainer.append(table);
}

/** Escala de 0 a 50 con umbral, punto lleno (simulado) y círculo (típico). */
function buildScale(deltaSimulated, deltaOriginal) {
  const position = (value) => (Math.min(value, SCALE_MAX) / SCALE_MAX) * 100;
  const scale = el("div", "escala");
  scale.setAttribute("aria-hidden", "true");
  scale.append(el("div", "pista"));
  const zone = el("div", "zona");
  zone.style.width = position(state.threshold) + "%";
  const threshold = el("div", "umbral");
  threshold.style.left = position(state.threshold) + "%";
  const typical = el("div", "tip");
  typical.style.left = position(deltaOriginal) + "%";
  const simulated = el("div", "sim");
  simulated.style.left = position(deltaSimulated) + "%";
  scale.append(zone, threshold, typical, simulated);
  return scale;
}

function renderConflicts() {
  conflictList.replaceChildren();
  const conflicts = state.distSimulated ? state.distSimulated.conflicts : [];
  if (!conflicts.length) {
    conflictList.append(el("p", "sin-datos", "Ningún par por debajo del umbral con la simulación seleccionada."));
    return;
  }
  for (const conflict of conflicts) {
    const a = state.series[conflict.i];
    const b = state.series[conflict.j];
    const deltaOriginal = state.distOriginal.matrix[conflict.i][conflict.j];
    const item = el("div", "parc");

    const top = el("div", "top");
    top.append(swatch(a.hex), el("span", "mono hx", a.hex), swatch(b.hex), el("span", "mono hx", b.hex),
      verdictPill("incumple", "Confundible"));
    item.append(top);

    item.append(buildScale(conflict.delta, deltaOriginal));

    const figures = el("div", "cifras");
    const left = el("span");
    left.append("Simulado ", el("b", "mono", formatNumber(conflict.delta)), " · típico ", el("b", "mono", formatNumber(deltaOriginal)));
    const note = el("span", "", deltaOriginal >= state.threshold ? "solo bajo simulación" : "también en visión típica");
    figures.append(left, note);
    item.append(figures);
    conflictList.append(item);
  }
  conflictList.append(el("p", "leyenda-m",
    "Escala de 0 a " + SCALE_MAX + ". Punto lleno: simulado. Círculo: visión típica. Zona rojiza: por debajo del umbral " +
    formatNumber(state.threshold, 1) + "."));
}

function renderDistinguishability() {
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  state.series = palette.filter((color) => color.roles.includes("series")).slice(0, MAX_SERIES_COLORS);

  if (state.series.length < 2) {
    distConfigElement.textContent = "Se necesitan al menos dos colores de serie para evaluar distinguibilidad.";
    distCount.textContent = "sin series";
    matrixContainer.replaceChildren();
    matrixLegend.textContent = "";
    conflictList.replaceChildren(el("p", "sin-datos", "Sin pares que evaluar."));
    state.distSimulated = null;
    state.distOriginal = null;
    updateBadge();
    updateSummary();
    renderRecommendation();
    return;
  }

  state.simulatedRgbs = state.series.map((color) => simulateColor(color.rgb));
  state.distSimulated = computeDistinguishability(state.simulatedRgbs, { threshold: state.threshold });
  state.distOriginal = computeDistinguishability(state.series.map((color) => color.rgb), { threshold: state.threshold });

  const { type, severity } = state.simulation;
  const method = type === "tritanopia" ? "método exacto de Brettel (1997)" : "matrices de Machado (2009)";
  distConfigElement.textContent = type === "none"
    ? "Sin simulación: los ΔE00 corresponden a los colores originales."
    : "Simulación: " + SIMULATION_LABELS[type] + (type === "tritanopia" ? "" : ", severidad " + formatNumber(severity, 1)) + " · " + method + ".";

  const conflictCount = state.distSimulated.conflicts.length;
  distCount.textContent = conflictCount === 0
    ? "sin pares bajo " + formatNumber(state.threshold, 1)
    : conflictCount + (conflictCount === 1 ? " par bajo " : " pares bajo ") + formatNumber(state.threshold, 1);

  renderMatrix();
  matrixLegend.replaceChildren("ΔE00 entre series simuladas. En ", el("b", "", "negrita sobre fondo rojizo"),
    ", los pares por debajo del umbral " + formatNumber(state.threshold, 1) + ".");
  renderConflicts();
  updateBadge();
  updateSummary();
  renderRecommendation();
}

// ------------------------------------------------------------------
// Series consideradas: selección por defecto y casillas
// ------------------------------------------------------------------

/** Color de fondo de body o html en la paleta, si la extracción lo registró. */
function pageBackgroundEntry() {
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  const isPageElement = (example) => /^(body|html)($|[.#])/.test(example);
  return palette.find((color) => color.roles.includes("background") && (color.examples || []).some(isPageElement)) || null;
}

/** Fondo contra el que revalida la recomendación: el de página o, si no, el primer fondo. */
function dominantBackgroundRgb() {
  const pageBackground = pageBackgroundEntry();
  if (pageBackground) return pageBackground.rgb;
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  const backgrounds = palette.filter((color) => color.roles.includes("background"));
  return backgrounds.length ? backgrounds[0].rgb : { r: 255, g: 255, b: 255 };
}

// Descriptores de elementos estructurales de ejes y cuadrícula (D3/SVG).
const STRUCTURAL_EXAMPLE_PATTERN = /^(svg|g|line|path\.domain)$|\.(domain|tick|eje|grid|axis)($|\b)/i;

// Parámetros calibrados en vivo sobre los paneles del banco de pruebas:
// absorción ΔE00 9,0 entre originales (eslabón máximo medido 8,3; series
// reales bien espaciadas ≥ 14), distinta del umbral de confusión porque
// mide otra cosa; croma mínimo C*ab 6 (acromáticos de suavizado 0,4–2,5;
// serie real menos saturada ≈ 20); el piso de proporción 0,8 % solo se
// aplica a evaluaciones antiguas sin marca de zona, porque la
// cuantización cromática ya pliega las variantes de cola. Por defecto
// solo se marcan los colores cromáticos dentro de las zonas de gráficos;
// el desmarcado lleva su nota y puede volver a marcarse.
const SERIES_MIN_SHARE = 0.008;
const SERIES_ABSORB_DELTA = 9.0;
const SERIES_MIN_CHROMA = 6;

function entryChroma(entry) {
  return Math.sqrt(entry.lab.a * entry.lab.a + entry.lab.b * entry.lab.b);
}

function isStructuralEntry(entry) {
  const examples = entry.examples || [];
  return examples.length > 0 && examples.every((example) => STRUCTURAL_EXAMPLE_PATTERN.test(example));
}

/** Selección por defecto: hex → { selected, note }, absorción por rondas. */
function computeDefaultSelection(palette, seriesEntries) {
  const pageBackground = pageBackgroundEntry();
  const pageBgHex = pageBackground ? pageBackground.hex : null;
  const pool = [];
  for (const color of palette) {
    if (!(color.examples || []).length) continue;
    if (color.roles.includes("text")) continue;
    if (color.hex === pageBgHex) continue;
    if (isStructuralEntry(color)) continue;
    pool.push({ lab: color.lab, root: color.hex });
  }
  const items = seriesEntries.map((entry) => {
    const hasElements = (entry.examples || []).length > 0;
    let note = null;
    if (entry.roles.includes("text")) note = "texto";
    else if (entry.roles.includes("background") && entry.hex === pageBgHex) note = "fondo de página";
    else if (hasElements && isStructuralEntry(entry)) note = "estructural (ejes o cuadrícula)";
    else if (entryChroma(entry) < SERIES_MIN_CHROMA) {
      note = hasElements ? "acromático: no es un color de datos" : "acromático: suavizado de texto o ejes";
    } else if (entry.inCharts === false) {
      note = entry.roles.includes("background") ? "fondo fuera de los gráficos" : "fuera de las zonas de gráficos";
    } else if (!hasElements && entry.inCharts === undefined && entry.share < SERIES_MIN_SHARE) {
      note = "proporción " + formatNumber(entry.share * 100) + " %, bajo el piso de " + formatNumber(SERIES_MIN_SHARE * 100, 1) + " %";
    }
    return { entry, hasElements, note, accepted: false };
  });
  const pendingItems = () => items.filter((item) => !item.note && !item.hasElements && !item.accepted);
  while (pendingItems().length) {
    let absorbedSomething = true;
    while (absorbedSomething) {
      absorbedSomething = false;
      for (const item of pendingItems()) {
        let best = null;
        for (const anchor of pool) {
          const delta = ciede2000(item.entry.lab, anchor.lab);
          if (!best || delta < best.delta) best = { delta, root: anchor.root };
        }
        if (best && best.delta < SERIES_ABSORB_DELTA) {
          item.note = "variante de " + best.root + " (ΔE00 " + formatNumber(best.delta, 1) + ")";
          pool.push({ lab: item.entry.lab, root: best.root });
          absorbedSomething = true;
        }
      }
    }
    const rest = pendingItems();
    if (!rest.length) break;
    const top = rest.reduce((a, b) => (b.entry.share > a.entry.share ? b : a), rest[0]);
    top.accepted = true;
    pool.push({ lab: top.entry.lab, root: top.entry.hex });
  }
  const selection = new Map();
  for (const item of items) selection.set(item.entry.hex, { selected: !item.note, note: item.note });
  return selection;
}

function isSeriesSelected(hex) {
  return state.seriesSelection.get(hex) !== false;
}

function persistSelection() {
  const snapshot = {};
  for (const [hex, selected] of state.seriesSelection.entries()) snapshot[hex] = selected;
  state.ui.selection = snapshot;
  state.ui.selectionEvaluatedAt = state.evaluation ? state.evaluation.evaluatedAt : null;
  saveUiState();
}

function buildSeriesCheckbox(entry) {
  const item = el("li");
  const label = el("label", "casilla-serie");
  const checkbox = el("input");
  checkbox.type = "checkbox";
  checkbox.checked = isSeriesSelected(entry.hex);
  const defaultNote = state.seriesNotes.get(entry.hex);
  checkbox.setAttribute("aria-label",
    "Incluir el color " + entry.hex + " como serie de datos en la recomendación" +
    (defaultNote ? " (desmarcado por defecto: " + defaultNote + ")" : ""));
  checkbox.addEventListener("change", () => {
    clearStatus();
    state.seriesSelection.set(entry.hex, checkbox.checked);
    persistSelection();
    // La selección alimenta la recomendación y las bandas; la matriz sigue con todo.
    updateSummary();
    renderRecommendation();
  });
  label.append(checkbox, swatch(entry.hex), el("span", "mono hex", entry.hex));
  if (defaultNote) label.append(el("span", "nota", defaultNote));
  item.append(label);
  return item;
}

/** Recalcula la selección por defecto cuando cambia la evaluación, respetando la guardada. */
function ensureSeriesSelection() {
  if (state.selectionSource === state.evaluation) return;
  state.selectionSource = state.evaluation;
  state.seriesSelection = new Map();
  state.seriesNotes = new Map();
  seriesSelectionList.replaceChildren();
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  const defaults = computeDefaultSelection(palette, state.series);
  const stored = state.ui.selection && state.evaluation && state.ui.selectionEvaluatedAt === state.evaluation.evaluatedAt
    ? state.ui.selection : null;
  for (const entry of state.series) {
    const decision = defaults.get(entry.hex) || { selected: true, note: null };
    const selected = stored && typeof stored[entry.hex] === "boolean" ? stored[entry.hex] : decision.selected;
    state.seriesSelection.set(entry.hex, selected);
    state.seriesNotes.set(entry.hex, decision.note);
    seriesSelectionList.append(buildSeriesCheckbox(entry));
  }
}

/** Muestra u oculta las casillas de series y sincroniza el botón «Ocultar»/«Revisar». */
function setSeriesPanelOpen(open, { focus = false } = {}) {
  seriesPanel.hidden = !open;
  seriesReview.setAttribute("aria-expanded", String(open));
  seriesReview.textContent = open ? "Ocultar" : "Revisar";
  if (open && focus) {
    const first = seriesSelectionList.querySelector("input");
    if (first) first.focus();
  }
}

// ------------------------------------------------------------------
// Previsualización
// ------------------------------------------------------------------

// La previsualización solo se aplica cuando el usuario enciende el
// interruptor; ningún render la reaplica por su cuenta. El interruptor
// refleja el estado real de la página: se consulta al content script al
// abrir el panel, volver a la pestaña, volver a evaluar, limpiar o cambiar
// de página.

function setPreviewSwitch(checked) {
  previewToggle.setAttribute("aria-checked", String(checked));
}

function resetPreviewUi() {
  state.previewActive = false;
  state.previewApplied = null;
  setPreviewSwitch(false);
}

/** Clave de una correspondencia original → propuesta, para saber si cambió. */
function mappingKey(recommendation) {
  return recommendation.mapping.map((entry) => entry.originalHex + ">" + entry.proposedHex).join(",");
}

/**
 * Aplica (active = true) o retira la previsualización en la página y deja
 * el interruptor como quedó la página. Con silent no escribe el mensaje
 * de estado, para que el llamador ponga el suyo.
 */
async function sendPreview(active, { silent = false } = {}) {
  const recommendation = state.recommendation;
  if (active && (!recommendation || recommendation.outcome !== "proposal")) return;
  const message = active
    ? {
      type: "PREVIEW_PALETTE", tabId: state.tabId,
      mapping: recommendation.mapping.map((entry) => ({ fromHex: entry.originalHex, toHex: entry.proposedHex }))
    }
    : { type: "CLEAR_PREVIEW", tabId: state.tabId };
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!active) {
      resetPreviewUi();
      if (!silent) setStatus("ok", "Previsualización retirada: la página recuperó sus colores originales.");
      return;
    }
    if (response && response.ok) {
      state.previewActive = true;
      state.previewApplied = { type: recommendation.deficiencyType, key: mappingKey(recommendation) };
      setPreviewSwitch(true);
      const extra = response.entriesWithoutElements
        ? " · " + response.entriesWithoutElements + " colores sin elementos recoloreables (canvas)" : "";
      if (!silent) setStatus("ok", "Previsualización aplicada: " + response.recolored + " propiedades recoloreadas" + extra + ".");
    } else {
      resetPreviewUi();
      setStatus("warning", response && response.error === "no-registry"
        ? "La página ya no conserva el registro color-elemento (¿se recargó?). Vuelve a pulsar «Volver a evaluar»."
        : "No se pudo aplicar la previsualización sobre esta página.");
    }
  } catch (error) {
    resetPreviewUi();
    setStatus("warning", "No se pudo comunicar con la página para la previsualización.");
  }
}

function stopPreviewIfActive() {
  if (state.previewActive) sendPreview(false);
  resetPreviewUi();
}

/**
 * Habilita o deshabilita el interruptor según haya elementos recoloreables
 * (DOM o SVG, en todos los marcos) con alguno de los colores de las series
 * consideradas. Sin ninguno (gráficos en canvas, WebGL, imagen) o con la
 * simulación por captura, el interruptor queda deshabilitado y la nota lo
 * explica; con algunos recoloreables y otros en canvas, funciona y la nota
 * del HTML se mantiene. Evaluaciones antiguas sin recuento: disponible.
 */
function updatePreviewAvailability(selectedSeries) {
  const evaluation = state.evaluation;
  const counts = evaluation && evaluation.recolorable;
  const recolorable = counts ? selectedSeries.reduce((sum, color) => sum + (counts[color.hex] || 0), 0) : null;
  const unavailable = recolorable === 0 || state.simulationMode === "capture";
  previewToggle.disabled = unavailable;
  previewToggle.setAttribute("aria-disabled", String(unavailable));
  if (unavailable) {
    if (state.previewActive) stopPreviewIfActive();
    previewNote.textContent = PREVIEW_UNAVAILABLE_TEXT;
    previewNote.hidden = false;
    return;
  }
  previewNote.textContent = PREVIEW_CANVAS_TEXT;
  previewNote.hidden = !(evaluation.stats && evaluation.stats.canvasTotal > 0);
}

/**
 * La propuesta cambió (familia, series consideradas o umbral) con el
 * interruptor encendido y para la misma deficiencia: se refresca en la
 * página para que lo que se ve siga siendo lo que dice el panel. Si la
 * deficiencia es otra, no se toca: eso lo resuelve el cambio de tipo.
 */
function refreshPreviewIfChanged(recommendation) {
  if (!state.previewActive || !state.previewApplied) return;
  if (state.previewApplied.type !== recommendation.deficiencyType) return;
  if (state.previewApplied.key === mappingKey(recommendation)) return;
  sendPreview(true);
}

// ------------------------------------------------------------------
// Recomendación
// ------------------------------------------------------------------

function recommendationInput(deficiencyType, selectedSeries, seriesFailures) {
  return {
    seriesColors: selectedSeries.map((color) => ({ hex: color.hex, rgb: color.rgb })),
    backgroundRgb: dominantBackgroundRgb(),
    deficiencyType,
    family: state.family,
    threshold: state.threshold,
    originalGraphicsFailures: seriesFailures
  };
}

function setRecommendationHeading(title, reason) {
  recommendationTitle.textContent = title;
  recommendationReason.textContent = reason;
}

/** Aviso cuando alguna serie considerada quedó sin contraste evaluado. */
function unevaluatedText(count) {
  return "No se pudo evaluar el contraste de " + count + (count === 1 ? " serie considerada" : " series consideradas") +
    " (sin elemento ni fondo conocido): no se puede afirmar que la paleta cumpla.";
}

/**
 * Estado 1.4.11 de cada serie considerada: fila propia (elemento), fila
 * aproximada (canvas o captura contra el fondo dominante) o sin evaluar.
 * Una serie cuenta como evaluada si alguna fila de rol serie tiene su
 * primer plano a menos de ΔE00 2,5; pasa solo si todas sus filas pasan.
 */
function seriesContrastStatus(selectedSeries, contrast) {
  const rows = (contrast.graphics || []).filter((group) => (group.roles || []).includes("series"));
  const rowLabs = rows.map((group) => rgbToLab(group.foreground.rgb));
  const status = new Map();
  for (const color of selectedSeries) {
    const matches = rows.filter((group, index) => ciede2000(rowLabs[index], color.lab) < 2.5);
    if (!matches.length) {
      status.set(color.hex, { evaluated: false, passes: false, approximate: false, ratio: null });
      continue;
    }
    const worst = matches.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
    status.set(color.hex, {
      evaluated: true,
      passes: matches.every((group) => group.passes),
      approximate: matches.every((group) => group.approximate === true),
      ratio: worst.ratio
    });
  }
  return status;
}

/**
 * Una sola serie considerada: no hay pares que comparar, así que el
 * veredicto depende solo de su contraste contra el fondo. Cumple → tarjeta
 * «Cumple» con la nota; incumple o sin evaluar → sin recomendación.
 */
function renderSingleSeries(color, status, outsideFailures) {
  stopPreviewIfActive();
  state.overview = null;
  const note = "Una sola serie: no hay pares que comparar.";
  const hint = state.series.length >= 2 ? " Marca más series para compararlas." : "";
  if (status.evaluated && status.passes) {
    if (state.simulation.type === "none") {
      state.recommendation = null;
      renderRecommendationOverview([color], 0, { single: true });
      return;
    }
    const result = {
      outcome: "compliant",
      deficiencyType: state.simulation.type,
      threshold: state.threshold,
      minDelta: null,
      singleSeries: true,
      contrastApproximate: status.approximate ? 1 : 0
    };
    state.recommendation = result;
    renderCompliantCard(result, [color], SIMULATION_LABELS[state.simulation.type], { approximate: result.contrastApproximate, single: true });
    if (outsideFailures > 0) renderOutsideFailures(outsideFailures);
    renderPaletteExport(compliantExport, { title: "Paleta accesible", entries: [{ hex: color.hex }], paired: false });
    return;
  }
  state.recommendation = {
    outcome: "insufficient-series",
    singleSeries: true,
    unevaluatedSeries: status.evaluated ? 0 : 1,
    ratio: status.ratio
  };
  if (!status.evaluated) {
    setRecommendationHeading("Sin recomendación", note + " No se pudo evaluar su contraste contra el fondo." + hint);
    renderStatusInto(recommendationNotice, "warning", unevaluatedText(1));
    return;
  }
  setRecommendationHeading("Sin recomendación",
    note + " Su contraste contra el fondo incumple 3:1 (" + formatNumber(status.ratio) + ":1); el detalle está en Contraste." + hint);
}

function renderOutsideFailures(outsideFailures) {
  renderStatusInto(recommendationNotice, "warning",
    "Quedan " + outsideFailures + (outsideFailures === 1 ? " incumplimiento" : " incumplimientos") +
    " de contraste fuera del conjunto de series (texto, bordes, ejes): una paleta de series no puede corregirlos; el detalle está en Contraste.");
}

/**
 * Tarjeta «Cumple sin reemplazo» (diseño de la maqueta de cierre, v5):
 * sello, contexto, título, texto, dos bandas (visión típica y la
 * deficiencia a severidad máxima, en el mismo orden), tres cifras y la
 * regla del par más cercano frente al umbral, de 0 a 50 como la escala
 * de Distinguibilidad. Todo sale de la evaluación: nada es fijo salvo
 * los textos. Sustituye al título y al párrafo del esquema.
 */
function renderCompliantCard(result, selectedSeries, deficiency, { approximate = 0, single = false } = {}) {
  recommendationScheme.hidden = true;
  compliantCard.replaceChildren();
  const label = capitalize(deficiency);
  const config = { type: result.deficiencyType, severity: 1 };
  const count = selectedSeries.length;
  const threshold = result.threshold;
  const margin = single ? 0 : result.minDelta - threshold;
  const percent = (value) => (Math.min(value, SCALE_MAX) / SCALE_MAX) * 100 + "%";

  const head = el("div", "cabecera");
  head.append(el("span", "sello", "Cumple"), el("span", "contexto", label + " (severidad máxima)"));
  const title = el("h3", "", "Tu paleta ya es accesible");
  const lead = el("p", "lead", single
    ? "Una sola serie: no hay pares que comparar. Su contraste contra el fondo cumple 3:1 y no hace falta cambiar colores."
    : "Las " + count + " series se distinguen entre sí y ninguno de sus pares falla el contraste. No hace falta cambiar colores.");

  const bands = el("div", "bandas-cumple");
  const original = el("div", "banda");
  fillBand(original, selectedSeries.map((color) => color.hex));
  const simulated = el("div", "banda");
  fillBand(simulated, selectedSeries.map((color) => rgbToHex(simulateForConfig(color.rgb, config))));
  bands.append(el("span", "", "Visión típica"), original, el("span", "", label), simulated);

  const figures = el("div", "cifras-cumple");
  const tile = (value, text) => {
    const node = el("div", "cifra");
    node.append(el("span", "v mono", value), el("span", "e", text));
    return node;
  };
  figures.append(
    tile(single ? "—" : formatNumber(result.minDelta), "ΔE00 mínimo"),
    tile("0", "fallos de contraste"),
    tile(String(count), count === 1 ? "serie evaluada" : "series evaluadas")
  );

  // Series sin elemento (canvas o captura): su contraste se aproximó
  // contra el fondo dominante y la tarjeta lo declara.
  const note = approximate > 0
    ? el("p", "nota-cumple", "Contraste aproximado: " +
      (approximate === 1 ? "1 serie sin elemento se comparó" : approximate + " series sin elemento se compararon") +
      " con el fondo dominante.")
    : null;

  const ruler = el("div", "margen");
  const rulerTitle = el("div", "tit");
  rulerTitle.append(
    el("span", "", "Par más cercano frente al umbral " + formatNumber(threshold, 1)),
    el("b", "mono", (margin >= 0 ? "+" : "") + formatNumber(margin))
  );
  // La regla lleva aria-hidden: el margen ya va en texto.
  const track = el("div", "regla");
  track.setAttribute("aria-hidden", "true");
  const zone = el("div", "zona");
  zone.style.width = percent(threshold);
  const point = el("div", "punto");
  point.style.left = percent(result.minDelta);
  track.append(zone, point);
  const axis = el("div", "eje mono");
  axis.setAttribute("aria-hidden", "true");
  const tick = (value, left) => {
    const node = el("span", "", formatNumber(value, Number.isInteger(value) ? 0 : 1));
    node.style.left = left;
    return node;
  };
  axis.append(tick(0, "0"), tick(threshold, percent(threshold)), tick(SCALE_MAX, "100%"));
  ruler.append(rulerTitle, track, axis);

  compliantCard.append(head, title, lead, bands, figures);
  if (note) compliantCard.append(note);
  // Con una sola serie no hay par más cercano que situar en la regla.
  if (!single) compliantCard.append(ruler);
  compliantCard.hidden = false;
}

// ------------------------------------------------------------------
// Copiar colores y descargar el tema de Power BI (maqueta de copiar).
// Cada hex propuesto es un botón que copia solo el hex en mayúsculas;
// «Copiar todos» copia uno por línea en el orden de la tabla; el enlace
// descarga tema-accesible-powerbi.json (solo name y dataColors) con
// Blob y <a download>, sin permiso de descargas. Un único estado temporal
// («Copiado», «Copiados N colores», «Tema de Power BI descargado») a la
// vez, durante 2 s; otro clic reinicia el temporizador.
// ------------------------------------------------------------------

const FEEDBACK_MS = 2000;
const POWER_BI_THEME_NAME = "Paleta accesible - Evaluador cromatico";
const POWER_BI_THEME_FILE = "tema-accesible-powerbi.json";
const POWER_BI_NOTE =
  "Impórtalo en Power BI desde Diseño > Importar tema. Los colores se asignan por orden de serie y no cambian las series coloreadas a mano.";
let feedbackTimer = null;
let feedbackReset = null;

/** Muestra un estado temporal; el anterior se deshace antes para no mezclar estados. */
function showFeedback(apply, reset) {
  if (feedbackReset) {
    clearTimeout(feedbackTimer);
    feedbackReset();
  }
  apply();
  feedbackReset = reset;
  feedbackTimer = setTimeout(() => {
    reset();
    feedbackReset = null;
    feedbackTimer = null;
  }, FEEDBACK_MS);
}

async function copyText(text, statusElement) {
  try {
    await navigator.clipboard.writeText(text);
    statusElement.hidden = true;
    return true;
  } catch (error) {
    renderStatusInto(statusElement, "warning", "No se pudo copiar; selecciona el texto y cópialo con Ctrl+C");
    return false;
  }
}

/** Tema de Power BI: exactamente name y dataColors, con sangría de dos espacios. */
function powerBiTheme(hexes) {
  return "{\n  \"name\": \"" + POWER_BI_THEME_NAME + "\",\n  \"dataColors\": [" +
    hexes.map((hex) => "\"" + hex + "\"").join(", ") + "]\n}";
}

/** Descarga un archivo de texto con Blob y <a download>; revoca la URL después. */
function downloadTextFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Bloque «Paleta propuesta» / «Paleta accesible»: título con «Copiar
 * todos», tabla (original → propuesta, o solo los colores), descarga del
 * tema de Power BI, nota y región de estado para los errores.
 */
function renderPaletteExport(container, { title, entries, paired }) {
  container.replaceChildren();
  const hexes = entries.map((entry) => entry.hex.toUpperCase());
  const status = el("p", "estado");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;

  const head = el("div", "map-cab");
  const heading = el("h3", "", title);
  const copyAll = el("button", "btn-sm", "Copiar todos");
  copyAll.type = "button";
  copyAll.setAttribute("aria-label", "Copiar todos los colores de la paleta, uno por línea");
  copyAll.addEventListener("click", async () => {
    if (!(await copyText(hexes.join("\n"), status))) return;
    const text = hexes.length === 1 ? "Copiado 1 color" : "Copiados " + hexes.length + " colores";
    showFeedback(() => { copyAll.textContent = text; copyAll.classList.add("ok"); },
      () => { copyAll.textContent = "Copiar todos"; copyAll.classList.remove("ok"); });
    announce(text);
  });
  head.append(heading, copyAll);

  const table = el("div", "map" + (paired ? "" : " map--simple"));
  const header = el("div", "cab-t");
  header.setAttribute("aria-hidden", "true");
  if (paired) header.append(el("span", "", "Original"), el("span", "", "Propuesta"));
  else header.append(el("span", "", "Series consideradas"));
  table.append(header);
  entries.forEach((entry, index) => {
    const hex = hexes[index];
    const row = el("div", "r");
    if (paired) {
      const original = el("div", "orig");
      original.append(swatch(entry.originalHex), el("span", "mono", entry.originalHex));
      row.append(original);
    }
    const button = el("button", "hex");
    button.type = "button";
    button.setAttribute("aria-label", "Copiar " + hex);
    const accent = el("span", "acc", "Copiar");
    button.append(swatch(hex), el("span", "mono", hex), accent);
    button.addEventListener("click", async () => {
      if (!(await copyText(hex, status))) return;
      showFeedback(() => { accent.textContent = "Copiado"; button.classList.add("ok"); },
        () => { accent.textContent = "Copiar"; button.classList.remove("ok"); });
      announce("Copiado " + hex);
    });
    row.append(button);
    table.append(row);
  });

  const pbi = el("div", "pbi");
  const download = el("button", "enlace", "Descargar tema de Power BI (.json)");
  download.type = "button";
  download.addEventListener("click", () => {
    try {
      downloadTextFile(POWER_BI_THEME_FILE, powerBiTheme(hexes), "application/json;charset=utf-8");
      status.hidden = true;
    } catch (error) {
      renderStatusInto(status, "warning", "No se pudo descargar el tema");
      return;
    }
    showFeedback(() => { download.textContent = "Tema de Power BI descargado"; download.classList.add("ok"); },
      () => { download.textContent = "Descargar tema de Power BI (.json)"; download.classList.remove("ok"); });
    announce("Descargado el tema de Power BI");
  });
  pbi.append(download, el("p", "nota", POWER_BI_NOTE));

  container.append(head, table, pbi, status);
  container.hidden = false;
}

function renderRecommendationOverview(selectedSeries, seriesFailures, { single = false } = {}) {
  recommendationOverview.replaceChildren();
  recommendationOverview.hidden = false;
  state.overview = [];
  for (const type of ["protanopia", "deuteranopia", "tritanopia"]) {
    // Una sola serie que cumple contraste: «Cumple» sin ΔE00 que medir.
    const result = single
      ? { outcome: "compliant", minDelta: null, singleSeries: true }
      : recommendPalette(recommendationInput(type, selectedSeries, seriesFailures));
    state.overview.push({
      type,
      outcome: result.outcome,
      schemeName: result.scheme ? result.scheme.name : null,
      minDelta: typeof result.minDelta === "number" ? result.minDelta : null,
      seriesCount: result.seriesCount || null,
      maxAvailable: result.maxAvailable || null,
      exhausted: result.exhausted === true
    });
    const row = el("div", "ov");
    row.append(el("span", "", capitalize(SIMULATION_LABELS[type])));
    let pill;
    let detail;
    if (result.outcome === "compliant") {
      pill = verdictPill("cumple", "Cumple");
      detail = result.minDelta === null ? "una sola serie: sin pares que comparar"
        : "ΔE00 mínimo " + formatNumber(result.minDelta) + " sin reemplazo";
    } else if (result.outcome === "proposal") {
      pill = verdictPill("neutra", "Propuesta");
      detail = "esquema " + result.scheme.name;
    } else if (result.outcome === "redesign") {
      pill = verdictPill("aviso", "Rediseño");
      detail = result.exhausted ? "ningún esquema superó la revalidación"
        : result.seriesCount + " series frente a " + result.maxAvailable + " disponibles";
    } else {
      pill = verdictPill("neutra", "Sin datos");
      detail = "se necesitan al menos dos series consideradas";
    }
    row.append(el("span", "qd", detail), pill);
    recommendationOverview.append(row);
  }
  setRecommendationHeading("Sin simulación en esta pestaña",
    "Desenlace bajo cada deficiencia a severidad máxima. Elige una en «Tipo de deficiencia» para ver la propuesta completa y previsualizarla.");
}

function renderRecommendation() {
  const evaluation = state.evaluation;
  if (!evaluation || !evaluation.ok) {
    recommendationSection.hidden = true;
    resetPreviewUi();
    return;
  }
  recommendationSection.hidden = false;
  familySelect.value = state.family;
  syncFieldValue(familySelect);
  ensureSeriesSelection();
  recommendationOverview.hidden = true;
  recommendationNotice.hidden = true;
  recommendationBody.hidden = true;
  recommendationScheme.hidden = false;
  compliantCard.hidden = true;
  compliantExport.hidden = true;

  const selectedSeries = state.series.filter((color) => isSeriesSelected(color.hex));
  seriesSummary.textContent = selectedSeries.length + " de " + state.series.length +
    (state.series.length === 1 ? " serie considerada" : " series consideradas");

  // Sin colores de datos (ninguna serie cromática en los gráficos y nada
  // marcado a mano) no hay nada que recomendar: se dice, sin «Cumple».
  const dataCandidates = state.series.filter((color) => !state.seriesNotes.get(color.hex));
  state.noDataColors = dataCandidates.length === 0 && selectedSeries.length === 0;
  if (state.noDataColors) {
    stopPreviewIfActive();
    state.recommendation = null;
    state.overview = null;
    state.noDataKind = noDataKind(evaluation);
    const [heading, text] = NO_DATA_HEADINGS[state.noDataKind];
    setRecommendationHeading(heading, text);
    return;
  }

  const contrast = evaluation.contrast || { text: [], graphics: [] };
  const selectedLabs = selectedSeries.map((color) => color.lab);
  const totalFailures =
    (contrast.text || []).filter((group) => !group.passes).length +
    (contrast.graphics || []).filter((group) => !group.passes).length;
  // Salida temprana de la recomendación: solo fallos 1.4.11 de rol serie
  // cuyo primer plano coincide (ΔE00 < 2,5) con una serie considerada.
  const seriesFailures = (contrast.graphics || []).filter((group) =>
    !group.passes && (group.roles || []).includes("series") &&
    selectedLabs.some((lab) => ciede2000(rgbToLab(group.foreground.rgb), lab) < 2.5)).length;
  const outsideFailures = totalFailures - seriesFailures;

  // «Cumple» exige que el contraste de TODAS las series consideradas se
  // haya evaluado y pase: las series sin fila (ni propia ni aproximada)
  // bloquean la salida temprana igual que un fallo, y se avisa.
  const seriesStatus = seriesContrastStatus(selectedSeries, contrast);
  const unevaluated = selectedSeries.filter((color) => !seriesStatus.get(color.hex).evaluated).length;
  const approximateSeries = selectedSeries.filter((color) => seriesStatus.get(color.hex).approximate).length;
  const blockers = seriesFailures + unevaluated;

  // Series que vienen solo de la captura: la extensión no puede saber
  // cuáles son iconos; la nota junto a las casillas lo dice.
  seriesCaptureNote.hidden = !state.series.some((color) =>
    (color.levels || []).includes("capture") && !(color.levels || []).includes("dom-svg"));

  if (selectedSeries.length === 1) {
    renderSingleSeries(selectedSeries[0], seriesStatus.get(selectedSeries[0].hex), outsideFailures);
    return;
  }

  if (state.simulation.type === "none") {
    stopPreviewIfActive();
    state.recommendation = null;
    renderRecommendationOverview(selectedSeries, blockers);
    return;
  }
  state.overview = null;

  const result = recommendPalette(recommendationInput(state.simulation.type, selectedSeries, blockers));
  result.unevaluatedSeries = unevaluated;
  result.contrastApproximate = approximateSeries;
  state.recommendation = result;
  const deficiency = SIMULATION_LABELS[result.deficiencyType] || SIMULATION_LABELS[state.simulation.type];

  if (result.outcome === "insufficient-series") {
    stopPreviewIfActive();
    setRecommendationHeading("Series insuficientes",
      state.series.length >= 2 ? "Marca al menos dos series consideradas para recomendar una paleta."
        : "Se necesitan al menos dos colores de serie para recomendar una paleta.");
    return;
  }
  if (result.outcome === "compliant") {
    stopPreviewIfActive();
    renderCompliantCard(result, selectedSeries, deficiency, { approximate: approximateSeries });
    if (outsideFailures > 0) renderOutsideFailures(outsideFailures);
    // La paleta que ya cumple también se puede copiar y llevar a Power BI.
    renderPaletteExport(compliantExport, { title: "Paleta accesible", entries: selectedSeries.map((color) => ({ hex: color.hex })), paired: false });
    return;
  }
  if (result.outcome === "redesign") {
    stopPreviewIfActive();
    const familyLabel = result.family === "sequential" ? "secuencial" : "categórico";
    setRecommendationHeading("Rediseño recomendado", result.exhausted
      ? "Ningún esquema " + familyLabel + " acreditado superó la revalidación con " + result.seriesCount +
      " series y umbral " + formatNumber(state.threshold, 1) + " (se probaron " + result.attempts.length + ")."
      : "El dashboard tiene " + result.seriesCount + " series y el mayor esquema " + familyLabel + " acreditado para " +
      deficiency + " dispone de " + result.maxAvailable + " colores.");
    renderStatusInto(recommendationNotice, "warning",
      (unevaluated > 0 ? unevaluatedText(unevaluated) + " " : "") +
      "Se recomienda reducir series, agrupar categorías o reforzar con etiquetas y formas.");
    return;
  }

  // Propuesta.
  setRecommendationHeading(result.scheme.name,
    "Primer esquema acreditado para " + deficiency + " con capacidad " + result.scheme.size + " ≥ " +
    result.mapping.length + " series que superó la revalidación.");
  if (unevaluated > 0) renderStatusInto(recommendationNotice, "warning", unevaluatedText(unevaluated));
  kpiIterations.textContent = String(result.revalidation.iterations);
  kpiSwaps.textContent = String(result.revalidation.swaps);
  kpiDelta.textContent = formatNumber(result.revalidation.minDelta);
  fillBand(bandRecOriginal, result.mapping.map((entry) => entry.originalHex));
  fillBand(bandRecProposed, result.mapping.map((entry) => entry.proposedHex));

  renderPaletteExport(proposalExport, {
    title: "Paleta propuesta",
    entries: result.mapping.map((entry) => ({ originalHex: entry.originalHex, hex: entry.proposedHex })),
    paired: true
  });
  updatePreviewAvailability(selectedSeries);
  recommendationBody.hidden = false;
  refreshPreviewIfChanged(result);
}

// ------------------------------------------------------------------
// Orquestación
// ------------------------------------------------------------------

function render() {
  const evaluation = state.evaluation;
  renderTabState();
  if (!evaluation || !evaluation.ok) {
    emptyState.hidden = false;
    summaryBlock.hidden = true;
    paletteSection.hidden = true;
    contrastSection.hidden = true;
    distSection.hidden = true;
    approximateNotice.hidden = true;
    truncatedNotice.hidden = true;
    recommendationSection.hidden = true;
    exportButton.hidden = true;
    resetPreviewUi();
    setEvaluateButtonState(false);
    return;
  }

  emptyState.hidden = true;
  exportButton.hidden = false;
  paletteSection.hidden = false;
  contrastSection.hidden = false;
  distSection.hidden = false;
  approximateNotice.hidden = evaluation.approximate !== true;
  truncatedNotice.hidden = !(evaluation.stats && evaluation.stats.truncated === true);

  const paletteSize = (evaluation.palette || []).length;
  paletteCount.textContent = paletteSize + (paletteSize === 1 ? " color" : " colores");
  const levelNames = (evaluation.levels || []).map((level) => LEVEL_LABELS[level] || level);
  const frames = evaluation.stats && evaluation.stats.frames > 1 ? " · " + evaluation.stats.frames + " marcos" : "";
  levelsElement.textContent = "Extracción: " + (levelNames.join(" + ") || "ninguna") + frames + ".";

  renderPalette();
  const contrast = evaluation.contrast || { text: [], graphics: [] };
  renderPairList(textPairsList, contrast.text, "text", "No se encontraron pares de texto evaluables.");
  renderPairList(graphicPairsList, contrast.graphics, "graphic", "No se encontraron objetos gráficos evaluables.");
  const failingContrast =
    (contrast.text || []).filter((group) => !group.passes).length +
    (contrast.graphics || []).filter((group) => !group.passes).length;
  contrastCount.textContent = failingContrast === 0 ? "todo cumple"
    : failingContrast + (failingContrast === 1 ? " incumple" : " incumplen");

  renderDistinguishability();

  const conflictCount = state.distSimulated ? state.distSimulated.conflicts.length : 0;
  announce("Evaluación terminada: " + failingContrast +
    (failingContrast === 1 ? " par de contraste incumple" : " pares de contraste incumplen") +
    " y " + conflictCount + (conflictCount === 1 ? " par de series confundible" : " pares de series confundibles") + ".");

  const adopted = state.suggestionAdopted;
  state.suggestionAdopted = null;
  if (adopted) {
    setStatus("info", "Se aplicó la última simulación usada (" + SIMULATION_LABELS[adopted.type] +
      (adopted.type === "tritanopia" ? "" : " " + formatNumber(adopted.severity, 1)) +
      ") como valor sugerido; cámbiala en «Tipo de deficiencia» si no la quieres.", "simulation");
  }
  setEvaluateButtonState(true);
}

async function runEvaluation() {
  evaluateButton.disabled = true;
  evaluateButton.textContent = "Analizando la página…";
  document.querySelector("main").setAttribute("aria-busy", "true");
  clearStatus();
  announce("Analizando la página…");
  try {
    if (state.simulation.type === "none") {
      const suggested = await loadSuggestedSimulation();
      if (suggested) {
        state.simulation = suggested;
        state.suggestionAdopted = suggested;
        persistTabSimulation();
        updateSimulationControls();
        await syncPageFilter({ announce: false });
      }
    }
    // La previsualización se retira antes de leer y queda apagada después:
    // la recomendación nueva se muestra sin aplicarla.
    if (state.previewActive) await sendPreview(false, { silent: true });
    const response = await chrome.runtime.sendMessage({ type: "RUN_EVALUATION", tabId: state.tabId });
    if (!response) {
      setStatus("error", ERROR_MESSAGES.unexpected);
      return;
    }
    if (!response.ok) {
      let text = ERROR_MESSAGES[response.error] || ERROR_MESSAGES.unexpected;
      if (response.error === "injection-failed" && response.isFileUrl) {
        text = "No se pudo acceder a este archivo local. Activa «Permitir acceso a URL de archivo» para esta extensión en chrome://extensions.";
      }
      if (response.error === "unsupported-page" && response.url) {
        const shortUrl = response.url.length > 60 ? response.url.slice(0, 57) + "…" : response.url;
        text += " Pestaña activa: " + shortUrl + ". Cambia a la pestaña del dashboard y vuelve a intentarlo.";
      }
      setStatus("error", text);
      return;
    }
    if (!response.palette || response.palette.length === 0) {
      setStatus("info", "No se detectó ningún color en esta página.");
      return;
    }
    state.evaluation = response;
    // Evaluación nueva: todas las secciones vuelven a salir abiertas.
    state.ui.collapsed = {};
    saveUiState();
    restoreSectionState();
    render();
    // El interruptor queda como esté la página de verdad (apagado).
    await reconcilePageState();
  } catch (error) {
    setStatus("error", "No se pudo comunicar con el proceso en segundo plano. Vuelve a intentarlo.");
  } finally {
    evaluateButton.disabled = false;
    document.querySelector("main").setAttribute("aria-busy", "false");
    setEvaluateButtonState(!!(state.evaluation && state.evaluation.ok));
  }
}

/** Pregunta a la página qué filtro y previsualización tiene y alinea el panel. */
async function reconcilePageState() {
  let filter = { active: false, config: null };
  let previewActive = false;
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_PAGE_STATE", tabId: state.tabId });
    if (response && response.filter) filter = response.filter;
    previewActive = !!(response && response.previewActive);
  } catch (error) {
    // Sin respuesta: se asume página limpia.
  }
  if (filter.active && filter.config && filter.config.type in SIMULATION_LABELS) {
    state.simulation = { type: filter.config.type, severity: typeof filter.config.severity === "number" ? filter.config.severity : 1 };
    state.filterOnPage = true;
    state.simulationMode = filter.mode === "capture" ? "capture" : "filter";
  } else {
    // La página no tiene filtro ni capa: el selector vuelve a «Ninguna».
    state.filterOnPage = false;
    state.simulationMode = "filter";
    if (state.simulation.type !== "none") state.simulation = { type: "none", severity: state.simulation.severity };
  }
  persistTabSimulation();
  state.previewActive = previewActive;
  // Si la página tiene la previsualización, lo aplicado es la propuesta
  // vigente de esta deficiencia (si no hay propuesta, se desconoce).
  const recommendation = state.recommendation;
  state.previewApplied = previewActive && recommendation && recommendation.outcome === "proposal"
    ? { type: recommendation.deficiencyType, key: mappingKey(recommendation) }
    : null;
  setPreviewSwitch(previewActive);
  updateSimulationControls();
}

async function loadEvaluation() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab && tab.id ? tab.id : null;
    if (!state.tabId) {
      state.evaluation = null;
      render();
      return;
    }
    const stored = await chrome.storage.session.get(["evaluation:" + state.tabId, "ui:" + state.tabId]);
    state.evaluation = stored["evaluation:" + state.tabId] || null;
    const ui = stored["ui:" + state.tabId];
    if (ui && typeof ui === "object") {
      state.ui = {
        family: ui.family || null,
        collapsed: ui.collapsed || {},
        scrollY: typeof ui.scrollY === "number" ? ui.scrollY : 0,
        selection: ui.selection || null,
        selectionEvaluatedAt: ui.selectionEvaluatedAt || null
      };
    }
    state.family = state.ui.family === "sequential" ? "sequential" : "qualitative";
    await loadTabSimulation();
  } catch (error) {
    state.evaluation = null;
  }
  state.selectionSource = null;
  restoreSectionState();
  updateSimulationControls();
  render();
  await reconcilePageState();
  renderPalette();
  renderDistinguishability();
  if (!state.evaluation) {
    announce("Pestaña sin evaluar. Pulsa «Extraer paleta y evaluar».");
  } else if (state.ui.scrollY > 0) {
    window.scrollTo({ top: state.ui.scrollY, behavior: "auto" });
  }
}

// ------------------------------------------------------------------
// Eventos
// ------------------------------------------------------------------

evaluateButton.addEventListener("click", runEvaluation);

// Campos rellenos: el valor visible sigue al select en cada cambio.
for (const select of [deficiencySelect, familySelect]) {
  select.addEventListener("change", () => syncFieldValue(select));
  syncFieldValue(select);
}

// RF08: «Exportar PDF» abre el reporte como página propia
// de la extensión en una pestaña nueva, con los datos pasados por el
// almacenamiento de sesión; esa página lanza el diálogo de impresión y el
// PDF lo genera el propio navegador (Guardar como PDF).
exportButton.addEventListener("click", async () => {
  clearStatus();
  const evaluation = state.evaluation;
  if (!evaluation || !evaluation.ok) return;
  const data = buildReportData({
    evaluation,
    extensionVersion: chrome.runtime.getManifest().version,
    simulation: state.simulation,
    threshold: state.threshold,
    family: state.family,
    series: state.series,
    selection: state.seriesSelection,
    notes: state.seriesNotes,
    simulatedRgbs: state.simulatedRgbs,
    distSimulated: state.distSimulated,
    distOriginal: state.distOriginal,
    recommendation: state.recommendation,
    overview: state.overview,
    noDataColors: state.noDataColors,
    noDataKind: state.noDataKind
  });
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  try {
    await chrome.storage.session.set({ ["report:" + id]: data });
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/ui/reporte/reporte.html?id=" + id) });
    setStatus("ok", "Reporte abierto en una pestaña nueva. Guárdalo eligiendo «Guardar como PDF» en el diálogo de impresión.");
  } catch (error) {
    setStatus("error", "No se pudo abrir la pestaña del reporte. Vuelve a intentarlo.");
  }
});

clearButton.addEventListener("click", async () => {
  clearStatus();
  if (state.previewActive) {
    try { await chrome.runtime.sendMessage({ type: "CLEAR_PREVIEW", tabId: state.tabId }); } catch (error) { /* sin página */ }
  }
  if (state.filterOnPage) {
    try { await chrome.runtime.sendMessage({ type: "CLEAR_SIMULATION", tabId: state.tabId }); } catch (error) { /* sin página */ }
  }
  resetPreviewUi();
  state.simulation = { type: "none", severity: 1 };
  state.filterOnPage = false;
  state.simulationMode = "filter";
  if (state.tabId) {
    try {
      await chrome.storage.session.remove(["evaluation:" + state.tabId, "ui:" + state.tabId, "sim:" + state.tabId]);
    } catch (error) { /* sin sesión */ }
    try { await chrome.action.setBadgeText({ text: "", tabId: state.tabId }); } catch (error) { /* sin insignia */ }
  }
  state.evaluation = null;
  state.selectionSource = null;
  state.ui = { family: null, collapsed: {}, scrollY: 0, selection: null, selectionEvaluatedAt: null };
  render();
  updateSimulationControls();
  // Lo que diga la página manda: si algo no se pudo retirar, el panel lo muestra.
  await reconcilePageState();
  setStatus("ok", "Todo limpio: simulación, previsualización y evaluación retiradas.");
});

// Cambiar el tipo con la previsualización activa la retira (en todos los
// marcos y en la capa por captura), deja el interruptor apagado y lo dice;
// la recomendación se recalcula para el tipo nuevo sin aplicarse.
deficiencySelect.addEventListener("change", async () => {
  clearStatus();
  const previous = state.simulation.type;
  const next = deficiencySelect.value in SIMULATION_LABELS ? deficiencySelect.value : "none";
  const hadPreview = state.previewActive && next !== previous;
  if (hadPreview) await sendPreview(false, { silent: true });
  state.simulation.type = next;
  onSimulationChanged();
  if (hadPreview && next !== "none") {
    setStatus("info", "Cambiaste a " + SIMULATION_LABELS[next] + ": se retiró la previsualización. La recomendación se recalculó para " +
      SIMULATION_LABELS[next] + "; actívala de nuevo para verla.");
  } else if (hadPreview) {
    setStatus("ok", "Previsualización retirada: la página recuperó sus colores originales.");
  }
});

severitySlider.addEventListener("input", () => {
  clearStatus();
  state.simulation.severity = Number(severitySlider.value);
  onSimulationChanged();
});

familySelect.addEventListener("change", () => {
  clearStatus();
  state.family = familySelect.value === "sequential" ? "sequential" : "qualitative";
  state.ui.family = state.family;
  saveUiState();
  renderRecommendation();
});

// «Ocultar»/«Revisar»: pliega o abre las casillas de series consideradas;
// como con las secciones, el plegado se recuerda solo en esta pestaña.
seriesReview.addEventListener("click", () => {
  clearStatus();
  const open = seriesPanel.hidden;
  setSeriesPanelOpen(open, { focus: true });
  if (open) delete state.ui.collapsed.series;
  else state.ui.collapsed.series = true;
  saveUiState();
});

previewToggle.addEventListener("click", () => {
  clearStatus();
  sendPreview(previewToggle.getAttribute("aria-checked") !== "true");
});

thresholdInput.addEventListener("input", () => {
  clearStatus();
  const value = Number(thresholdInput.value);
  if (Number.isFinite(value) && value >= 1 && value <= 30) {
    state.threshold = value;
    renderDistinguishability();
  }
});

// Selector de tema: clic elige; flechas mueven la selección.
themeGroup.addEventListener("click", (event) => {
  const radio = event.target.closest("[role=radio]");
  if (radio) chooseTheme(radio.dataset.tema);
});

themeGroup.addEventListener("keydown", (event) => {
  const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Enter"];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  if (event.key === " " || event.key === "Enter") {
    const radio = event.target.closest("[role=radio]");
    chooseTheme(radio ? radio.dataset.tema : effectiveTheme());
    return;
  }
  // Dos opciones: cualquier flecha pasa a la otra y mueve el foco.
  chooseTheme(effectiveTheme() === "claro" ? "oscuro" : "claro");
});

for (const section of document.querySelectorAll("details.bloque")) {
  section.addEventListener("toggle", () => {
    if (state.restoringSections || !section.dataset.section) return;
    // Solo se guardan las secciones plegadas; abrir una borra su clave
    // (el evento toggle llega en diferido, también tras una reapertura por código).
    if (section.open) delete state.ui.collapsed[section.dataset.section];
    else state.ui.collapsed[section.dataset.section] = true;
    saveUiState();
  });
}

window.addEventListener("scroll", scheduleScrollSave, { passive: true });

/**
 * La página de esta pestaña cambió (recarga, navegación o cambio de ruta):
 * el service worker ya retiró los efectos y descartó la evaluación; aquí
 * el selector vuelve a «Ninguna», el estado se vacía y se avisa.
 */
function onPageChanged() {
  state.simulation = { type: "none", severity: 1 };
  state.filterOnPage = false;
  state.simulationMode = "filter";
  resetPreviewUi();
  state.evaluation = null;
  state.selectionSource = null;
  state.ui = { family: null, collapsed: {}, scrollY: 0, selection: null, selectionEvaluatedAt: null };
  render();
  updateSimulationControls();
  setStatus("info", "La página cambió: se restableció «Ninguna» y se descartó la evaluación anterior.", "simulation");
  // Confirma con la página que filtro y previsualización ya no están.
  reconcilePageState();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && state.tabId && changes["cambio:" + state.tabId] && changes["cambio:" + state.tabId].newValue) {
    onPageChanged();
    return;
  }
  if (areaName === "session" && state.tabId && changes["evaluation:" + state.tabId]) {
    state.evaluation = changes["evaluation:" + state.tabId].newValue || null;
    render();
  }
  // El tema es global: un cambio desde otro panel se aplica aquí.
  if (areaName === "local" && changes.tema) {
    applyTheme(changes.tema.newValue || null);
  }
});

chrome.tabs.onActivated.addListener(() => {
  loadEvaluation();
});

/** Migra las claves de simulación de versiones anteriores a lastSimulation. */
async function migrateLocalStorage() {
  try {
    const stored = await chrome.storage.local.get(["lastSimulation", "simulationType", "simulationSeverity", "paletteFamily"]);
    if (!stored.lastSimulation && typeof stored.simulationType === "string" && stored.simulationType !== "none") {
      await chrome.storage.local.set({
        lastSimulation: {
          type: stored.simulationType,
          severity: typeof stored.simulationSeverity === "number" ? stored.simulationSeverity : 1
        }
      });
    }
    await chrome.storage.local.remove(["simulationType", "simulationSeverity", "paletteFamily"]);
  } catch (error) {
    // Sin almacenamiento: nada que migrar.
  }
}

(async function init() {
  thresholdInput.value = String(DEFAULT_CONFUSION_THRESHOLD);
  await loadTheme();
  await migrateLocalStorage();
  await loadEvaluation();
})();

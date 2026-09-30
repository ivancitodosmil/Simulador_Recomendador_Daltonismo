// ------------------------------------------------------------------
// Panel lateral (iteración 0.6.3): reproducción de la maqueta
// Pruebas/Docs/maqueta-panel.html con los datos reales de la
// evaluación. De arriba abajo: cabecera (logotipo, nombre, línea de
// estado, selector de tema), simulación siempre abierta con el botón
// de evaluar dentro, resumen (bandas de la paleta + marcador de cuatro
// datos), paleta, contraste y distinguibilidad plegables,
// recomendación y pie. Sin iconos ni glifos; ningún estado se comunica
// solo con color.
//
// Tema (0.6.3): mientras el usuario no elige, manda el sistema; la
// elección se guarda en chrome.storage.local (global) y se espeja en
// localStorage para que tema.js la aplique antes del primer pintado.
//
// Modelo por pestaña (0.6.0): panel habilitado por pestaña desde el
// service worker; la simulación de la página es por pestaña y su único
// control es el desplegable (elegir aplica, «Ninguna» retira);
// evaluation:/sim:/ui:<tabId> en chrome.storage.session; la
// reconciliación con la página (GET_PAGE_STATE) es la fuente de verdad.
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
const clearButton = byId("clear-button");
const exportButton = byId("export-button");
const statusElement = byId("panel-status");
const announcerElement = byId("panel-announcer");
const tabStateElement = byId("tab-state");
const themeGroup = byId("theme-group");
const themeRadios = Array.from(themeGroup.querySelectorAll("[role=radio]"));
const approximateNotice = byId("approximate-notice");
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
const recommendationTitle = byId("recommendation-title");
const recommendationReason = byId("recommendation-reason");
const recommendationNotice = byId("recommendation-notice");
const recommendationOverview = byId("recommendation-overview");
const recommendationBody = byId("recommendation-body");
const recommendationMapping = byId("recommendation-mapping");
const kpiIterations = byId("kpi-iterations");
const kpiSwaps = byId("kpi-swaps");
const kpiDelta = byId("kpi-delta");
const bandRecOriginal = byId("band-rec-original");
const bandRecProposed = byId("band-rec-proposed");
const familySelect = byId("family-select");
const seriesSummary = byId("series-summary");
const seriesReview = byId("series-review");
const seriesPanel = byId("series-panel");
const seriesSelectionList = byId("series-selection");
const previewToggle = byId("preview-toggle");
const previewNote = byId("preview-note");

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
  seriesSelection: new Map(),
  seriesNotes: new Map(),
  selectionSource: null,
  ui: { family: null, collapsed: {}, scrollY: 0, selection: null, selectionEvaluatedAt: null },
  restoringSections: false,
  suggestionAdopted: null,
  theme: null,
  // Desenlace bajo las tres deficiencias (sin simulación), para el reporte.
  overview: null
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
  themeRadios.forEach((radio, index) => {
    const checked = radio.dataset.tema === state.theme;
    radio.setAttribute("aria-checked", String(checked));
    // Tabulación itinerante: la elegida, o la primera si manda el sistema.
    radio.tabIndex = checked || (!state.theme && index === 0) ? 0 : -1;
  });
}

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

function scheduleScrollSave() {
  if (scrollSaveTimer) clearTimeout(scrollSaveTimer);
  scrollSaveTimer = setTimeout(() => {
    state.ui.scrollY = window.scrollY;
    saveUiState();
  }, 250);
}

function restoreSectionState() {
  state.restoringSections = true;
  for (const section of document.querySelectorAll("details.bloque")) {
    const key = section.dataset.section;
    if (!key) continue;
    // Sin preferencia guardada todas las secciones salen abiertas (0.6.6);
    // el plegado se recuerda solo en esta pestaña hasta volver a evaluar.
    const collapsed = state.ui.collapsed && typeof state.ui.collapsed[key] === "boolean"
      ? state.ui.collapsed[key]
      : false;
    section.open = !collapsed;
  }
  state.restoringSections = false;
}

// ------------------------------------------------------------------
// Estados: texto y forma
// ------------------------------------------------------------------

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

function setStatus(kind, text) {
  renderStatusInto(statusElement, kind, text);
}

function clearStatus() {
  statusElement.textContent = "";
  statusElement.hidden = true;
}

function announce(text) {
  announcerElement.textContent = "";
  setTimeout(() => { announcerElement.textContent = text; }, 50);
}

function verdictPill(kind, word) {
  return el("span", "pastilla pastilla--" + kind, word);
}

function setEvaluateButtonState(done) {
  evaluateButton.classList.toggle("prim", !done);
  evaluateButton.classList.toggle("secu", done);
  evaluateButton.textContent = done ? "Volver a evaluar" : "Extraer paleta y evaluar";
  evaluateButton.setAttribute(
    "aria-label",
    done ? "Volver a extraer la paleta y evaluar esta pestaña"
      : "Extraer la paleta de colores y evaluar la página actual"
  );
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
  severitySlider.value = String(severity);
  severityValue.textContent = formatNumber(severity, 1);
  const sliderDisabled = type === "tritanopia" || type === "none";
  severitySlider.disabled = sliderDisabled;
  severitySlider.setAttribute("aria-disabled", String(sliderDisabled));
  simulationHelp.textContent = type === "tritanopia" ? SIMULATION_HELP.tritanopia : SIMULATION_HELP.default;
  const label = type === "none" ? "Sin simulación" : capitalize(SIMULATION_LABELS[type]);
  simulatedHeader.textContent = label;
  bandSimulatedLabel.textContent = label;
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
 * Sincroniza el filtro de la PÁGINA con el desplegable: página simulada
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
        setStatus("warning", "La simulación no se pudo aplicar sobre esta página (no es accesible); la paleta simulada del panel sí se actualiza.");
      }
      return;
    }
    state.filterOnPage = shouldApply;
    if (!sayIt) return;
    announce(shouldApply
      ? "Simulación de " + SIMULATION_LABELS[type] + " aplicada sobre la página."
      : "Simulación retirada: la página recuperó sus colores originales.");
  } catch (error) {
    if (shouldApply) {
      state.filterOnPage = false;
      setStatus("warning", "No se pudo comunicar con la página para aplicar la simulación.");
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
  const parts = [" · " + group.count + (group.count === 1 ? " elemento" : " elementos")];
  if (group.largeText) parts.push("texto grande, umbral " + formatNumber(group.threshold, 1) + ":1");
  if (group.examples && group.examples.length) parts.push(group.examples.slice(0, 3).join(", "));
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
// Series consideradas (ajuste S4 + sprint 5)
// ------------------------------------------------------------------

function pageBackgroundEntry() {
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  const isPageElement = (example) => /^(body|html)($|[.#])/.test(example);
  return palette.find((color) => color.roles.includes("background") && (color.examples || []).some(isPageElement)) || null;
}

function dominantBackgroundRgb() {
  const pageBackground = pageBackgroundEntry();
  if (pageBackground) return pageBackground.rgb;
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  const backgrounds = palette.filter((color) => color.roles.includes("background"));
  return backgrounds.length ? backgrounds[0].rgb : { r: 255, g: 255, b: 255 };
}

// Descriptores de elementos estructurales de ejes y cuadrícula (D3/SVG).
const STRUCTURAL_EXAMPLE_PATTERN = /^(svg|g|line|path\.domain)$|\.(domain|tick|eje|grid|axis)($|\b)/i;

// Parámetros calibrados en vivo sobre los seis paneles del banco (sprint 5,
// bloque 1): piso de proporción 0,8 % (variantes de cola ≤ 0,79 %, series
// reales desde 0,80 %); absorción ΔE00 9,0 entre ORIGINALES (eslabón máximo
// medido 8,3; series reales bien espaciadas ≥ 14); croma mínimo C*ab 6
// (acromáticos de suavizado 0,4–2,5; serie real menos saturada ≈ 20).
// Solo se absorben colores SIN elemento; el absorbido queda desmarcado con
// su nota y puede volver a marcarse.
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
    else if (!hasElements && entry.share < SERIES_MIN_SHARE) {
      note = "proporción " + formatNumber(entry.share * 100) + " %, bajo el piso de " + formatNumber(SERIES_MIN_SHARE * 100, 1) + " %";
    } else if (!hasElements && entryChroma(entry) < SERIES_MIN_CHROMA) note = "acromático: suavizado de texto o ejes";
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

// ------------------------------------------------------------------
// Previsualización
// ------------------------------------------------------------------

function setPreviewSwitch(checked) {
  previewToggle.setAttribute("aria-checked", String(checked));
}

function resetPreviewUi() {
  state.previewActive = false;
  setPreviewSwitch(false);
}

async function sendPreview(active) {
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
      state.previewActive = false;
      setPreviewSwitch(false);
      setStatus("ok", "Previsualización retirada: la página recuperó sus colores originales.");
      return;
    }
    if (response && response.ok) {
      state.previewActive = true;
      setPreviewSwitch(true);
      const extra = response.entriesWithoutElements
        ? " · " + response.entriesWithoutElements + " colores sin elementos recoloreables (canvas)" : "";
      setStatus("ok", "Previsualización aplicada: " + response.recolored + " propiedades recoloreadas" + extra + ".");
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

function renderRecommendationOverview(selectedSeries, seriesFailures) {
  recommendationOverview.replaceChildren();
  recommendationOverview.hidden = false;
  state.overview = [];
  for (const type of ["protanopia", "deuteranopia", "tritanopia"]) {
    const result = recommendPalette(recommendationInput(type, selectedSeries, seriesFailures));
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
      detail = "ΔE00 mínimo " + formatNumber(result.minDelta) + " sin reemplazo";
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
  ensureSeriesSelection();
  recommendationOverview.hidden = true;
  recommendationNotice.hidden = true;
  recommendationBody.hidden = true;

  const selectedSeries = state.series.filter((color) => isSeriesSelected(color.hex));
  seriesSummary.textContent = selectedSeries.length + " de " + state.series.length +
    (state.series.length === 1 ? " serie considerada" : " series consideradas");

  const contrast = evaluation.contrast || { text: [], graphics: [] };
  const selectedLabs = selectedSeries.map((color) => color.lab);
  const totalFailures =
    (contrast.text || []).filter((group) => !group.passes).length +
    (contrast.graphics || []).filter((group) => !group.passes).length;
  // Salida temprana (sprint 5, bloque 2): solo fallos 1.4.11 de rol serie
  // cuyo primer plano coincide (ΔE00 < 2,5) con una serie considerada.
  const seriesFailures = (contrast.graphics || []).filter((group) =>
    !group.passes && (group.roles || []).includes("series") &&
    selectedLabs.some((lab) => ciede2000(rgbToLab(group.foreground.rgb), lab) < 2.5)).length;
  const outsideFailures = totalFailures - seriesFailures;

  if (state.simulation.type === "none") {
    stopPreviewIfActive();
    state.recommendation = null;
    renderRecommendationOverview(selectedSeries, seriesFailures);
    return;
  }
  state.overview = null;

  const result = recommendPalette(recommendationInput(state.simulation.type, selectedSeries, seriesFailures));
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
    setRecommendationHeading("Cumple sin reemplazo",
      "La paleta considerada cumple bajo " + deficiency + " a severidad máxima: sin fallos de contraste en sus pares y ΔE00 mínimo " +
      formatNumber(result.minDelta) + " (umbral " + formatNumber(result.threshold, 1) + ").");
    if (outsideFailures > 0) {
      renderStatusInto(recommendationNotice, "warning",
        "Quedan " + outsideFailures + (outsideFailures === 1 ? " incumplimiento" : " incumplimientos") +
        " de contraste fuera del conjunto de series (texto, bordes, ejes): una paleta de series no puede corregirlos; el detalle está en Contraste.");
    }
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
      "Se recomienda reducir series, agrupar categorías o reforzar con etiquetas y formas.");
    return;
  }

  // Propuesta.
  setRecommendationHeading(result.scheme.name,
    "Primer esquema acreditado para " + deficiency + " con capacidad " + result.scheme.size + " ≥ " +
    result.mapping.length + " series que superó la revalidación.");
  kpiIterations.textContent = String(result.revalidation.iterations);
  kpiSwaps.textContent = String(result.revalidation.swaps);
  kpiDelta.textContent = formatNumber(result.revalidation.minDelta);
  fillBand(bandRecOriginal, result.mapping.map((entry) => entry.originalHex));
  fillBand(bandRecProposed, result.mapping.map((entry) => entry.proposedHex));

  recommendationMapping.replaceChildren();
  for (const entry of result.mapping) {
    const row = el("div", "r");
    const original = el("div");
    original.append(swatch(entry.originalHex), el("span", "mono", entry.originalHex));
    const proposed = el("div");
    proposed.append(swatch(entry.proposedHex), el("span", "mono", entry.proposedHex));
    row.append(original, proposed);
    recommendationMapping.append(row);
  }
  previewNote.hidden = !(evaluation.stats && evaluation.stats.canvasTotal > 0);
  recommendationBody.hidden = false;
  if (state.previewActive) sendPreview(true);
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

  const paletteSize = (evaluation.palette || []).length;
  paletteCount.textContent = paletteSize + (paletteSize === 1 ? " color" : " colores");
  const levelNames = (evaluation.levels || []).map((level) => LEVEL_LABELS[level] || level);
  levelsElement.textContent = "Extracción: " + (levelNames.join(" + ") || "ninguna") + ".";

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
      ") como valor sugerido; cámbiala en «Tipo de deficiencia» si no la quieres.");
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
  } catch (error) {
    setStatus("error", "No se pudo comunicar con el proceso en segundo plano. Vuelve a intentarlo.");
  } finally {
    evaluateButton.disabled = false;
    document.querySelector("main").setAttribute("aria-busy", "false");
    setEvaluateButtonState(!!(state.evaluation && state.evaluation.ok));
  }
}

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
  } else {
    state.filterOnPage = false;
    if (state.simulation.type !== "none") state.simulation = { type: "none", severity: state.simulation.severity };
  }
  persistTabSimulation();
  state.previewActive = previewActive;
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

// HU08 / RF08 (0.6.5): «Exportar PDF» abre el reporte como página propia
// de la extensión en una pestaña nueva, con los datos pasados por el
// almacenamiento de sesión; esa página lanza el diálogo de impresión y el
// PDF lo genera el propio navegador (Guardar como PDF).
exportButton.addEventListener("click", async () => {
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
    overview: state.overview
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
  if (state.previewActive) {
    try { await chrome.runtime.sendMessage({ type: "CLEAR_PREVIEW", tabId: state.tabId }); } catch (error) { /* sin página */ }
  }
  if (state.filterOnPage) {
    try { await chrome.runtime.sendMessage({ type: "CLEAR_SIMULATION", tabId: state.tabId }); } catch (error) { /* sin página */ }
  }
  resetPreviewUi();
  state.simulation = { type: "none", severity: 1 };
  state.filterOnPage = false;
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
  setStatus("ok", "Todo limpio: simulación y previsualización retiradas y evaluación descartada.");
});

deficiencySelect.addEventListener("change", () => {
  state.simulation.type = deficiencySelect.value in SIMULATION_LABELS ? deficiencySelect.value : "none";
  onSimulationChanged();
});

severitySlider.addEventListener("input", () => {
  state.simulation.severity = Number(severitySlider.value);
  onSimulationChanged();
});

familySelect.addEventListener("change", () => {
  state.family = familySelect.value === "sequential" ? "sequential" : "qualitative";
  state.ui.family = state.family;
  saveUiState();
  renderRecommendation();
});

// «Revisar»: abre y cierra las casillas de series consideradas.
seriesReview.addEventListener("click", () => {
  const open = seriesPanel.hidden;
  seriesPanel.hidden = !open;
  seriesReview.setAttribute("aria-expanded", String(open));
  seriesReview.textContent = open ? "Ocultar" : "Revisar";
  if (open) {
    const first = seriesSelectionList.querySelector("input");
    if (first) first.focus();
  }
});

previewToggle.addEventListener("click", () => {
  sendPreview(previewToggle.getAttribute("aria-checked") !== "true");
});

thresholdInput.addEventListener("input", () => {
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
  const current = themeRadios.findIndex((radio) => radio.dataset.tema === state.theme);
  let next;
  if (event.key === " " || event.key === "Enter") {
    const radio = event.target.closest("[role=radio]");
    next = radio ? themeRadios.indexOf(radio) : 0;
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    next = current === -1 ? 0 : (current + 1) % themeRadios.length;
  } else {
    next = current === -1 ? themeRadios.length - 1 : (current - 1 + themeRadios.length) % themeRadios.length;
  }
  chooseTheme(themeRadios[next].dataset.tema);
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

chrome.storage.onChanged.addListener((changes, areaName) => {
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

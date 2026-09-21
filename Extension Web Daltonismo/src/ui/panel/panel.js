// ------------------------------------------------------------------
// Sprints 2-3 · Panel lateral unificado (ajuste de UX post-Sprint 3):
// concentra en una sola superficie los controles de simulación, el
// botón de evaluación, la paleta original/simulada y las dos
// evaluaciones (contraste WCAG y distinguibilidad CIEDE2000).
// El clic en el icono de la extensión abre este panel directamente
// (chrome.sidePanel.setPanelBehavior en el service worker).
// - La evaluación la orquesta el service worker (RUN_EVALUATION) y se
//   guarda por pestaña en chrome.storage.session.
// - La matriz se recalcula localmente al cambiar el umbral o la
//   simulación, sin repetir la extracción.
// - La configuración de simulación persiste en chrome.storage.local.
// ------------------------------------------------------------------

import { rgbToHex } from "../../core/color/conversion.js";
import {
  computeDistinguishability,
  simulateForConfig,
  DEFAULT_CONFUSION_THRESHOLD
} from "../../core/evaluacion/distinguibilidad.js";
import { recommendPalette } from "../../core/recomendacion/algoritmo.js";

const evaluateButton = document.getElementById("evaluate-button");
const statusElement = document.getElementById("panel-status");
const approximateNotice = document.getElementById("approximate-notice");
const emptyState = document.getElementById("empty-state");
const deficiencySelect = document.getElementById("deficiency-select");
const severitySlider = document.getElementById("severity-slider");
const severityValue = document.getElementById("severity-value");
const severityNote = document.getElementById("severity-note");
const paletteSection = document.getElementById("palette-section");
const paletteSummary = document.getElementById("palette-summary");
const levelsElement = document.getElementById("levels");
const simulatedHeader = document.getElementById("simulated-header");
const paletteList = document.getElementById("palette-list");
const contrastSection = document.getElementById("contrast-section");
const textPairsList = document.getElementById("text-pairs");
const graphicPairsList = document.getElementById("graphic-pairs");
const distSection = document.getElementById("distinguishability-section");
const distConfigElement = document.getElementById("distinguishability-config");
const thresholdInput = document.getElementById("threshold-input");
const matrixContainer = document.getElementById("matrix-container");
const seriesLegend = document.getElementById("series-legend");
const conflictList = document.getElementById("conflict-list");
const recommendationSection = document.getElementById("recommendation-section");
const recommendationStatus = document.getElementById("recommendation-status");
const recommendationBody = document.getElementById("recommendation-body");
const recommendationReason = document.getElementById("recommendation-reason");
const recommendationMapping = document.getElementById("recommendation-mapping");
const familySelect = document.getElementById("family-select");
const seriesSelectionList = document.getElementById("series-selection");
const previewToggle = document.getElementById("preview-toggle");
const previewNote = document.getElementById("preview-note");

const STATUS_ICONS = { info: "ℹ", ok: "✔", warning: "▲", error: "✖" };

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

const ROLE_LABELS = {
  background: "fondo",
  text: "texto",
  series: "serie",
  border: "borde"
};

const ERROR_MESSAGES = {
  "unsupported-page": "Esta página no se puede evaluar: es una página interna del navegador o de la tienda de extensiones.",
  "no-access": "La extensión aún no tiene acceso a esta pestaña. Haz clic en el icono de la extensión con esa pestaña en primer plano (permiso activeTab) y vuelve a pulsar «Extraer paleta y evaluar».",
  "no-active-tab": "No se encontró una pestaña activa que evaluar.",
  "injection-failed": "No se pudo acceder a la página para analizarla.",
  "extraction-failed": "La extracción falló dentro de la página.",
  "unexpected": "Ocurrió un error inesperado durante la evaluación."
};

// Máximo de series en la matriz (coherente con el service worker).
const MAX_SERIES_COLORS = 20;

const state = {
  tabId: null,
  evaluation: null,
  threshold: DEFAULT_CONFUSION_THRESHOLD,
  simulation: { type: "none", severity: 1 },
  // Última matriz calculada, para el detalle de pares.
  series: [],
  simulatedRgbs: [],
  distSimulated: null,
  distOriginal: null,
  // Recomendación de paleta (sprint 4).
  family: "qualitative",
  recommendation: null,
  previewActive: false,
  // Series consideradas: hex → incluido en la recomendación (ajuste S4).
  seriesSelection: new Map(),
  selectionSource: null
};

/** Número con coma decimal. */
function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals).replace(".", ",");
}

/** Pinta un estado (icono de forma distinta + texto) en el elemento dado. */
function renderStatusInto(element, kind, text) {
  element.className = "estado estado--" + kind;
  element.replaceChildren();
  const icon = document.createElement("span");
  icon.className = "estado-icono";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = STATUS_ICONS[kind] || STATUS_ICONS.info;
  const message = document.createElement("span");
  message.textContent = text;
  element.append(icon, message);
}

/** Estado principal del panel. */
function setStatus(kind, text) {
  renderStatusInto(statusElement, kind, text);
}

/** Estado del bloque de recomendación (cada desenlace con presentación propia). */
function setRecommendationStatus(kind, text) {
  renderStatusInto(recommendationStatus, kind, text);
}

/**
 * Estado del botón de evaluación. Tras una evaluación correcta pasa a
 * verde con texto «Evaluación aplicada» (color + texto + icono, nunca
 * solo color); sigue pulsable para volver a evaluar la misma pestaña.
 */
function setEvaluateButtonState(done) {
  evaluateButton.classList.toggle("boton--hecho", done);
  evaluateButton.textContent = done ? "Evaluación aplicada" : "Extraer paleta y evaluar";
  evaluateButton.setAttribute(
    "aria-label",
    done
      ? "Evaluación ya aplicada a esta pestaña; pulsar de nuevo vuelve a evaluarla"
      : "Extraer la paleta de colores y evaluar la página actual"
  );
}

/**
 * Actualiza la insignia numérica del icono con los incumplimientos
 * vigentes: fallos de contraste (fijos por evaluación) + pares
 * confundibles bajo la simulación y el umbral seleccionados AHORA.
 * Se invoca en cada recálculo, de modo que cambiar el tipo de
 * deficiencia refresca la insignia sin volver a evaluar la página.
 */
function updateBadge() {
  if (!state.tabId || !state.evaluation || !state.evaluation.ok) return;
  const contrast = state.evaluation.contrast || { text: [], graphics: [] };
  const failingContrast =
    (contrast.text || []).filter((group) => !group.passes).length +
    (contrast.graphics || []).filter((group) => !group.passes).length;
  const conflictCount = state.distSimulated ? state.distSimulated.conflicts.length : 0;
  const badgeText = String(failingContrast + conflictCount);
  chrome.action.setBadgeBackgroundColor({ color: "#965860", tabId: state.tabId }).catch(() => {});
  chrome.action.setBadgeText({ text: badgeText, tabId: state.tabId }).catch(() => {});
}

/** Muestra decorativa + hex como texto al lado. */
function colorChip(hex) {
  const chip = document.createElement("span");
  chip.className = "color-celda";
  const swatch = document.createElement("span");
  swatch.className = "muestra-color";
  swatch.style.backgroundColor = hex;
  swatch.setAttribute("aria-hidden", "true");
  const code = document.createElement("code");
  code.className = "hex";
  code.textContent = hex;
  chip.append(swatch, code);
  return chip;
}

// ------------------------------------------------------------------
// Simulación (controles integrados)
// ------------------------------------------------------------------

/** Simula un color según la configuración vigente (enrutador compartido). */
function simulateColor(rgb) {
  return simulateForConfig(rgb, state.simulation);
}

/** Sincroniza los controles y la cabecera de la columna simulada. */
function updateSimulationControls() {
  const { type, severity } = state.simulation;
  deficiencySelect.value = type;
  severitySlider.value = String(severity);
  severityValue.textContent = formatNumber(severity, 1);

  // La severidad solo tiene sentido en los tipos de Machado.
  const sliderDisabled = type === "tritanopia" || type === "none";
  severitySlider.disabled = sliderDisabled;
  severitySlider.setAttribute("aria-disabled", String(sliderDisabled));
  severityNote.hidden = type !== "tritanopia";

  if (type === "none") {
    simulatedHeader.textContent = "Simulada (sin simulación activa)";
  } else if (type === "tritanopia") {
    simulatedHeader.textContent = "Simulada · tritanopía";
  } else {
    simulatedHeader.textContent = "Simulada · " + SIMULATION_LABELS[type] + " " + formatNumber(severity, 1);
  }
}

/** Guarda la configuración de simulación (sobrevive al cierre del panel). */
function persistSimulation() {
  try {
    chrome.storage.local.set({
      simulationType: state.simulation.type,
      simulationSeverity: state.simulation.severity
    });
  } catch (error) {
    // Sin almacenamiento disponible se sigue funcionando en memoria.
  }
}

/** Recupera la configuración guardada al abrir el panel. */
async function loadStoredSimulation() {
  try {
    const stored = await chrome.storage.local.get(["simulationType", "simulationSeverity"]);
    if (typeof stored.simulationType === "string" && stored.simulationType in SIMULATION_LABELS) {
      state.simulation.type = stored.simulationType;
    }
    if (typeof stored.simulationSeverity === "number" && Number.isFinite(stored.simulationSeverity)) {
      state.simulation.severity = Math.min(1, Math.max(0, stored.simulationSeverity));
    }
  } catch (error) {
    // Se mantienen los valores por defecto.
  }
}

/** Recupera la familia de paleta seleccionada (paso 1 del algoritmo). */
async function loadStoredFamily() {
  try {
    const stored = await chrome.storage.local.get(["paletteFamily"]);
    if (stored.paletteFamily === "sequential" || stored.paletteFamily === "qualitative") {
      state.family = stored.paletteFamily;
    }
  } catch (error) {
    // Valor por defecto: cualitativa.
  }
}

/** Aplica (o retira) la simulación sobre la página, sin recargarla. */
async function applySimulationToPage() {
  const { type, severity } = state.simulation;
  const message =
    type === "none"
      ? { type: "CLEAR_SIMULATION" }
      : { type: "APPLY_SIMULATION", config: { type, severity } };
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (response && response.ok) {
      if (type === "none") {
        setStatus("ok", "Simulación desactivada: la página recuperó sus colores originales.");
      } else {
        setStatus("ok", "Simulación de " + SIMULATION_LABELS[type] + " aplicada a la página.");
      }
    } else {
      setStatus("warning", "La simulación no se pudo aplicar sobre esta página; la columna simulada del panel sí se actualiza.");
    }
  } catch (error) {
    setStatus("warning", "La simulación no se pudo aplicar sobre esta página; la columna simulada del panel sí se actualiza.");
  }
}

/** Reacción común a cualquier cambio de control: inmediata, sin confirmación. */
function onSimulationChanged() {
  persistSimulation();
  updateSimulationControls();
  renderPalette();
  renderDistinguishability();
  applySimulationToPage();
}

// ------------------------------------------------------------------
// Paleta original / simulada
// ------------------------------------------------------------------

/** Fila de la paleta: color original y su versión simulada en paralelo. */
function buildColorRow(color) {
  const row = document.createElement("li");
  row.className = "color-fila";

  const roles = color.roles.map((role) => ROLE_LABELS[role] || role).join(" · ");
  const share = (color.share * 100).toFixed(1).replace(".", ",") + " %";
  const examples = color.examples && color.examples.length ? " · " + color.examples.join(", ") : "";

  const original = colorChip(color.hex);
  const originalMeta = document.createElement("span");
  originalMeta.className = "color-meta";
  originalMeta.textContent = roles + " · " + share + examples;
  const originalCell = document.createElement("span");
  originalCell.className = "color-celda color-celda--vertical";
  originalCell.append(original, originalMeta);

  const simulatedCell = colorChip(rgbToHex(simulateColor(color.rgb)));

  row.append(originalCell, simulatedCell);
  return row;
}

/** Repinta la paleta con la simulación vigente. */
function renderPalette() {
  paletteList.replaceChildren();
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  for (const color of palette) {
    paletteList.append(buildColorRow(color));
  }
}

// ------------------------------------------------------------------
// Contraste WCAG
// ------------------------------------------------------------------

/** Etiqueta textual de veredicto con icono de forma distinta. */
function verdictLabel(passes) {
  const label = document.createElement("span");
  label.className = "estado-par " + (passes ? "estado-par--cumple" : "estado-par--incumple");
  const icon = document.createElement("span");
  icon.className = "estado-icono";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = passes ? "✔" : "✖";
  const text = document.createElement("span");
  text.textContent = passes ? "Cumple" : "Incumple";
  label.append(icon, text);
  return label;
}

/** Fila de un par de contraste: muestras, cifra obtenida y umbral exigido. */
function buildContrastRow(group) {
  const row = document.createElement("li");
  row.className = "par-fila";

  const colors = document.createElement("div");
  colors.className = "par-colores";
  colors.append(colorChip(group.foreground.hex));
  const over = document.createElement("span");
  over.className = "par-sobre";
  over.textContent = "sobre";
  colors.append(over, colorChip(group.background.hex));

  const figures = document.createElement("div");
  figures.className = "par-cifras";
  const ratioText = document.createElement("span");
  ratioText.textContent =
    formatNumber(group.ratio) + ":1 · exigido " + formatNumber(group.threshold, 1) + ":1";
  figures.append(ratioText);

  const meta = document.createElement("span");
  meta.className = "color-meta";
  const parts = [group.count + (group.count === 1 ? " elemento" : " elementos")];
  if (group.largeText) parts.push("texto grande");
  if (group.examples && group.examples.length) parts.push(group.examples.join(", "));
  meta.textContent = parts.join(" · ");
  figures.append(meta);

  row.append(colors, figures, verdictLabel(group.passes));
  return row;
}

/** Pinta un grupo de pares de contraste o su estado vacío. */
function renderPairList(listElement, groups, emptyText) {
  listElement.replaceChildren();
  if (!groups || groups.length === 0) {
    const item = document.createElement("li");
    item.className = "color-meta";
    item.textContent = emptyText;
    listElement.append(item);
    return;
  }
  for (const group of groups) {
    listElement.append(buildContrastRow(group));
  }
}

// ------------------------------------------------------------------
// Distinguibilidad
// ------------------------------------------------------------------

/** Identificador del desplegable de detalle de un par conflictivo. */
function conflictDetailId(i, j) {
  return "detalle-par-" + i + "-" + j;
}

/** Cuerpo del detalle de un par: colores, cifras y lectura. */
function buildConflictDetailBody(conflict) {
  const body = document.createElement("div");
  body.className = "detalle-cuerpo";
  const deltaSimulated = state.distSimulated.matrix[conflict.i][conflict.j];
  const deltaOriginal = state.distOriginal.matrix[conflict.i][conflict.j];

  for (const index of [conflict.i, conflict.j]) {
    const line = document.createElement("p");
    line.className = "detalle-linea";
    line.append(
      "Original ",
      colorChip(state.series[index].hex),
      " → simulado ",
      colorChip(rgbToHex(state.simulatedRgbs[index]))
    );
    body.append(line);
  }

  const figures = document.createElement("p");
  figures.textContent =
    "ΔE00 simulado: " + formatNumber(deltaSimulated) + " (umbral " + formatNumber(state.threshold, 1) +
    ") · ΔE00 en visión típica: " + formatNumber(deltaOriginal);
  body.append(figures);

  const reading = document.createElement("p");
  reading.className = "color-meta";
  reading.textContent = deltaOriginal >= state.threshold
    ? "Este par solo resulta confundible bajo la simulación: en visión típica su diferencia supera el umbral."
    : "Este par es confundible incluso sin simulación.";
  body.append(reading);
  return body;
}

/**
 * Abre el desplegable del par en su propia fila y lleva el foco hasta él
 * (lo usan las celdas conflictivas de la matriz).
 */
function openConflictDetail(i, j) {
  const details = document.getElementById(conflictDetailId(i, j));
  if (!details) return;
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "center" });
  const summary = details.querySelector("summary");
  if (summary) summary.focus();
}

/** Matriz de distinguibilidad como cuadrícula accesible. */
function renderMatrix() {
  matrixContainer.replaceChildren();
  const size = state.series.length;
  if (size < 2) return;

  const table = document.createElement("table");
  table.className = "matriz";
  const caption = document.createElement("caption");
  caption.className = "color-meta";
  caption.textContent =
    "ΔE00 entre series simuladas; las celdas marcadas con ✖ están por debajo del umbral " +
    formatNumber(state.threshold, 1) + ".";
  table.append(caption);

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  headRow.append(document.createElement("th"));
  for (let j = 0; j < size; j += 1) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = String(j + 1);
    headRow.append(th);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement("tbody");
  for (let i = 0; i < size; i += 1) {
    const row = document.createElement("tr");
    const rowHeader = document.createElement("th");
    rowHeader.scope = "row";
    rowHeader.append(String(i + 1) + " ", colorChip(state.series[i].hex));
    row.append(rowHeader);

    for (let j = 0; j < size; j += 1) {
      const cell = document.createElement("td");
      if (i === j) {
        cell.textContent = "";
        cell.className = "celda-diagonal";
      } else {
        const delta = state.distSimulated.matrix[i][j];
        if (delta < state.threshold) {
          // Celda conflictiva: botón con acceso al detalle del par.
          const button = document.createElement("button");
          button.type = "button";
          button.className = "celda-conflicto";
          button.textContent = formatNumber(delta, 1) + " ✖";
          button.setAttribute(
            "aria-label",
            "Par conflictivo " + state.series[i].hex + " y " + state.series[j].hex +
            ", diferencia simulada " + formatNumber(delta) + ", ver detalle"
          );
          button.addEventListener("click", () => openConflictDetail(Math.min(i, j), Math.max(i, j)));
          cell.append(button);
        } else {
          cell.textContent = formatNumber(delta, 1);
        }
      }
      row.append(cell);
    }
    body.append(row);
  }
  table.append(body);
  matrixContainer.append(table);
}

/** Leyenda numerada: original → simulada, con hex visible en ambas. */
function renderLegend() {
  seriesLegend.replaceChildren();
  state.series.forEach((color, index) => {
    const item = document.createElement("li");
    item.append(colorChip(color.hex), " → ", colorChip(rgbToHex(state.simulatedRgbs[index])));
    seriesLegend.append(item);
  });
}

/** Lista de pares conflictivos con acceso al detalle. */
function renderConflicts() {
  conflictList.replaceChildren();
  const conflicts = state.distSimulated ? state.distSimulated.conflicts : [];
  if (!conflicts.length) {
    const item = document.createElement("li");
    item.className = "color-meta";
    item.textContent = "Ningún par por debajo del umbral con la simulación seleccionada.";
    conflictList.append(item);
    return;
  }
  for (const conflict of conflicts) {
    const item = document.createElement("li");
    item.className = "par-fila";

    // El detalle vive en la propia fila como desplegable nativo: sin viajes
    // al fondo de la página y operable con teclado (summary es enfocable).
    const details = document.createElement("details");
    details.className = "detalle-plegable";
    details.id = conflictDetailId(conflict.i, conflict.j);

    const summary = document.createElement("summary");

    const colors = document.createElement("div");
    colors.className = "par-colores";
    colors.append(colorChip(state.series[conflict.i].hex));
    const versus = document.createElement("span");
    versus.className = "par-sobre";
    versus.textContent = "frente a";
    colors.append(versus, colorChip(state.series[conflict.j].hex));

    const figures = document.createElement("div");
    figures.className = "par-cifras";
    const deltaOriginal = state.distOriginal.matrix[conflict.i][conflict.j];
    const line = document.createElement("span");
    line.textContent =
      "ΔE00 simulado " + formatNumber(conflict.delta) + " · en visión típica " + formatNumber(deltaOriginal);
    const origin = document.createElement("span");
    origin.className = "color-meta";
    origin.textContent = deltaOriginal >= state.threshold
      ? "confundible solo bajo simulación"
      : "confundible también sin simulación";
    figures.append(line, origin);

    summary.append(colors, figures, verdictLabel(false));
    details.append(summary, buildConflictDetailBody(conflict));
    item.append(details);
    conflictList.append(item);
  }
}

// ------------------------------------------------------------------
// Recomendación de paleta (sprint 4)
// ------------------------------------------------------------------

/** Restablece el conmutador de previsualización (sin tocar la página). */
function resetPreviewUi() {
  state.previewActive = false;
  previewToggle.checked = false;
}

/**
 * Fondo de PÁGINA: la entrada con rol fondo cuyos elementos de origen son
 * body o html (la observación sintética blanca también apunta a body).
 * NUNCA se elige por peso: en un panel con muchas barras y chips de
 * leyenda, una serie puede acumular más peso de fondo que el blanco de la
 * página sin ser por ello el fondo del tablero (ajuste fino del Sprint 4).
 */
function pageBackgroundEntry() {
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  // Los descriptores de origen son tag(+#id|.clase): "body", "body.tema"…
  const isPageElement = (example) => /^(body|html)($|[.#])/.test(example);
  return (
    palette.find(
      (color) =>
        color.roles.includes("background") && (color.examples || []).some(isPageElement)
    ) || null
  );
}

/** Fondo dominante para la revalidación de contraste: el fondo de página;
    como respaldo, el rol fondo de mayor peso; blanco en último término. */
function dominantBackgroundRgb() {
  const pageBackground = pageBackgroundEntry();
  if (pageBackground) return pageBackground.rgb;
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  const backgrounds = palette.filter((color) => color.roles.includes("background"));
  return backgrounds.length ? backgrounds[0].rgb : { r: 255, g: 255, b: 255 };
}

// Descriptores de elementos estructurales de ejes y cuadrícula: piezas de
// D3/SVG que portan color pero no son categorías de datos. Coinciden con
// los "examples" que produce la consolidación: contenedores puros (svg, g),
// la línea de dominio del eje (path.domain), las líneas de tick (line) y
// cualquier clase de eje/cuadrícula (.tick, .domain, .eje, .grid, .axis).
const STRUCTURAL_EXAMPLE_PATTERN = /^(svg|g|line|path\.domain)$|\.(domain|tick|eje|grid|axis)($|\b)/i;

/**
 * Criterio de selección POR DEFECTO de una serie (ajuste del Sprint 4):
 * la casilla nace DESMARCADA cuando hay evidencia de que el color es
 * estructural y no una categoría de datos:
 *   a) su rol combina serie con TEXTO, o combina serie con FONDO siendo
 *      además el fondo DOMINANTE del tablero (el blanco de página que a
 *      la vez traza los sectores del pastel). El matiz "dominante" es
 *      deliberado: los chips de leyenda aportan rol de fondo al mismo
 *      hex de su serie, y desmarcar por cualquier fondo eliminaría a
 *      todas las series con leyenda; un fondo puntual es evidencia de
 *      categoría de datos, no de estructura.
 *   b) TODOS sus elementos de origen conocidos son piezas estructurales
 *      de ejes o cuadrícula (patrón de arriba: svg/g puros, path.domain,
 *      line de ticks, clases .tick/.eje/.grid/.axis).
 * En el resto nace MARCADA. Los colores sin elementos de origen (los
 * muestreados de canvas, con examples vacío) nacen marcados porque no
 * hay evidencia estructural: el negro de Okabe-Ito en un gráfico canvas
 * es una serie de datos legítima.
 */
function defaultSeriesSelected(entry, dominantBackgroundHex) {
  if (entry.roles.includes("text")) return false;
  if (entry.roles.includes("background") && entry.hex === dominantBackgroundHex) return false;
  const examples = entry.examples || [];
  if (examples.length && examples.every((example) => STRUCTURAL_EXAMPLE_PATTERN.test(example))) {
    return false;
  }
  return true;
}

/** ¿La serie está incluida en la recomendación? */
function isSeriesSelected(hex) {
  return state.seriesSelection.get(hex) !== false;
}

/** Casilla de una serie: operable con teclado, con aria-label y hex escrito. */
function buildSeriesCheckbox(entry) {
  const item = document.createElement("li");
  const label = document.createElement("label");
  label.className = "casilla-serie";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isSeriesSelected(entry.hex);
  checkbox.setAttribute(
    "aria-label",
    "Incluir el color " + entry.hex + " como serie de datos en la recomendación"
  );
  checkbox.addEventListener("change", () => {
    state.seriesSelection.set(entry.hex, checkbox.checked);
    // La selección alimenta únicamente a la recomendación: la matriz de
    // distinguibilidad sigue mostrando todas las series.
    renderRecommendation();
  });

  const swatch = document.createElement("span");
  swatch.className = "muestra-color";
  swatch.style.backgroundColor = entry.hex;
  swatch.setAttribute("aria-hidden", "true");

  const code = document.createElement("code");
  code.className = "hex";
  code.textContent = entry.hex;

  label.append(checkbox, swatch, code);
  item.append(label);
  return item;
}

/**
 * Reconstruye la selección (con sus valores por defecto) y sus casillas
 * SOLO cuando llega una evaluación nueva; los cambios manuales del
 * usuario sobreviven a los cambios de tipo, severidad, umbral o familia.
 */
function ensureSeriesSelection() {
  if (state.selectionSource === state.evaluation) return;
  state.selectionSource = state.evaluation;
  state.seriesSelection = new Map();
  seriesSelectionList.replaceChildren();

  // Solo el fondo de página (body/html) desmarca por la regla serie+fondo;
  // un rol de fondo que venga de elementos puntuales (chips de leyenda,
  // tarjetas) no desactiva la serie: esos colores nacen marcados.
  const pageBackground = pageBackgroundEntry();
  const dominantBackgroundHex = pageBackground ? pageBackground.hex : null;

  for (const entry of state.series) {
    state.seriesSelection.set(entry.hex, defaultSeriesSelected(entry, dominantBackgroundHex));
    seriesSelectionList.append(buildSeriesCheckbox(entry));
  }
}

/** Envía a la página la previsualización (aplicar) o su retirada. */
async function sendPreview(active) {
  const recommendation = state.recommendation;
  if (active && (!recommendation || recommendation.outcome !== "proposal")) return;
  const message = active
    ? {
        type: "PREVIEW_PALETTE",
        mapping: recommendation.mapping.map((entry) => ({
          fromHex: entry.originalHex,
          toHex: entry.proposedHex
        }))
      }
    : { type: "CLEAR_PREVIEW" };
  try {
    const response = await chrome.runtime.sendMessage(message);
    if (!active) {
      state.previewActive = false;
      setStatus("ok", "Previsualización retirada: la página recuperó sus colores originales.");
      return;
    }
    if (response && response.ok) {
      state.previewActive = true;
      const extra = response.entriesWithoutElements
        ? " · " + response.entriesWithoutElements + " colores sin elementos recoloreables (canvas)"
        : "";
      setStatus("ok", "Previsualización aplicada: " + response.recolored + " propiedades recoloreadas" + extra + ".");
    } else {
      resetPreviewUi();
      setStatus(
        "warning",
        response && response.error === "no-registry"
          ? "La página ya no conserva el registro color-elemento (¿se recargó?). Vuelve a pulsar «Extraer paleta y evaluar»."
          : "No se pudo aplicar la previsualización sobre esta página."
      );
    }
  } catch (error) {
    resetPreviewUi();
    setStatus("warning", "No se pudo comunicar con la página para la previsualización.");
  }
}

/** Apaga la previsualización si estaba activa (cambio de desenlace). */
function stopPreviewIfActive() {
  if (state.previewActive) {
    sendPreview(false);
  }
  resetPreviewUi();
}

/**
 * Calcula y pinta el bloque de recomendación con los datos ya evaluados
 * (sin repetir la evaluación). Tres desenlaces con presentación propia:
 * propuesta, cumplimiento sin reemplazo y aviso de rediseño.
 */
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

  const contrast = evaluation.contrast || { text: [], graphics: [] };
  const graphicsFailures = (contrast.graphics || []).filter((group) => !group.passes).length;

  // Entrada del algoritmo: solo las series marcadas como consideradas.
  const selectedSeries = state.series.filter((color) => isSeriesSelected(color.hex));

  const result = recommendPalette({
    seriesColors: selectedSeries.map((color) => ({ hex: color.hex, rgb: color.rgb })),
    backgroundRgb: dominantBackgroundRgb(),
    deficiencyType: state.simulation.type,
    family: state.family,
    threshold: state.threshold,
    originalGraphicsFailures: graphicsFailures
  });
  state.recommendation = result;
  recommendationBody.hidden = true;

  if (result.outcome === "no-deficiency") {
    stopPreviewIfActive();
    setRecommendationStatus("info", "Selecciona un tipo de deficiencia en el bloque de simulación para generar la recomendación.");
    return;
  }
  if (result.outcome === "insufficient-series") {
    stopPreviewIfActive();
    setRecommendationStatus(
      "info",
      state.series.length >= 2
        ? "Marca al menos dos series consideradas para recomendar una paleta."
        : "Se necesitan al menos dos colores de serie para recomendar una paleta."
    );
    return;
  }
  if (result.outcome === "compliant") {
    stopPreviewIfActive();
    setRecommendationStatus(
      "ok",
      "La paleta original cumple bajo " + SIMULATION_LABELS[result.deficiencyType] +
        " a severidad máxima: sin fallos de contraste en los pares evaluados y ΔE00 mínimo " +
        formatNumber(result.minDelta) + " (umbral " + formatNumber(result.threshold, 1) +
        "). No se propone reemplazo."
    );
    return;
  }
  if (result.outcome === "redesign") {
    stopPreviewIfActive();
    const familyLabel = result.family === "sequential" ? "secuencial" : "categórico";
    const text = result.exhausted
      ? "Ningún esquema " + familyLabel + " acreditado superó la revalidación con " + result.seriesCount +
        " series y umbral " + formatNumber(state.threshold, 1) + " (se probaron " + result.attempts.length +
        "). Se recomienda rediseñar: reducir series, agrupar categorías o reforzar con etiquetas y formas."
      : "El dashboard tiene " + result.seriesCount + " series y el mayor esquema " + familyLabel +
        " acreditado para " + SIMULATION_LABELS[result.deficiencyType] + " dispone de " + result.maxAvailable +
        " colores. Se recomienda rediseñar: reducir series, agrupar categorías o reforzar con etiquetas y formas.";
    setRecommendationStatus("warning", text);
    return;
  }

  // Propuesta con esquema elegido: documenta qué se eligió y por qué.
  setRecommendationStatus("ok", "Propuesta generada con el esquema " + result.scheme.name + ".");
  recommendationReason.textContent =
    "Elegido por ser el primer esquema acreditado para " + SIMULATION_LABELS[result.deficiencyType] +
    " con capacidad " + result.scheme.size + " ≥ " + result.mapping.length + " series que superó la revalidación: " +
    result.revalidation.iterations + (result.revalidation.iterations === 1 ? " esquema probado" : " esquemas probados") +
    ", " + result.revalidation.swaps + (result.revalidation.swaps === 1 ? " sustitución" : " sustituciones") +
    ", ΔE00 mínimo revalidado " + formatNumber(result.revalidation.minDelta) + ".";

  recommendationMapping.replaceChildren();
  for (const entry of result.mapping) {
    const row = document.createElement("li");
    row.className = "color-fila";
    row.append(colorChip(entry.originalHex), colorChip(entry.proposedHex));
    recommendationMapping.append(row);
  }
  previewNote.hidden = !(evaluation.stats && evaluation.stats.canvasTotal > 0);
  recommendationBody.hidden = false;

  // Con la previsualización activa, la nueva propuesta se re-aplica.
  if (state.previewActive) {
    sendPreview(true);
  }
}

/** Recalcula y pinta la sección de distinguibilidad con el estado vigente. */
function renderDistinguishability() {
  const palette = state.evaluation && state.evaluation.ok ? state.evaluation.palette || [] : [];
  state.series = palette.filter((color) => color.roles.includes("series")).slice(0, MAX_SERIES_COLORS);

  if (state.series.length < 2) {
    distConfigElement.textContent = "Se necesitan al menos dos colores de serie para evaluar distinguibilidad.";
    matrixContainer.replaceChildren();
    seriesLegend.replaceChildren();
    conflictList.replaceChildren();
    state.distSimulated = null;
    state.distOriginal = null;
    updateBadge();
    renderRecommendation();
    return;
  }

  state.simulatedRgbs = state.series.map((color) => simulateColor(color.rgb));
  state.distSimulated = computeDistinguishability(state.simulatedRgbs, { threshold: state.threshold });
  state.distOriginal = computeDistinguishability(state.series.map((color) => color.rgb), {
    threshold: state.threshold
  });

  const { type, severity } = state.simulation;
  const method = type === "tritanopia" ? "método exacto de Brettel (1997)" : "matrices de Machado (2009)";
  distConfigElement.textContent =
    type === "none"
      ? "Simulación: ninguna (los ΔE00 corresponden a los colores originales) · umbral vigente: ΔE00 < " + formatNumber(state.threshold, 1)
      : "Simulación aplicada: " + SIMULATION_LABELS[type] +
      (type === "tritanopia" ? "" : ", severidad " + formatNumber(severity, 1)) +
      " · " + method + " · umbral vigente: ΔE00 < " + formatNumber(state.threshold, 1);

  renderMatrix();
  renderLegend();
  renderConflicts();
  updateBadge();
  renderRecommendation();
}

// ------------------------------------------------------------------
// Orquestación
// ------------------------------------------------------------------

/** Pinta toda la evaluación disponible. */
function render() {
  const evaluation = state.evaluation;
  if (!evaluation || !evaluation.ok) {
    emptyState.hidden = false;
    paletteSection.hidden = true;
    contrastSection.hidden = true;
    distSection.hidden = true;
    approximateNotice.hidden = true;
    recommendationSection.hidden = true;
    resetPreviewUi();
    setEvaluateButtonState(false);
    return;
  }

  emptyState.hidden = true;
  paletteSection.hidden = false;
  contrastSection.hidden = false;
  distSection.hidden = false;
  approximateNotice.hidden = evaluation.approximate !== true;

  paletteSummary.textContent = "Paleta detectada (" + (evaluation.palette || []).length + " colores)";
  const levelNames = (evaluation.levels || []).map((level) => LEVEL_LABELS[level] || level);
  levelsElement.textContent = "Nivel de extracción: " + (levelNames.join(" + ") || "ninguno");

  renderPalette();
  const contrast = evaluation.contrast || { text: [], graphics: [] };
  renderPairList(textPairsList, contrast.text, "No se encontraron pares de texto evaluables.");
  renderPairList(graphicPairsList, contrast.graphics, "No se encontraron objetos gráficos evaluables.");
  renderDistinguishability();

  const failingContrast =
    (contrast.text || []).filter((group) => !group.passes).length +
    (contrast.graphics || []).filter((group) => !group.passes).length;
  const conflictCount = state.distSimulated ? state.distSimulated.conflicts.length : 0;
  const elapsed = Math.round(evaluation.elapsedMs || 0);
  const summary =
    "Evaluación en " + elapsed + " ms: " +
    failingContrast + (failingContrast === 1 ? " par de contraste incumple" : " pares de contraste incumplen") +
    " · " + conflictCount + (conflictCount === 1 ? " par de series confundible" : " pares de series confundibles");
  setStatus(failingContrast + conflictCount > 0 ? "warning" : "ok", summary + ".");
  setEvaluateButtonState(true);
}

/** Lanza la evaluación completa a través del service worker. */
async function runEvaluation() {
  evaluateButton.disabled = true;
  setStatus("info", "Analizando la página…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "RUN_EVALUATION" });
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
        // Decir qué pestaña se rechazó orienta al usuario a cambiar de pestaña.
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
    render();
  } catch (error) {
    setStatus("error", "No se pudo comunicar con el proceso en segundo plano. Vuelve a intentarlo.");
  } finally {
    evaluateButton.disabled = false;
  }
}

/** Carga la evaluación guardada para la pestaña activa. */
async function loadEvaluation() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab && tab.id ? tab.id : null;
    if (!state.tabId) {
      state.evaluation = null;
      render();
      return;
    }
    const stored = await chrome.storage.session.get("evaluation:" + state.tabId);
    state.evaluation = stored["evaluation:" + state.tabId] || null;
  } catch (error) {
    state.evaluation = null;
  }
  render();
  if (!state.evaluation) {
    setStatus("info", "Listo para evaluar la pestaña activa.");
  }
}

// ------------------------------------------------------------------
// Eventos
// ------------------------------------------------------------------

evaluateButton.addEventListener("click", runEvaluation);

deficiencySelect.addEventListener("change", () => {
  state.simulation.type = deficiencySelect.value;
  onSimulationChanged();
});

severitySlider.addEventListener("input", () => {
  state.simulation.severity = Number(severitySlider.value);
  onSimulationChanged();
});

// Paso 1 del algoritmo: la familia la indica el usuario; al cambiarla, la
// propuesta se recalcula con los datos ya evaluados, sin repetir la evaluación.
familySelect.addEventListener("change", () => {
  state.family = familySelect.value === "sequential" ? "sequential" : "qualitative";
  try {
    chrome.storage.local.set({ paletteFamily: state.family });
  } catch (error) {
    // Sin almacenamiento se mantiene solo en memoria.
  }
  renderRecommendation();
});

// Conmutador de previsualización (RF07): aplica o retira sin recargar.
previewToggle.addEventListener("change", () => {
  sendPreview(previewToggle.checked);
});

// El umbral es un parámetro del panel: recalcular al cambiarlo, sin botón.
thresholdInput.addEventListener("input", () => {
  const value = Number(thresholdInput.value);
  if (Number.isFinite(value) && value >= 1 && value <= 30) {
    state.threshold = value;
    renderDistinguishability();
  }
});

// Nueva evaluación guardada para esta pestaña (p. ej. desde otra superficie).
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session" && state.tabId && changes["evaluation:" + state.tabId]) {
    state.evaluation = changes["evaluation:" + state.tabId].newValue || null;
    render();
  }
});

// El panel sigue a la pestaña activa de su ventana.
chrome.tabs.onActivated.addListener(() => {
  loadEvaluation();
});

// Arranque: recuperar configuración y última evaluación de la pestaña.
(async function init() {
  thresholdInput.value = String(DEFAULT_CONFUSION_THRESHOLD);
  await loadStoredSimulation();
  await loadStoredFamily();
  updateSimulationControls();
  await loadEvaluation();
})();

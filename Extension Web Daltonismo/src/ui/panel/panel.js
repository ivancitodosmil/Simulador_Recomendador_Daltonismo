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
  distOriginal: null
};

/** Número con coma decimal. */
function formatNumber(value, decimals = 2) {
  return Number(value).toFixed(decimals).replace(".", ",");
}

/** Estado con icono de forma distinta + texto. */
function setStatus(kind, text) {
  statusElement.className = "estado estado--" + kind;
  statusElement.replaceChildren();
  const icon = document.createElement("span");
  icon.className = "estado-icono";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = STATUS_ICONS[kind] || STATUS_ICONS.info;
  const message = document.createElement("span");
  message.textContent = text;
  statusElement.append(icon, message);
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
  updateSimulationControls();
  await loadEvaluation();
})();

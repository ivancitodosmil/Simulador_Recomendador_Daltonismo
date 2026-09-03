// ------------------------------------------------------------------
// Sprints 1-2 · Lógica del popup.
// Sprint 1: pide la paleta al service worker y la presenta como
// muestras con su valor hexadecimal al lado, indicando el nivel de
// extracción empleado.
// Sprint 2: controles de simulación (tipo + severidad) que se aplican
// de inmediato, columna de paleta simulada en paralelo (machado.js /
// brettel.js) y persistencia de la configuración en chrome.storage.
// Se usa chrome.storage.local (y no .sync) por la regla del proyecto
// de no generar peticiones de red en tiempo de ejecución.
// ------------------------------------------------------------------

import { rgbToHex } from "../../core/color/conversion.js";
import { simulateMachado } from "../../core/simulacion/machado.js";
import { simulateTritanopia } from "../../core/simulacion/brettel.js";

const evaluateButton = document.getElementById("evaluate-button");
const statusElement = document.getElementById("status");
const resultSection = document.getElementById("result");
const summaryElement = document.getElementById("summary");
const levelsElement = document.getElementById("levels");
const paletteList = document.getElementById("palette-list");
const deficiencySelect = document.getElementById("deficiency-select");
const severitySlider = document.getElementById("severity-slider");
const severityValue = document.getElementById("severity-value");
const severityNote = document.getElementById("severity-note");
const simulatedHeader = document.getElementById("simulated-header");

// Iconos con formas distintas por estado (regla del proyecto: el color
// nunca es el único canal).
const STATUS_ICONS = { info: "ℹ", ok: "✔", warning: "▲", error: "✖" };

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

const SIMULATION_LABELS = {
  none: "sin simulación",
  protanopia: "protanopía",
  deuteranopia: "deuteranopía",
  tritanopia: "tritanopía"
};

const ERROR_MESSAGES = {
  "unsupported-page": "Esta página no se puede evaluar: es una página interna del navegador o de la tienda de extensiones.",
  "no-active-tab": "No se encontró una pestaña activa que evaluar.",
  "injection-failed": "No se pudo acceder a la página para analizarla.",
  "extraction-failed": "La extracción falló dentro de la página.",
  "unexpected": "Ocurrió un error inesperado durante la extracción."
};

// Estado del popup: última paleta extraída y configuración de simulación.
const state = {
  palette: [],
  simulation: { type: "none", severity: 1 }
};

/** Muestra un estado con icono + texto. */
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

/** Formatea la severidad con coma decimal ("0,8"). */
function formatSeverity(value) {
  return Number(value).toFixed(1).replace(".", ",");
}

/** Simula un color según la configuración vigente. */
function simulateColor(rgb) {
  const { type, severity } = state.simulation;
  if (type === "none") return rgb;
  if (type === "tritanopia") return simulateTritanopia(rgb);
  return simulateMachado(rgb, type, severity);
}

/** Sincroniza los controles y la cabecera de la columna simulada. */
function updateSimulationControls() {
  const { type, severity } = state.simulation;
  deficiencySelect.value = type;
  severitySlider.value = String(severity);
  severityValue.textContent = formatSeverity(severity);

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
    simulatedHeader.textContent = "Simulada · " + SIMULATION_LABELS[type] + " " + formatSeverity(severity);
  }
}

/** Celda de muestra: color decorativo + hex escrito al lado. */
function buildColorCell(hex, metaText) {
  const cell = document.createElement("span");
  cell.className = "color-celda";

  const swatch = document.createElement("span");
  swatch.className = "muestra-color";
  swatch.style.backgroundColor = hex;
  swatch.setAttribute("aria-hidden", "true");

  const details = document.createElement("span");
  details.className = "color-detalle";
  const hexCode = document.createElement("code");
  hexCode.className = "hex";
  hexCode.textContent = hex;
  details.append(hexCode);

  if (metaText) {
    const meta = document.createElement("span");
    meta.className = "color-meta";
    meta.textContent = metaText;
    details.append(meta);
  }

  cell.append(swatch, details);
  return cell;
}

/** Fila de la paleta: color original y su versión simulada en paralelo. */
function buildColorRow(color) {
  const row = document.createElement("li");
  row.className = "color-fila";

  const roles = color.roles.map((role) => ROLE_LABELS[role] || role).join(" · ");
  const share = (color.share * 100).toFixed(1).replace(".", ",") + " %";
  const examples = color.examples && color.examples.length ? " · " + color.examples.join(", ") : "";

  const simulatedHex = rgbToHex(simulateColor(color.rgb));

  row.append(
    buildColorCell(color.hex, roles + " · " + share + examples),
    buildColorCell(simulatedHex, null)
  );
  return row;
}

/** Repinta la lista de la paleta con la simulación vigente. */
function renderPalette() {
  paletteList.replaceChildren();
  for (const color of state.palette) {
    paletteList.append(buildColorRow(color));
  }
}

/** Pinta la respuesta de extracción del service worker. */
function renderResponse(response) {
  if (!response) {
    setStatus("error", ERROR_MESSAGES.unexpected);
    return;
  }

  if (!response.ok) {
    let text = ERROR_MESSAGES[response.error] || ERROR_MESSAGES.unexpected;
    if (response.error === "injection-failed" && response.isFileUrl) {
      text = "No se pudo acceder a este archivo local. Activa «Permitir acceso a URL de archivo» para esta extensión en chrome://extensions.";
    }
    setStatus("error", text);
    return;
  }

  if (!response.palette || response.palette.length === 0) {
    setStatus("info", "No se detectó ningún color en esta página.");
    return;
  }

  state.palette = response.palette;

  const elapsed = Math.round(response.elapsedMs || 0);
  if (response.approximate) {
    setStatus("warning", "Paleta extraída en " + elapsed + " ms. Parte del resultado proviene de la captura de pantalla y es aproximado.");
  } else {
    setStatus("ok", "Paleta extraída en " + elapsed + " ms.");
  }

  summaryElement.textContent = "Paleta detectada (" + response.palette.length + " colores)";
  const levelNames = (response.levels || []).map((level) => LEVEL_LABELS[level] || level);
  levelsElement.textContent = "Nivel de extracción: " + (levelNames.join(" + ") || "ninguno");

  renderPalette();
  resultSection.hidden = false;
}

/** Lanza la extracción a través del service worker. */
async function runEvaluation() {
  evaluateButton.disabled = true;
  resultSection.hidden = true;
  setStatus("info", "Analizando la página…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "EXTRACT_PALETTE" });
    renderResponse(response);
  } catch (error) {
    setStatus("error", "No se pudo comunicar con el proceso en segundo plano. Vuelve a intentarlo.");
  } finally {
    evaluateButton.disabled = false;
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
      setStatus("warning", "La simulación no se pudo aplicar sobre esta página; la columna simulada del popup sí se actualiza.");
    }
  } catch (error) {
    setStatus("warning", "La simulación no se pudo aplicar sobre esta página; la columna simulada del popup sí se actualiza.");
  }
}

/** Guarda la configuración de simulación (sobrevive al cierre del popup). */
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

/** Recupera la configuración guardada al abrir el popup. */
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

/** Reacción común a cualquier cambio de control: inmediata, sin confirmación. */
function onSimulationChanged() {
  persistSimulation();
  updateSimulationControls();
  renderPalette();
  applySimulationToPage();
}

evaluateButton.addEventListener("click", runEvaluation);

deficiencySelect.addEventListener("change", () => {
  state.simulation.type = deficiencySelect.value;
  onSimulationChanged();
});

severitySlider.addEventListener("input", () => {
  state.simulation.severity = Number(severitySlider.value);
  onSimulationChanged();
});

// Arranque: recuperar configuración persistida y reflejarla en los controles.
(async function init() {
  await loadStoredSimulation();
  updateSimulationControls();
})();

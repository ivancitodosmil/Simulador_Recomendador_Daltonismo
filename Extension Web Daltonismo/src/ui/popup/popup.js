// ------------------------------------------------------------------
// Sprint 1 · Lógica del popup: pide la paleta al service worker y la
// presenta como muestras con su valor hexadecimal al lado, indicando
// el nivel de extracción empleado. Los estados usan icono de forma
// distinta + texto, nunca solo color.
// ------------------------------------------------------------------

const evaluateButton = document.getElementById("evaluate-button");
const statusElement = document.getElementById("status");
const resultSection = document.getElementById("result");
const summaryElement = document.getElementById("summary");
const levelsElement = document.getElementById("levels");
const paletteList = document.getElementById("palette-list");

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

const ERROR_MESSAGES = {
  "unsupported-page": "Esta página no se puede evaluar: es una página interna del navegador o de la tienda de extensiones.",
  "no-active-tab": "No se encontró una pestaña activa que evaluar.",
  "injection-failed": "No se pudo acceder a la página para analizarla.",
  "extraction-failed": "La extracción falló dentro de la página.",
  "unexpected": "Ocurrió un error inesperado durante la extracción."
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

/** Construye la fila de una muestra: color + hex al lado + rol y frecuencia. */
function buildColorItem(color) {
  const item = document.createElement("li");
  item.className = "color-item";

  // La muestra es decorativa: el hex escrito al lado es lo que anuncia el
  // lector de pantalla.
  const swatch = document.createElement("span");
  swatch.className = "muestra-color";
  swatch.style.backgroundColor = color.hex;
  swatch.setAttribute("aria-hidden", "true");

  const details = document.createElement("span");
  details.className = "color-detalle";

  const hexCode = document.createElement("code");
  hexCode.className = "hex";
  hexCode.textContent = color.hex;

  const meta = document.createElement("span");
  meta.className = "color-meta";
  const roles = color.roles.map((role) => ROLE_LABELS[role] || role).join(" · ");
  const share = (color.share * 100).toFixed(1).replace(".", ",") + " %";
  const examples = color.examples && color.examples.length ? " · " + color.examples.join(", ") : "";
  meta.textContent = roles + " · " + share + examples;

  details.append(hexCode, meta);
  item.append(swatch, details);
  return item;
}

/** Pinta la respuesta del service worker. */
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

  const elapsed = Math.round(response.elapsedMs || 0);
  setStatus("ok", "Paleta extraída en " + elapsed + " ms.");

  summaryElement.textContent = "Paleta detectada (" + response.palette.length + " colores)";
  const levelNames = (response.levels || []).map((level) => LEVEL_LABELS[level] || level);
  levelsElement.textContent = "Nivel de extracción: " + (levelNames.join(" + ") || "ninguno");

  paletteList.replaceChildren();
  for (const color of response.palette) {
    paletteList.append(buildColorItem(color));
  }
  resultSection.hidden = false;

  if (response.approximate) {
    setStatus("warning", "Paleta extraída en " + elapsed + " ms. Parte del resultado proviene de la captura de pantalla y es aproximado.");
  }
}

/** Lanza la evaluación a través del service worker. */
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

evaluateButton.addEventListener("click", runEvaluation);

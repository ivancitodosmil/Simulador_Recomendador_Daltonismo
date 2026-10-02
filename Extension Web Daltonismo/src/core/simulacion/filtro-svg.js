// ------------------------------------------------------------------
// Filtro SVG en vivo (RF02, RF03): inyecta en la página un <svg> oculto
// con un feColorMatrix y lo aplica por CSS (filter: url(#...)) al
// contenedor del dashboard. Al desactivar, restaura el valor original
// de la propiedad filter y retira el nodo inyectado, de modo que la
// página recupera su estado exacto sin recargar. Sprint 2.
//
// El filtro opera con color-interpolation-filters="linearRGB", el
// dominio en el que están definidas las matrices de Machado; así el
// resultado en pantalla coincide con el cálculo de machado.js.
//
// Tritanopia en vivo, decisión y diferencia con brettel.js: el método
// exacto de Brettel (1997) proyecta cada píxel sobre uno de dos
// semiplanos según el lado del eje neutro en que cae (decisión M > L
// por píxel). Esa operación es lineal por tramos y feColorMatrix solo
// puede aplicar una matriz lineal a todos los píxeles, sin
// ramificación. Como mejor aproximación aplicable en vivo se usa la
// matriz de tritanomalía con severidad 1.0 del propio modelo de
// Machado et al. (2009): es una única matriz lineal en RGB lineal,
// coherente con el resto del filtro. Diferencia documentada: la matriz
// de Machado ajusta un desplazamiento espectral global y no reproduce
// el quiebre entre los lados azul-verdoso y rojizo del eje neutro, por
// lo que en tonos amarillos y azules profundos difiere del cálculo
// exacto. La evaluación de la paleta extraída (RF05, RF06) usa siempre
// brettel.js; esta vista en vivo es orientativa.
// ------------------------------------------------------------------

import { getMachadoMatrix } from "./machado.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FILTER_ID = "evaluador-cromatico-filtro";
const HOST_ID = "evaluador-cromatico-filtro-svg";

/** Matriz de tritanomalía 1.0 de Machado et al. (2009), tabla de los autores. */
export const TRITANOPIA_LIVE_APPROXIMATION = [
  [1.255528, -0.076749, -0.178779],
  [-0.078411, 0.930809, 0.147602],
  [0.004733, 0.691367, 0.303900]
];

// Duplicado deliberado de la heurística de contenedor de dom-svg.js
// (CONTAINER_CANDIDATES): este módulo no importa el de extracción para
// que la simulación pueda cargarse sola. El content script pasa el
// contenedor ya resuelto por la extracción cuando existe; esta copia
// solo actúa si se simula antes de extraer. Si cambia allí, debe
// cambiar aquí.
const CONTAINER_CANDIDATES = ["[data-dashboard]", "#dashboard", ".dashboard", "[data-reporte]"];

// Estado del filtro activo (vive en el módulo, no en el DOM del sitio).
let activeTarget = null;
let previousInlineFilter = "";
// Si el contenedor no tenía atributo style antes del filtro, al retirar
// se elimina también el atributo vacío: restauración exacta, sin restos.
let targetHadStyleAttribute = false;
// Configuración aplicada, para poder reportar el estado real al panel.
let activeConfig = null;

/** Resuelve el contenedor del dashboard con la misma heurística del nivel 1. */
function resolveContainer(doc = document) {
  return CONTAINER_CANDIDATES.map((selector) => doc.querySelector(selector)).find(Boolean) || doc.body;
}

/** Convierte una matriz 3×3 en los 20 valores de feColorMatrix (filas RGBA). */
export function toFeColorMatrixValues(matrix) {
  return [
    [matrix[0][0], matrix[0][1], matrix[0][2], 0, 0],
    [matrix[1][0], matrix[1][1], matrix[1][2], 0, 0],
    [matrix[2][0], matrix[2][1], matrix[2][2], 0, 0],
    [0, 0, 0, 1, 0]
  ]
    .map((row) => row.join(" "))
    .join(" ");
}

/** Crea (una sola vez) el <svg> oculto con el filtro y devuelve el feColorMatrix. */
function ensureFilterHost(doc) {
  let host = doc.getElementById(HOST_ID);
  if (host) {
    return host.querySelector("feColorMatrix");
  }
  host = doc.createElementNS(SVG_NAMESPACE, "svg");
  host.setAttribute("id", HOST_ID);
  host.setAttribute("width", "0");
  host.setAttribute("height", "0");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "absolute";
  host.style.overflow = "hidden";

  const filter = doc.createElementNS(SVG_NAMESPACE, "filter");
  filter.setAttribute("id", FILTER_ID);
  // Dominio lineal: el mismo en el que operan las matrices de Machado.
  filter.setAttribute("color-interpolation-filters", "linearRGB");

  const colorMatrix = doc.createElementNS(SVG_NAMESPACE, "feColorMatrix");
  colorMatrix.setAttribute("type", "matrix");
  colorMatrix.setAttribute("in", "SourceGraphic");

  filter.appendChild(colorMatrix);
  host.appendChild(filter);
  doc.documentElement.appendChild(host);
  return colorMatrix;
}

/**
 * Aplica el filtro de simulación al contenedor del dashboard.
 * config: { type: "protanopia" | "deuteranopia" | "tritanopia", severity }.
 * container: contenedor ya resuelto por la extracción (opcional).
 */
export function applySimulationFilter(config, container = null, doc = document) {
  const target = container || resolveContainer(doc);
  const matrix =
    config.type === "tritanopia"
      ? TRITANOPIA_LIVE_APPROXIMATION
      : getMachadoMatrix(config.type, config.severity);

  // Si el filtro estaba aplicado sobre otro contenedor, se limpia primero.
  if (activeTarget && activeTarget !== target) {
    clearSimulationFilter(doc);
  }

  const colorMatrix = ensureFilterHost(doc);
  colorMatrix.setAttribute("values", toFeColorMatrixValues(matrix));

  if (activeTarget !== target) {
    previousInlineFilter = target.style.filter || "";
    targetHadStyleAttribute = target.hasAttribute("style");
    activeTarget = target;
  }
  activeConfig = { type: config.type, severity: config.severity };
  target.style.filter = "url(#" + FILTER_ID + ")";
}

/** Estado real del filtro en esta página, para la reconciliación con el panel. */
export function getSimulationFilterState() {
  return activeTarget
    ? { active: true, config: activeConfig }
    : { active: false, config: null };
}

/** Retira el filtro y restaura el estado original de la página. */
export function clearSimulationFilter(doc = document) {
  if (activeTarget) {
    if (previousInlineFilter) {
      activeTarget.style.filter = previousInlineFilter;
    } else {
      activeTarget.style.removeProperty("filter");
      if (!targetHadStyleAttribute && activeTarget.getAttribute("style") === "") {
        activeTarget.removeAttribute("style");
      }
    }
    activeTarget = null;
    previousInlineFilter = "";
    targetHadStyleAttribute = false;
  }
  activeConfig = null;
  const host = doc.getElementById(HOST_ID);
  if (host) {
    host.remove();
  }
}

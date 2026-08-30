// ------------------------------------------------------------------
// Sprint 1 · Nivel 1 de extracción: colores declarados en el DOM y en
// SVG. Recorre los nodos visibles del contenedor del dashboard con
// getComputedStyle y registra color, background-color y border-color,
// más fill y stroke de los elementos SVG (el estilo computado resuelve
// tanto los atributos de presentación como las variables CSS).
// Cada observación conserva la referencia al elemento que la origina.
// ------------------------------------------------------------------

import { parseCssColor } from "../color/conversion.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// Límite de nodos visitados para respetar el presupuesto de tiempo (< 3 s).
const MAX_NODES = 5000;

// Menús y barras de la plataforma que se excluyen del recorrido, junto con
// nodos sin representación visual. Los header/footer del propio dashboard NO
// se excluyen: contienen títulos y texto que sí deben evaluarse.
const EXCLUDED_SELECTOR = [
  "nav",
  "[role=\"navigation\"]",
  "[role=\"menu\"]",
  "[role=\"menubar\"]",
  "[role=\"toolbar\"]",
  "[aria-hidden=\"true\"]",
  "script",
  "style",
  "noscript",
  "template",
  "defs",
  "symbol",
  "mask",
  "clipPath"
].join(", ");

// Candidatos a contenedor del reporte, del más específico al más genérico.
// Si ninguno existe se recorre body y la lista de exclusión acota el ruido;
// no se usa <main> como candidato porque muchos dashboards colocan título y
// tarjetas KPI fuera de él.
const CONTAINER_CANDIDATES = ["[data-dashboard]", "#dashboard", ".dashboard", "[data-reporte]"];

/** ¿Tiene el elemento nodos de texto directos con contenido? */
function hasDirectText(element) {
  for (const node of element.childNodes) {
    if (node.nodeType === 3 && node.textContent.trim()) return true;
  }
  return false;
}

/** Registra una observación si el valor es un color con alfa apreciable. */
function pushObservation(state, element, cssColor, property, role) {
  const parsed = parseCssColor(cssColor);
  if (!parsed || parsed.a < 0.05) return;
  state.observations.push({ cssColor, property, role, element });
}

/** Extrae los colores relevantes de un elemento ya validado como visible. */
function recordColors(element, style, state) {
  if (element.namespaceURI === SVG_NAMESPACE) {
    // En SVG el texto también se pinta con fill; se distingue por etiqueta.
    const tag = element.tagName.toLowerCase();
    const role = tag === "text" || tag === "tspan" ? "text" : "series";
    pushObservation(state, element, style.fill, "fill", role);
    if (parseFloat(style.strokeWidth) > 0) {
      pushObservation(state, element, style.stroke, "stroke", role);
    }
    return;
  }
  if (hasDirectText(element)) {
    pushObservation(state, element, style.color, "color", "text");
  }
  pushObservation(state, element, style.backgroundColor, "background-color", "background");
  if (parseFloat(style.borderTopWidth) > 0) {
    pushObservation(state, element, style.borderTopColor, "border-color", "border");
  }
}

/** Recorrido en profundidad que descarta subárboles excluidos u ocultos. */
function walk(element, state) {
  if (state.visited >= MAX_NODES) {
    state.truncated = true;
    return;
  }
  if (element.matches(EXCLUDED_SELECTOR)) return;

  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) {
    return;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return;

  state.visited += 1;
  recordColors(element, style, state);

  for (const child of element.children) {
    walk(child, state);
  }
}

/**
 * Garantiza que la paleta incluya un color de fondo de página: si body y
 * html son transparentes, el navegador pinta blanco por defecto.
 */
function ensureBackgroundObservation(state, doc) {
  const hasBackground = state.observations.some((obs) => obs.role === "background");
  if (hasBackground) return;
  for (const element of [doc.body, doc.documentElement]) {
    const parsed = parseCssColor(getComputedStyle(element).backgroundColor);
    if (parsed && parsed.a > 0.05) return;
  }
  state.observations.push({
    cssColor: "#FFFFFF",
    property: "background-color",
    role: "background",
    element: doc.body,
    synthetic: true // fondo por defecto del navegador, no declarado
  });
}

/**
 * Punto de entrada del nivel 1. Devuelve las observaciones crudas (con
 * referencia a elemento), el contenedor empleado y métricas del recorrido.
 */
export function extractDomSvgColors(doc = document) {
  const container =
    CONTAINER_CANDIDATES.map((selector) => doc.querySelector(selector)).find(Boolean) || doc.body;

  const state = { observations: [], visited: 0, truncated: false };
  walk(container, state);
  ensureBackgroundObservation(state, doc);

  return {
    observations: state.observations,
    container,
    containerTag: container === doc.body ? "body" : container.tagName.toLowerCase(),
    visited: state.visited,
    truncated: state.truncated
  };
}

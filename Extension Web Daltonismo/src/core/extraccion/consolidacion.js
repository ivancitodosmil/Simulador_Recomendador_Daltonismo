// ------------------------------------------------------------------
// Consolidación de la paleta (RF01): normaliza los formatos de los tres
// niveles de extracción, agrupa los colores casi idénticos conservando
// un representante por grupo, ordena por frecuencia y registra el rol
// de cada color (fondo, texto, serie o borde) cuando el nivel de
// extracción lo permite. Sprint 1; agrupación con CIEDE2000 desde el 3.
// ------------------------------------------------------------------

import { parseCssColor, rgbToHex, rgbToLab } from "../color/conversion.js";
import { ciede2000 } from "../color/diferencia.js";

// Umbral de agrupación: por debajo de este ΔE00 dos tonos se consideran el
// mismo color (variaciones de redondeo o antialiasing).
const GROUPING_DELTA_E = 2.5;

// Topes para no arrastrar estructuras enormes en el mensaje de respuesta.
const MAX_EXAMPLES_PER_COLOR = 3;
const MAX_ELEMENTS_PER_COLOR = 50;

// La agrupación mide con CIEDE2000, la misma métrica perceptual que la
// distinguibilidad y la recomendación, para que toda la cadena sea
// coherente; su coste es despreciable (cientos de entradas por
// evaluación, microsegundos por par). El umbral 2.5 queda pegado a la
// diferencia apenas perceptible clásica (≈ 2.3) y, para tonos saturados,
// CIEDE2000 comprime las diferencias de croma (SC), con lo que agrupa
// mejor los restos de suavizado de un mismo color sin fusionar series
// legítimamente distintas (verificado con las pruebas de extracción).

/** Compone un color con alfa parcial sobre fondo blanco. */
function compositeOverWhite({ r, g, b, a }) {
  if (a >= 1) return { r, g, b };
  return {
    r: Math.round(r * a + 255 * (1 - a)),
    g: Math.round(g * a + 255 * (1 - a)),
    b: Math.round(b * a + 255 * (1 - a))
  };
}

/** Descripción corta y serializable del elemento origen (p. ej. "rect.barra"). */
function describeElement(element) {
  try {
    const tag = (element.tagName || "").toLowerCase();
    if (!tag) return "elemento";
    const id = element.id ? "#" + element.id : "";
    const classAttr = typeof element.getAttribute === "function" ? element.getAttribute("class") : null;
    const firstClass = !id && classAttr ? "." + String(classAttr).trim().split(/\s+/)[0] : "";
    return tag + id + firstClass;
  } catch (error) {
    return "elemento";
  }
}

/** Agrupa entradas crudas por cercanía perceptual, de más a menos pesada. */
function groupByPerceptualDistance(rawEntries) {
  const sorted = rawEntries.slice().sort((a, b) => b.weight - a.weight);
  const groups = [];

  for (const entry of sorted) {
    const lab = rgbToLab(entry.rgb);
    let group = groups.find((g) => ciede2000(g.lab, lab) < GROUPING_DELTA_E);
    if (!group) {
      // El primer miembro (el más frecuente) queda como representante.
      group = {
        rgb: entry.rgb,
        lab,
        hex: rgbToHex(entry.rgb),
        weight: 0,
        occurrences: 0,
        roles: new Set(),
        levels: new Set(),
        elements: [],
        examples: []
      };
      groups.push(group);
    }
    group.weight += entry.weight;
    group.occurrences += 1;
    for (const role of entry.roles) group.roles.add(role);
    for (const level of entry.levels) group.levels.add(level);
    for (const element of entry.elements) {
      if (group.elements.length < MAX_ELEMENTS_PER_COLOR) group.elements.push(element);
    }
    for (const example of entry.examples) {
      if (example && group.examples.length < MAX_EXAMPLES_PER_COLOR && !group.examples.includes(example)) {
        group.examples.push(example);
      }
    }
  }
  return groups;
}

/** Convierte los grupos en la paleta serializable, ordenada por frecuencia. */
function serializeGroups(groups) {
  const totalWeight = groups.reduce((sum, group) => sum + group.weight, 0) || 1;
  return groups
    .slice()
    .sort((a, b) => b.weight - a.weight)
    .map((group) => ({
      hex: group.hex,
      rgb: group.rgb,
      lab: group.lab,
      weight: group.weight,
      share: group.weight / totalWeight,
      roles: Array.from(group.roles),
      levels: Array.from(group.levels),
      occurrences: group.occurrences,
      examples: group.examples
    }));
}

/**
 * Consolida las observaciones del nivel 1 (DOM/SVG, con elemento) y las
 * entradas del nivel 2 (canvas, sin elemento). Devuelve la paleta
 * serializable y un registro hex → elementos que el content script conserva
 * en la página para la previsualización de la paleta propuesta.
 */
export function consolidateObservations(domObservations = [], canvasEntries = []) {
  const rawEntries = [];

  // Nivel 1: cada observación pesa 1/n para que el nivel completo sume 1 y
  // sea comparable con las proporciones de píxeles del nivel 2.
  const validDom = [];
  for (const observation of domObservations) {
    const parsed = parseCssColor(observation.cssColor);
    if (!parsed || parsed.a < 0.05) continue;
    validDom.push({ rgb: compositeOverWhite(parsed), observation });
  }
  const domTotal = validDom.length || 1;
  for (const { rgb, observation } of validDom) {
    rawEntries.push({
      rgb,
      weight: 1 / domTotal,
      roles: [observation.role],
      levels: ["dom-svg"],
      elements: observation.element ? [observation.element] : [],
      examples: observation.element ? [describeElement(observation.element)] : []
    });
  }

  // Nivel 2: ya llega cuantizado y con peso proporcional a sus muestras.
  for (const entry of canvasEntries) {
    rawEntries.push({
      rgb: entry.rgb,
      weight: entry.weight,
      roles: [entry.role],
      levels: ["canvas"],
      elements: [],
      examples: []
    });
  }

  const groups = groupByPerceptualDistance(rawEntries);
  const registry = new Map();
  for (const group of groups) {
    if (group.elements.length) registry.set(group.hex, group.elements);
  }
  return { palette: serializeGroups(groups), registry };
}

/**
 * Fusiona una paleta ya serializada con entradas de otro nivel (la usa el
 * service worker para incorporar el nivel 3 de captura). Reagrupa por
 * cercanía perceptual para que los colores repetidos sigan apareciendo una
 * sola vez.
 */
export function mergePalettes(palette = [], extraEntries = [], level = "capture") {
  const rawEntries = palette.map((color) => ({
    rgb: color.rgb,
    weight: color.weight,
    roles: color.roles,
    levels: color.levels,
    elements: [],
    examples: color.examples || []
  }));
  for (const entry of extraEntries) {
    rawEntries.push({
      rgb: entry.rgb,
      weight: entry.weight,
      roles: [entry.role],
      levels: [level],
      elements: [],
      examples: []
    });
  }
  return serializeGroups(groupByPerceptualDistance(rawEntries));
}

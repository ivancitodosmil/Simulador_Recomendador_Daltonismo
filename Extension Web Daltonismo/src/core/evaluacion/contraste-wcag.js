// ------------------------------------------------------------------
// Evaluación WCAG 2.1 sobre los colores declarados, no simulados (RF04),
// con las observaciones color-elemento del nivel 1 de extracción:
//   - 1.4.3 texto sobre fondo: 4.5:1 normal, 3:1 texto grande.
//   - 1.4.11 objetos gráficos contra su fondo efectivo: 3:1.
// Sprint 3.
//
// Cada objeto gráfico (fill/stroke de serie, borde) se compara contra
// el fondo efectivo de su propio elemento: el primer ancestro con
// background-color opaco, componiendo las capas semitransparentes
// intermedias sobre la base blanca del navegador. La confusión entre
// series adyacentes NO se evalúa aquí: eso es distinguibilidad
// (distinguibilidad.js), que trabaja con los colores simulados.
// Los resultados se agrupan por criterio y siempre incluyen la cifra
// obtenida junto al umbral exigido; la comparación se hace sin redondeo.
// Los colores de los niveles 2 y 3 (canvas y captura) no tienen elemento:
// para que una serie nunca pase por «cumple» solo porque nadie la midió,
// addApproximateSeriesContrast les añade un par 1.4.11 aproximado contra
// el fondo dominante de su zona de gráficos (canvas: fondo CSS efectivo
// del canvas; captura: color acromático dominante del recorte) o, en su
// defecto, contra el fondo de página. Esas filas llevan approximate: true.
// ------------------------------------------------------------------

import { parseCssColor, rgbToHex, rgbToLab } from "../color/conversion.js";
import { ciede2000 } from "../color/diferencia.js";
import { contrastRatio, meetsThreshold, WCAG_THRESHOLDS } from "../color/contraste.js";

// Texto grande según WCAG: ≥ 18 pt (24 px) o ≥ 14 pt (18.66 px) en negrita.
const LARGE_TEXT_PX = 24;
const LARGE_BOLD_TEXT_PX = 18.66;
const MIN_ALPHA = 0.05;
const MAX_EXAMPLES = 3;

/** Descripción corta del elemento origen (p. ej. "rect.barra"). */
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

/** Composición alfa de una capa sobre un color base opaco. */
function compositeLayer(layer, base) {
  return {
    r: Math.round(layer.r * layer.a + base.r * (1 - layer.a)),
    g: Math.round(layer.g * layer.a + base.g * (1 - layer.a)),
    b: Math.round(layer.b * layer.a + base.b * (1 - layer.a))
  };
}

/**
 * Fondo efectivo de un elemento: recorre los ancestros (empezando por el
 * propio elemento) acumulando capas de background-color hasta la primera
 * opaca, y las compone de fuera hacia dentro sobre la base blanca que
 * pinta el navegador cuando nadie declara fondo.
 */
export function effectiveBackground(element, doc = document) {
  const getStyle = doc.defaultView.getComputedStyle;
  const layers = [];
  let node = element;
  while (node && node.nodeType === 1) {
    const parsed = parseCssColor(getStyle(node).backgroundColor);
    if (parsed && parsed.a >= MIN_ALPHA) {
      layers.push(parsed);
      if (parsed.a >= 0.99) break;
    }
    node = node.parentElement;
  }
  let background = { r: 255, g: 255, b: 255 };
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    background = compositeLayer(layers[i], background);
  }
  return background;
}

/** ¿El texto del elemento califica como "grande" para WCAG 1.4.3? */
function isLargeText(style) {
  const size = parseFloat(style.fontSize) || 0;
  const weight = style.fontWeight === "bold" ? 700 : parseFloat(style.fontWeight) || 400;
  return size >= LARGE_TEXT_PX || (size >= LARGE_BOLD_TEXT_PX && weight >= 700);
}

/**
 * Evalúa las observaciones del nivel 1. Devuelve los pares agrupados por
 * criterio, cada uno con la cifra obtenida, el umbral exigido, el
 * veredicto sin redondeo, el número de elementos afectados y ejemplos.
 */
export function evaluateWcagContrast(observations, { doc = document } = {}) {
  const groups = new Map();
  const getStyle = doc.defaultView.getComputedStyle;

  for (const observation of observations) {
    if (!observation.element) continue; // sin elemento no hay par evaluable

    // Primer plano según el rol registrado por la extracción.
    let kind = null;
    if (observation.role === "text") kind = "text";
    else if (observation.role === "series" || observation.role === "border") kind = "graphic";
    else continue; // los fondos no son primer plano

    const parsed = parseCssColor(observation.cssColor);
    if (!parsed || parsed.a < MIN_ALPHA) continue;

    const background = effectiveBackground(observation.element, doc);
    const foreground = parsed.a >= 1 ? { r: parsed.r, g: parsed.g, b: parsed.b } : compositeLayer(parsed, background);
    const ratio = contrastRatio(foreground, background);

    let criterion;
    let threshold;
    let largeText = false;
    if (kind === "text") {
      criterion = "1.4.3";
      largeText = isLargeText(getStyle(observation.element));
      threshold = largeText ? WCAG_THRESHOLDS.largeText : WCAG_THRESHOLDS.normalText;
    } else {
      criterion = "1.4.11";
      threshold = WCAG_THRESHOLDS.graphics;
    }

    const foregroundHex = rgbToHex(foreground);
    const backgroundHex = rgbToHex(background);
    const key = criterion + "|" + foregroundHex + "|" + backgroundHex + "|" + (largeText ? "L" : "N");
    let group = groups.get(key);
    if (!group) {
      group = {
        criterion,
        foreground: { hex: foregroundHex, rgb: foreground },
        background: { hex: backgroundHex, rgb: background },
        ratio,
        threshold,
        largeText,
        passes: meetsThreshold(ratio, threshold), // sin redondeo previo
        count: 0,
        examples: [],
        // Roles de las observaciones que aportan al par: permiten distinguir
        // un fallo de serie de uno de borde decorativo.
        roles: []
      };
      groups.set(key, group);
    }
    group.count += 1;
    if (!group.roles.includes(observation.role)) {
      group.roles.push(observation.role);
    }
    const example = describeElement(observation.element);
    if (example && group.examples.length < MAX_EXAMPLES && !group.examples.includes(example)) {
      group.examples.push(example);
    }
  }

  return splitByCriterion(Array.from(groups.values()));
}

// Fallos primero y, dentro de cada bloque, del contraste más bajo al más alto.
const bySeverity = (a, b) => (a.passes === b.passes ? a.ratio - b.ratio : a.passes ? 1 : -1);

function splitByCriterion(all) {
  return {
    text: all.filter((group) => group.criterion === "1.4.3").sort(bySeverity),
    graphics: all.filter((group) => group.criterion === "1.4.11").sort(bySeverity)
  };
}

/**
 * Fusiona los resultados de varios marcos: los pares con el mismo
 * criterio, colores y tamaño de texto se suman (elementos, ejemplos,
 * roles); el resto se concatena. Devuelve { text, graphics } ordenados.
 */
export function mergeContrastResults(results = []) {
  const merged = new Map();
  for (const result of results) {
    if (!result) continue;
    for (const group of [...(result.text || []), ...(result.graphics || [])]) {
      const key = group.criterion + "|" + group.foreground.hex + "|" + group.background.hex + "|" + (group.largeText ? "L" : "N");
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...group, roles: [...(group.roles || [])], examples: [...(group.examples || [])] });
        continue;
      }
      existing.count += group.count;
      for (const role of group.roles || []) if (!existing.roles.includes(role)) existing.roles.push(role);
      for (const example of group.examples || []) {
        if (existing.examples.length < MAX_EXAMPLES && !existing.examples.includes(example)) existing.examples.push(example);
      }
    }
  }
  return splitByCriterion(Array.from(merged.values()));
}

/** Fondo efectivo de un elemento como entrada serializable {hex, rgb}. */
export function backgroundEntry(element, doc = document) {
  const rgb = effectiveBackground(element, doc);
  return { hex: rgbToHex(rgb), rgb };
}

// Una fila cuenta como par propio de una serie si su primer plano queda a
// menos de este ΔE00 del color de la paleta (mismo criterio que el panel).
const MATCH_DELTA = 2.5;

/** Fondo de mayor peso en la paleta, si la extracción registró alguno. */
function heaviestBackground(palette) {
  const backgrounds = palette
    .filter((color) => (color.roles || []).includes("background"))
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));
  return backgrounds.length ? { hex: backgrounds[0].hex, rgb: backgrounds[0].rgb } : null;
}

/**
 * Añade un par 1.4.11 aproximado a cada color de serie muestreado (canvas
 * o captura) que no tiene fila propia: sin elemento no hay fondo efectivo,
 * así que se compara contra el fondo dominante de su zona (canvasBackground
 * o captureBackground) o, si falta, contra el fondo de página. Las filas
 * añadidas llevan approximate: true, count 0 y source "canvas" | "capture";
 * las existentes no cambian. Devuelve un contraste nuevo ordenado.
 */
export function addApproximateSeriesContrast(
  palette = [],
  contrast = { text: [], graphics: [] },
  { pageBackground = null, canvasBackground = null, captureBackground = null } = {}
) {
  const graphics = (contrast.graphics || []).slice();
  const seriesRowLabs = graphics
    .filter((group) => (group.roles || []).includes("series"))
    .map((group) => rgbToLab(group.foreground.rgb));
  const fallback = pageBackground || heaviestBackground(palette) || { hex: "#FFFFFF", rgb: { r: 255, g: 255, b: 255 } };
  const added = [];
  for (const color of palette) {
    const roles = color.roles || [];
    const levels = color.levels || [];
    if (!roles.includes("series") || !(levels.includes("canvas") || levels.includes("capture"))) continue;
    const lab = color.lab || rgbToLab(color.rgb);
    if (seriesRowLabs.some((rowLab) => ciede2000(rowLab, lab) < MATCH_DELTA)) continue;
    // El fondo CSS del canvas es más fiable que el acromático dominante de
    // la captura: si el color viene de los dos niveles, manda el canvas.
    const source = levels.includes("canvas") ? "canvas" : "capture";
    const background = (source === "canvas" ? canvasBackground : captureBackground) || fallback;
    const ratio = contrastRatio(color.rgb, background.rgb);
    added.push({
      criterion: "1.4.11",
      foreground: { hex: color.hex, rgb: color.rgb },
      background: { hex: background.hex, rgb: background.rgb },
      ratio,
      threshold: WCAG_THRESHOLDS.graphics,
      largeText: false,
      passes: meetsThreshold(ratio, WCAG_THRESHOLDS.graphics),
      count: 0,
      examples: [],
      roles: ["series"],
      approximate: true,
      source
    });
  }
  if (!added.length) return contrast;
  return { ...contrast, graphics: graphics.concat(added).sort(bySeverity) };
}

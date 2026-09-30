// ------------------------------------------------------------------
// Sprint 3 · Evaluación WCAG 2.1 sobre los colores DECLARADOS (no
// simulados), usando las observaciones color-elemento del nivel 1 de
// extracción:
//   - 1.4.3 texto sobre fondo: 4.5:1 normal, 3:1 texto grande.
//   - 1.4.11 objetos gráficos contra su fondo efectivo: 3:1.
// Cada objeto gráfico (fill/stroke de serie, borde) se compara contra
// el fondo efectivo de su propio elemento: el primer ancestro con
// background-color opaco, componiendo las capas semitransparentes
// intermedias sobre la base blanca del navegador. La confusión entre
// series adyacentes NO se evalúa aquí: eso es distinguibilidad
// (distinguibilidad.js), que trabaja con los colores simulados.
// Los resultados se agrupan por criterio y siempre incluyen la cifra
// obtenida junto al umbral exigido; la comparación se hace sin redondeo.
// Los colores del nivel 3 (captura) no tienen elemento y no entran en
// pares: cuando ese nivel actuó, el orquestador marca la evaluación
// completa como aproximada.
// ------------------------------------------------------------------

import { parseCssColor, rgbToHex } from "../color/conversion.js";
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
function effectiveBackground(element, doc) {
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
        // Roles de las observaciones que aportan al par (sprint 5, bloque 2):
        // permiten distinguir un fallo de serie de uno de borde decorativo.
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

  // Fallos primero y, dentro de cada bloque, del contraste más bajo al más alto.
  const bySeverity = (a, b) => (a.passes === b.passes ? a.ratio - b.ratio : a.passes ? 1 : -1);
  const all = Array.from(groups.values());
  return {
    text: all.filter((group) => group.criterion === "1.4.3").sort(bySeverity),
    graphics: all.filter((group) => group.criterion === "1.4.11").sort(bySeverity)
  };
}

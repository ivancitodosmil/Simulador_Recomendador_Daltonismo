// ------------------------------------------------------------------
// Sprint 3 · Contraste según WCAG 2.1: luminancia relativa y relación
// de contraste (L1 + 0.05) / (L2 + 0.05).
//
// Nota deliberada: WCAG 2.1 define la linealización con el umbral
// 0.03928 (heredado de la especificación sRGB original), mientras que
// conversion.js usa 0.04045 (IEC 61966-2-1 corregida). La diferencia
// numérica es despreciable, pero aquí se implementa la fórmula EXACTA
// del estándar para que las cifras coincidan con cualquier verificador
// WCAG de referencia; por eso no se reutiliza srgbToLinear.
// ------------------------------------------------------------------

/** Umbrales normativos de WCAG 2.1. */
export const WCAG_THRESHOLDS = {
  normalText: 4.5, // 1.4.3, texto normal (AA)
  largeText: 3.0,  // 1.4.3, texto grande (AA)
  graphics: 3.0    // 1.4.11, objetos gráficos y componentes de interfaz
};

/** Linealización de un canal en [0,1] con la fórmula literal de WCAG 2.1. */
function wcagChannel(value) {
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa de un color sRGB {r,g,b} en [0,255], según WCAG 2.1. */
export function relativeLuminance({ r, g, b }) {
  return (
    0.2126 * wcagChannel(r / 255) +
    0.7152 * wcagChannel(g / 255) +
    0.0722 * wcagChannel(b / 255)
  );
}

/**
 * Relación de contraste entre dos colores sRGB: (L1 + 0.05) / (L2 + 0.05),
 * con L1 la luminancia del color más claro. Resultado en [1, 21].
 */
export function contrastRatio(colorA, colorB) {
  const luminanceA = relativeLuminance(colorA);
  const luminanceB = relativeLuminance(colorB);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Comparación contra umbral SIN redondeo previo: 2.999:1 no satisface un
 * criterio de 3:1. El redondeo es solo cosa de la presentación.
 */
export function meetsThreshold(ratio, threshold) {
  return ratio >= threshold;
}

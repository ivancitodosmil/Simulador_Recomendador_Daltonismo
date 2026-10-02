// ------------------------------------------------------------------
// Distinguibilidad entre series (RF05): matriz de diferencias CIEDE2000
// por pares de colores de serie, calculada sobre la paleta ya
// transformada por el simulador exacto (machado.js / brettel.js). El
// llamador decide tipo y severidad según la selección del usuario y
// este módulo ofrece simulateForConfig como enrutador único. Sprint 3.
// ------------------------------------------------------------------

import { ciede2000 } from "../color/diferencia.js";
import { rgbToLab } from "../color/conversion.js";
import { simulateMachado } from "../simulacion/machado.js";
import { simulateTritanopia } from "../simulacion/brettel.js";

/**
 * Umbral de confusión por defecto, no constante del algoritmo: por debajo
 * de este ΔE00 dos series se consideran confundibles. Es un parámetro
 * porque su calibración corresponde al capítulo cinco de la tesis.
 *
 * Justificación del valor 10.0: un orden de magnitud sobre la diferencia
 * apenas perceptible (ΔE00 ≈ 1 en condiciones ideales, Sharma et al.
 * 2005), en la banda que la práctica de visualización trata como
 * "claramente distinguible de un vistazo". Verificación empírica sobre el
 * banco de pruebas: los pares construidos para confundirse quedan por
 * debajo bajo su deficiencia objetivo (7.08-9.56), y los mínimos de la
 * paleta Okabe-Ito bajo protanopia/deuteranopia quedan por encima
 * (11.52-12.26), de modo que el umbral separa ambos casos.
 */
export const DEFAULT_CONFUSION_THRESHOLD = 10.0;

/**
 * Enruta un color sRGB {r,g,b} por el simulador exacto que corresponde a
 * la configuración {type, severity} del usuario. Con type "none" devuelve
 * el color sin transformar.
 */
export function simulateForConfig(rgb, config) {
  if (!config || config.type === "none") return rgb;
  if (config.type === "tritanopia") return simulateTritanopia(rgb);
  return simulateMachado(rgb, config.type, config.severity);
}

/**
 * Matriz simétrica de diferencias CIEDE2000 entre los colores dados
 * (normalmente los colores de serie ya simulados). Devuelve además la
 * lista de pares en conflicto (ΔE00 < umbral), ordenada del más grave
 * al menos grave.
 *
 * colors: [{r,g,b}, ...]  →  { matrix, conflicts: [{i, j, delta}], threshold }
 */
export function computeDistinguishability(colors, { threshold = DEFAULT_CONFUSION_THRESHOLD } = {}) {
  const labs = colors.map((rgb) => rgbToLab(rgb));
  const size = colors.length;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(0));
  const conflicts = [];

  for (let i = 0; i < size; i += 1) {
    for (let j = i + 1; j < size; j += 1) {
      const delta = ciede2000(labs[i], labs[j]);
      matrix[i][j] = delta;
      matrix[j][i] = delta;
      if (delta < threshold) {
        conflicts.push({ i, j, delta });
      }
    }
  }

  conflicts.sort((a, b) => a.delta - b.delta);
  return { matrix, conflicts, threshold };
}

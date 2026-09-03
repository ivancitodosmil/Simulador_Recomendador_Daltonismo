// ------------------------------------------------------------------
// Sprint 2 · Aplicación de las matrices de Machado et al. (2009) para
// protanopia y deuteranopia con severidad graduable.
// Las matrices operan en RGB LINEAL: se linealiza el sRGB con la gamma
// de core/color/conversion.js, se multiplica y se vuelve a comprimir.
// Nunca se aplican sobre el sRGB directo.
// ------------------------------------------------------------------

import { srgbToLinear, linearToSrgb } from "../color/conversion.js";
import { MACHADO_MATRICES, MACHADO_SEVERITY_STEP } from "./matrices.js";

/**
 * Devuelve la matriz precalculada para el tipo y la severidad indicados.
 * La severidad se recorta a [0, 1] y se CUANTIZA al paso publicado de 0.1
 * (los autores sugieren interpolar entre pasos, pero la regla del sprint es
 * usar solo las matrices precalculadas, sin cálculo en tiempo de ejecución;
 * el control de la interfaz avanza en pasos de 0.1, así que el valor del
 * deslizador siempre coincide con una matriz exacta de la tabla).
 */
export function getMachadoMatrix(type, severity) {
  const table = MACHADO_MATRICES[type];
  if (!table) {
    throw new Error("Tipo de deficiencia sin matriz de Machado: " + type);
  }
  const clamped = Math.min(1, Math.max(0, Number(severity) || 0));
  const index = Math.round(clamped / MACHADO_SEVERITY_STEP);
  return table[index];
}

/**
 * Simula un color sRGB {r,g,b} en [0,255] bajo protanopia o deuteranopia
 * con la severidad dada. Con severidad 0 devuelve el color intacto (la
 * matriz es la identidad; se copia sin pasar por la gamma para que el
 * resultado sea bit a bit idéntico al original, como exige el criterio
 * de aceptación).
 */
export function simulateMachado({ r, g, b }, type, severity) {
  const matrix = getMachadoMatrix(type, severity);
  if (matrix === MACHADO_MATRICES[type][0]) {
    return { r, g, b };
  }

  // sRGB -> RGB lineal (linealización gamma de conversion.js).
  const linear = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];

  // Transformación lineal de la deficiencia.
  const simulated = [
    matrix[0][0] * linear[0] + matrix[0][1] * linear[1] + matrix[0][2] * linear[2],
    matrix[1][0] * linear[0] + matrix[1][1] * linear[1] + matrix[1][2] * linear[2],
    matrix[2][0] * linear[0] + matrix[2][1] * linear[1] + matrix[2][2] * linear[2]
  ];

  // RGB lineal -> sRGB, recortando al rango representable.
  const toChannel = (v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, v))))) * 255);
  return { r: toChannel(simulated[0]), g: toChannel(simulated[1]), b: toChannel(simulated[2]) };
}

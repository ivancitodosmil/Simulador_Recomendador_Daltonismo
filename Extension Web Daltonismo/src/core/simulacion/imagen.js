// ------------------------------------------------------------------
// Simulación píxel a píxel de una imagen (RF02, RF03) para la simulación
// por captura, cuando el filtro CSS no puede actuar (canvas WebGL como
// Figma, documentos de imagen, páginas que quedan en blanco al filtrar):
// aplica a cada píxel las mismas matrices de Machado (2009) y el mismo
// método de Brettel (1997) que simulateMachado y simulateTritanopia, con
// la gamma de conversion.js en tabla para procesar una captura entera
// en decenas de milisegundos. Incluye la detección de captura uniforme
// (página en blanco tras el filtro) y la decisión de modo. Versión 1.0.0.
// ------------------------------------------------------------------

import { srgbToLinear, linearToSrgb, SRGB_TO_XYZ, XYZ_TO_SRGB } from "../color/conversion.js";
import { getMachadoMatrix } from "./machado.js";
import { MACHADO_MATRICES } from "./matrices.js";
import { XYZ_TO_LMS, LMS_TO_XYZ, PLANE_485_NORMAL, PLANE_660_NORMAL } from "./brettel.js";

// Linealización en tabla: 256 entradas exactas, las mismas que srgbToLinear(v / 255).
const LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i += 1) LINEAR[i] = srgbToLinear(i / 255);

// Mismos recortes y redondeo que simulateMachado (machado.js).
const machadoChannel = (v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, v))))) * 255);
// Mismos recortes y redondeo que xyzToRgb (conversion.js), que usa simulateTritanopia.
const xyzChannel = (v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);

/**
 * Simula una imagen {data, width, height} (RGBA) bajo la configuración
 * {type, severity} y devuelve otra del mismo tamaño. Píxel a píxel da el
 * mismo resultado que simulateMachado y simulateTritanopia; el alfa se
 * conserva. Con type "none" o severidad 0 devuelve una copia.
 */
export function simulateImageData(image, config) {
  const { data, width, height } = image;
  const out = new Uint8ClampedArray(data.length);
  if (!config || config.type === "none") {
    out.set(data);
    return { data: out, width, height };
  }

  if (config.type === "tritanopia") {
    const S = SRGB_TO_XYZ;
    const XL = XYZ_TO_LMS;
    const LX = LMS_TO_XYZ;
    const XS = XYZ_TO_SRGB;
    for (let i = 0; i < data.length; i += 4) {
      const lr = LINEAR[data[i]];
      const lg = LINEAR[data[i + 1]];
      const lb = LINEAR[data[i + 2]];
      const x = S[0][0] * lr + S[0][1] * lg + S[0][2] * lb;
      const y = S[1][0] * lr + S[1][1] * lg + S[1][2] * lb;
      const z = S[2][0] * lr + S[2][1] * lg + S[2][2] * lb;
      const l = XL[0][0] * x + XL[0][1] * y + XL[0][2] * z;
      const m = XL[1][0] * x + XL[1][1] * y + XL[1][2] * z;
      // Proyección sobre el semiplano del lado correspondiente del eje neutro.
      const normal = m > l ? PLANE_485_NORMAL : PLANE_660_NORMAL;
      const s = -(normal.l * l + normal.m * m) / normal.s;
      const X = LX[0][0] * l + LX[0][1] * m + LX[0][2] * s;
      const Y = LX[1][0] * l + LX[1][1] * m + LX[1][2] * s;
      const Z = LX[2][2] * s;
      out[i] = xyzChannel(XS[0][0] * X + XS[0][1] * Y + XS[0][2] * Z);
      out[i + 1] = xyzChannel(XS[1][0] * X + XS[1][1] * Y + XS[1][2] * Z);
      out[i + 2] = xyzChannel(XS[2][0] * X + XS[2][1] * Y + XS[2][2] * Z);
      out[i + 3] = data[i + 3];
    }
    return { data: out, width, height };
  }

  const matrix = getMachadoMatrix(config.type, config.severity);
  if (matrix === MACHADO_MATRICES[config.type][0]) {
    // Severidad 0: identidad, copia bit a bit como simulateMachado.
    out.set(data);
    return { data: out, width, height };
  }
  for (let i = 0; i < data.length; i += 4) {
    const lr = LINEAR[data[i]];
    const lg = LINEAR[data[i + 1]];
    const lb = LINEAR[data[i + 2]];
    out[i] = machadoChannel(matrix[0][0] * lr + matrix[0][1] * lg + matrix[0][2] * lb);
    out[i + 1] = machadoChannel(matrix[1][0] * lr + matrix[1][1] * lg + matrix[1][2] * lb);
    out[i + 2] = machadoChannel(matrix[2][0] * lr + matrix[2][1] * lg + matrix[2][2] * lb);
    out[i + 3] = data[i + 3];
  }
  return { data: out, width, height };
}

/**
 * ¿La imagen es casi de un solo color? Sirve para detectar que el filtro
 * dejó la página en blanco: se busca el color más frecuente (en cubos de
 * 16 niveles) y se mide qué fracción de píxeles queda a menos de
 * tolerance (diferencia máxima por canal) de él.
 */
export function isNearlyUniform(image, { tolerance = 12, share = 0.97, maxSamples = 4096 } = {}) {
  const { data, width, height } = image;
  const total = width * height;
  if (!total) return true;
  const step = Math.max(1, Math.floor(total / maxSamples));
  const bins = new Map();
  let samples = 0;
  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    const key = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bin.count += 1;
    bin.r += data[i];
    bin.g += data[i + 1];
    bin.b += data[i + 2];
    bins.set(key, bin);
    samples += 1;
  }
  let mode = null;
  for (const bin of bins.values()) if (!mode || bin.count > mode.count) mode = bin;
  const center = [mode.r / mode.count, mode.g / mode.count, mode.b / mode.count];
  let near = 0;
  for (let p = 0; p < total; p += step) {
    const i = p * 4;
    if (Math.abs(data[i] - center[0]) <= tolerance && Math.abs(data[i + 1] - center[1]) <= tolerance && Math.abs(data[i + 2] - center[2]) <= tolerance) near += 1;
  }
  return near / samples >= share;
}

/**
 * Decide cómo simular a partir del perfil de la página que informa el
 * content script: por captura si el documento es una imagen, si una
 * imagen grande ocupa la mayor parte de la vista o si un canvas que no es
 * 2D (WebGL) ocupa al menos la mitad; con filtro en el resto de casos.
 */
export function decideSimulationMode(profile, { imageShare = 0.6, webglShare = 0.5 } = {}) {
  if (!profile) return "filter";
  if (profile.isImageDocument) return "capture";
  if ((profile.imageShare || 0) >= imageShare) return "capture";
  if ((profile.webglShare || 0) >= webglShare) return "capture";
  return "filter";
}

// ------------------------------------------------------------------
// Simulación de tritanopia (RF02, RF03) por el método de Brettel,
// Viénot y Mollon (1997), "Computerized simulation of color appearance
// for dichromats", JOSA A 14(10). Sprint 2.
//
// El método proyecta cada estímulo, en el espacio de conos LMS, sobre
// dos semiplanos que comparten el eje neutro (la diagonal acromática):
// un semiplano anclado en el estímulo monocromático de 485 nm y otro en
// el de 660 nm, que son los anclajes que el artículo asigna al tritán.
// La tritanopia se modela como dicromatopsia completa: no admite
// graduación de severidad.
//
// Espacio LMS: matriz de Hunt-Pointer-Estévez normalizada a D65, de
// modo que el blanco D65 es (1,1,1) y el eje neutro es la diagonal.
// El paso sRGB <-> XYZ (con su linealización gamma) se reutiliza de
// core/color/conversion.js.
// ------------------------------------------------------------------

import { rgbToXyz, xyzToRgb } from "../color/conversion.js";

// XYZ (D65) -> LMS, Hunt-Pointer-Estévez normalizada a D65.
const XYZ_TO_LMS = [
  [0.4002, 0.7076, -0.0808],
  [-0.2263, 1.1653, 0.0457],
  [0.0, 0.0, 0.9182]
];

// Inversa de la anterior (constante documentada, no se invierte en runtime).
const LMS_TO_XYZ = [
  [1.86007, -1.12948, 0.21990],
  [0.36122, 0.63880, -0.00001],
  [0.0, 0.0, 1.08909]
];

// Anclajes del tritán en LMS, derivados de las funciones colorimétricas
// CIE 1931 (observador 2°) pasadas por la matriz XYZ_TO_LMS:
//   485 nm: XYZ = (0.05795, 0.16930, 0.61620) -> LMS (0.093199, 0.212331, 0.565795)
//   660 nm: XYZ = (0.16490, 0.06100, 0.00000) -> LMS (0.109157, 0.033766, 0.000000)
// Normales de los planos de proyección n = W × A, con W = (1,1,1):
const PLANE_485_NORMAL = { l: 0.353464, m: -0.472596, s: 0.119132 };
const PLANE_660_NORMAL = { l: -0.033766, m: 0.109157, s: -0.075391 };

/**
 * Simula la tritanopia (pérdida del cono S) para un color sRGB {r,g,b}
 * en [0,255]. Conserva L y M y sustituye S por su proyección sobre el
 * semiplano correspondiente.
 *
 * Elección de semiplano: ambos planos contienen el eje neutro y sus
 * proyecciones coinciden exactamente sobre el plano L = M (con W=(1,1,1)
 * ambos devuelven S' = L), de modo que ese plano es la frontera y la
 * transformación resulta continua: M > L (lado azul-verdoso) -> plano
 * de 485 nm; M <= L (lado rojizo) -> plano de 660 nm.
 */
export function simulateTritanopia(rgb) {
  // sRGB -> XYZ (linealización gamma incluida en conversion.js).
  const { x, y, z } = rgbToXyz(rgb);

  // XYZ -> LMS.
  const l = XYZ_TO_LMS[0][0] * x + XYZ_TO_LMS[0][1] * y + XYZ_TO_LMS[0][2] * z;
  const m = XYZ_TO_LMS[1][0] * x + XYZ_TO_LMS[1][1] * y + XYZ_TO_LMS[1][2] * z;

  // Proyección sobre el semiplano del lado correspondiente del eje neutro:
  // n · (L, M, S') = 0  =>  S' = -(n_L·L + n_M·M) / n_S.
  const normal = m > l ? PLANE_485_NORMAL : PLANE_660_NORMAL;
  const s = -(normal.l * l + normal.m * m) / normal.s;

  // LMS -> XYZ -> sRGB (compresión gamma y recorte de gamut en conversion.js).
  return xyzToRgb({
    x: LMS_TO_XYZ[0][0] * l + LMS_TO_XYZ[0][1] * m + LMS_TO_XYZ[0][2] * s,
    y: LMS_TO_XYZ[1][0] * l + LMS_TO_XYZ[1][1] * m + LMS_TO_XYZ[1][2] * s,
    z: LMS_TO_XYZ[2][2] * s
  });
}

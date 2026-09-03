// ------------------------------------------------------------------
// Sprint 3 · Diferencia de color CIEDE2000 (ΔE00), programada a partir
// de las notas de implementación de Sharma, Wu y Dalal (2005), "The
// CIEDE2000 Color-Difference Formula: Implementation Notes,
// Supplementary Test Data, and Mathematical Observations", Color
// Research & Application 30(1). Incluye el término de rotación RT que
// corrige la región azul (h̄' ≈ 275°). Sin librerías.
//
// La validación que justifica programar la fórmula en lugar de usar
// una librería es SHARMA_TEST_PAIRS: los 34 pares publicados por esos
// autores, reproducidos con tolerancia de una diezmilésima por
// runSharmaValidation() (invocada desde las pruebas del sprint).
// Parámetros paramétricos kL = kC = kH = 1.
// ------------------------------------------------------------------

const POW25_7 = Math.pow(25, 7);
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Ángulo de tono en grados [0, 360); 0 por convención cuando a' = b = 0. */
function hueAngle(aPrime, b) {
  if (aPrime === 0 && b === 0) return 0;
  const angle = Math.atan2(b, aPrime) * RAD_TO_DEG;
  return angle < 0 ? angle + 360 : angle;
}

/**
 * ΔE00 entre dos colores CIELAB {l, a, b}, siguiendo paso a paso las
 * ecuaciones (2) a (22) de Sharma et al. (2005).
 */
export function ciede2000(lab1, lab2) {
  const L1 = lab1.l, a1 = lab1.a, b1 = lab1.b;
  const L2 = lab2.l, a2 = lab2.a, b2 = lab2.b;

  // Paso 1: C', h' con el ajuste G de la croma media.
  const C1 = Math.sqrt(a1 * a1 + b1 * b1);
  const C2 = Math.sqrt(a2 * a2 + b2 * b2);
  const meanC = (C1 + C2) / 2;
  const meanC7 = Math.pow(meanC, 7);
  const G = 0.5 * (1 - Math.sqrt(meanC7 / (meanC7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.sqrt(a1p * a1p + b1 * b1);
  const C2p = Math.sqrt(a2p * a2p + b2 * b2);
  const h1p = hueAngle(a1p, b1);
  const h2p = hueAngle(a2p, b2);

  // Paso 2: diferencias ΔL', ΔC', Δh', ΔH'.
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * DEG_TO_RAD) / 2);

  // Paso 3: medias y funciones de ponderación.
  const meanLp = (L1 + L2) / 2;
  const meanCp = (C1p + C2p) / 2;
  let meanHp = h1p + h2p; // caso C1p·C2p = 0 (ec. 14, rama final)
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) meanHp = (h1p + h2p) / 2;
    else if (h1p + h2p < 360) meanHp = (h1p + h2p + 360) / 2;
    else meanHp = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos((meanHp - 30) * DEG_TO_RAD) +
    0.24 * Math.cos(2 * meanHp * DEG_TO_RAD) +
    0.32 * Math.cos((3 * meanHp + 6) * DEG_TO_RAD) -
    0.20 * Math.cos((4 * meanHp - 63) * DEG_TO_RAD);

  const meanLpMinus50Sq = (meanLp - 50) * (meanLp - 50);
  const SL = 1 + (0.015 * meanLpMinus50Sq) / Math.sqrt(20 + meanLpMinus50Sq);
  const SC = 1 + 0.045 * meanCp;
  const SH = 1 + 0.015 * meanCp * T;

  // Término de rotación de la región azul (h̄' ≈ 275°).
  const deltaTheta = 30 * Math.exp(-Math.pow((meanHp - 275) / 25, 2));
  const meanCp7 = Math.pow(meanCp, 7);
  const RC = 2 * Math.sqrt(meanCp7 / (meanCp7 + POW25_7));
  const RT = -Math.sin(2 * deltaTheta * DEG_TO_RAD) * RC;

  const termL = dLp / SL;
  const termC = dCp / SC;
  const termH = dHp / SH;
  return Math.sqrt(termL * termL + termC * termC + termH * termH + RT * termC * termH);
}

/**
 * Los 34 pares de prueba publicados por Sharma, Wu y Dalal (2005),
 * tabla 1: [L1, a1, b1, L2, a2, b2, ΔE00 esperado]. Cubren los casos
 * límite de la discontinuidad de tono (pares 1-16) y colores reales
 * (pares 17-34).
 */
export const SHARMA_TEST_PAIRS = [
  [50.0000, 2.6772, -79.7751, 50.0000, 0.0000, -82.7485, 2.0425],
  [50.0000, 3.1571, -77.2803, 50.0000, 0.0000, -82.7485, 2.8615],
  [50.0000, 2.8361, -74.0200, 50.0000, 0.0000, -82.7485, 3.4412],
  [50.0000, -1.3802, -84.2814, 50.0000, 0.0000, -82.7485, 1.0000],
  [50.0000, -1.1848, -84.8006, 50.0000, 0.0000, -82.7485, 1.0000],
  [50.0000, -0.9009, -85.5211, 50.0000, 0.0000, -82.7485, 1.0000],
  [50.0000, 0.0000, 0.0000, 50.0000, -1.0000, 2.0000, 2.3669],
  [50.0000, -1.0000, 2.0000, 50.0000, 0.0000, 0.0000, 2.3669],
  [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0009, 7.1792],
  [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0010, 7.1792],
  [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0011, 7.2195],
  [50.0000, 2.4900, -0.0010, 50.0000, -2.4900, 0.0012, 7.2195],
  [50.0000, -0.0010, 2.4900, 50.0000, 0.0009, -2.4900, 4.8045],
  [50.0000, -0.0010, 2.4900, 50.0000, 0.0010, -2.4900, 4.8045],
  [50.0000, -0.0010, 2.4900, 50.0000, 0.0011, -2.4900, 4.7461],
  [50.0000, 2.5000, 0.0000, 50.0000, 0.0000, -2.5000, 4.3065],
  [50.0000, 2.5000, 0.0000, 73.0000, 25.0000, -18.0000, 27.1492],
  [50.0000, 2.5000, 0.0000, 61.0000, -5.0000, 29.0000, 22.8977],
  [50.0000, 2.5000, 0.0000, 56.0000, -27.0000, -3.0000, 31.9030],
  [50.0000, 2.5000, 0.0000, 58.0000, 24.0000, 15.0000, 19.4535],
  [50.0000, 2.5000, 0.0000, 50.0000, 3.1736, 0.5854, 1.0000],
  [50.0000, 2.5000, 0.0000, 50.0000, 3.2972, 0.0000, 1.0000],
  [50.0000, 2.5000, 0.0000, 50.0000, 1.8634, 0.5757, 1.0000],
  [50.0000, 2.5000, 0.0000, 50.0000, 3.2592, 0.3350, 1.0000],
  [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
  [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.2630],
  [61.2901, 3.7196, -5.3901, 61.4292, 2.2480, -4.9620, 1.8731],
  [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
  [22.7233, 20.0904, -46.6940, 23.0331, 14.9730, -42.5619, 2.0373],
  [36.4612, 47.8580, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
  [90.8027, -2.0831, 1.4410, 91.1528, -1.6435, 0.0447, 1.4441],
  [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
  [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
  [2.0776, 0.0795, -1.1350, 0.9033, -0.0636, -0.5514, 0.9082]
];

/**
 * Ejecuta la validación de los 34 pares. Devuelve el detalle: cuántos
 * pasan con la tolerancia dada (por defecto una diezmilésima), el error
 * máximo observado y los fallos si los hubiera.
 */
export function runSharmaValidation(tolerance = 0.0001) {
  const failures = [];
  let maxError = 0;
  SHARMA_TEST_PAIRS.forEach(([L1, a1, b1, L2, a2, b2, expected], index) => {
    const computed = ciede2000({ l: L1, a: a1, b: b1 }, { l: L2, a: a2, b: b2 });
    const error = Math.abs(computed - expected);
    if (error > maxError) maxError = error;
    if (error > tolerance) {
      failures.push({ pair: index + 1, expected, computed, error });
    }
  });
  return {
    total: SHARMA_TEST_PAIRS.length,
    passed: SHARMA_TEST_PAIRS.length - failures.length,
    maxError,
    failures
  };
}

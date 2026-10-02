// ------------------------------------------------------------------
// Algoritmo de recomendación de paleta (RF06), conforme a la sección
// 3.5.4 de la tesis: salida temprana + cuatro pasos. Sprint 4.
//
// - Salida temprana: si la paleta original supera el contraste (los
//   pares 1.4.11 realmente evaluados, que el llamador entrega como
//   recuento de fallos) y la distinguibilidad bajo la simulación a
//   severidad máxima, se informa el cumplimiento y no se propone
//   reemplazo.
// - Paso 1: la familia la indica el usuario; aquí llega como parámetro.
// - Paso 2: filtra los esquemas acreditados para el tipo de deficiencia
//   y con capacidad suficiente; si ninguno alcanza, devuelve el aviso
//   de rediseño con la razón concreta (series frente a capacidad).
// - Paso 3: asignación inyectiva por cercanía CIEDE2000 sobre los
//   colores originales (cualitativas); en las secuenciales se preserva
//   el orden de la escala por claridad (L de CIELAB), sin
//   emparejamiento uno a uno.
// - Paso 4: revalidación con la simulación siempre a severidad máxima,
//   de modo que la propuesta sea estable aunque el usuario explore
//   severidades menores. Si falla, sustituye el color conflictivo por otro libre
//   del mismo esquema (solo cualitativas: en una secuencial la
//   sustitución rompería el orden de la escala, así que se pasa al
//   siguiente esquema) o continúa con el siguiente candidato.
//
// Los roles de fondo y texto no se reemplazan: la recomendación opera
// exclusivamente sobre los colores de serie que recibe.
// El contraste de la revalidación se mide contra el fondo dominante
// entregado por el llamador, porque una paleta hipotética aún no tiene
// elementos en la página contra los que medir fondos efectivos.
// ------------------------------------------------------------------

import { PALETTE_CATALOG } from "./catalogo.js";
import { ciede2000 } from "../color/diferencia.js";
import { hexToRgb, rgbToLab } from "../color/conversion.js";
import { contrastRatio, meetsThreshold, WCAG_THRESHOLDS } from "../color/contraste.js";
import {
  computeDistinguishability,
  simulateForConfig,
  DEFAULT_CONFUSION_THRESHOLD
} from "../evaluacion/distinguibilidad.js";

// Tope de sustituciones por esquema en la revalidación (paso 4).
const MAX_SWAPS_PER_SCHEME = 8;

/** Mínimo ΔE00 fuera de la diagonal de una matriz de distinguibilidad. */
function minOffDiagonal(matrix) {
  let min = Infinity;
  for (let i = 0; i < matrix.length; i += 1) {
    for (let j = i + 1; j < matrix.length; j += 1) {
      if (matrix[i][j] < min) min = matrix[i][j];
    }
  }
  return min === Infinity ? null : min;
}

/**
 * Paso 3 (cualitativas): asignación inyectiva por cercanía perceptual.
 * Se ordenan todos los pares (serie, color de esquema) por ΔE00 sobre los
 * originales y se asignan en orden voraz saltando series y colores ya
 * usados: dos conjuntos (usedSeries / usedScheme) garantizan que ningún
 * color del esquema se entregue dos veces.
 */
function assignQualitative(seriesColors, schemeRgbs) {
  const seriesLabs = seriesColors.map((color) => rgbToLab(color.rgb));
  const schemeLabs = schemeRgbs.map((rgb) => rgbToLab(rgb));

  const pairs = [];
  for (let i = 0; i < seriesLabs.length; i += 1) {
    for (let j = 0; j < schemeLabs.length; j += 1) {
      pairs.push({ i, j, delta: ciede2000(seriesLabs[i], schemeLabs[j]) });
    }
  }
  pairs.sort((a, b) => a.delta - b.delta);

  const usedSeries = new Set();
  const usedScheme = new Set();
  const assignment = new Array(seriesColors.length).fill(-1);
  for (const pair of pairs) {
    if (usedSeries.has(pair.i) || usedScheme.has(pair.j)) continue;
    assignment[pair.i] = pair.j;
    usedSeries.add(pair.i);
    usedScheme.add(pair.j);
    if (usedSeries.size === seriesColors.length) break;
  }
  return assignment;
}

/**
 * Paso 3 (secuenciales): sin emparejamiento uno a uno. Se toman N pasos
 * equiespaciados de la rampa (almacenada de oscuro a claro) y se asignan
 * por rango de claridad: la serie más oscura recibe el paso más oscuro.
 */
function assignSequential(seriesColors, schemeRgbs) {
  const count = seriesColors.length;
  const stepIndices = [];
  for (let k = 0; k < count; k += 1) {
    let index = Math.round((k * (schemeRgbs.length - 1)) / (count - 1));
    // Garantiza índices estrictamente crecientes ante empates de redondeo.
    if (stepIndices.length && index <= stepIndices[stepIndices.length - 1]) {
      index = stepIndices[stepIndices.length - 1] + 1;
    }
    stepIndices.push(index);
  }

  const byLightness = seriesColors
    .map((color, i) => ({ i, l: rgbToLab(color.rgb).l }))
    .sort((a, b) => a.l - b.l);

  const assignment = new Array(count).fill(-1);
  byLightness.forEach((entry, rank) => {
    assignment[entry.i] = stepIndices[rank];
  });
  return assignment;
}

/**
 * Paso 4: revalida la propuesta (contraste 3:1 contra el fondo dominante
 * y distinguibilidad bajo simulación a severidad máxima). En cualitativas
 * intenta reparar sustituyendo el color conflictivo por otro libre del
 * mismo esquema; devuelve si pasó, las sustituciones y el ΔE00 mínimo.
 */
function revalidate(assignment, schemeRgbs, backgroundRgb, config, threshold, allowSwaps) {
  const current = assignment.slice();
  let swaps = 0;

  for (let round = 0; round <= MAX_SWAPS_PER_SCHEME; round += 1) {
    const proposedRgbs = current.map((j) => schemeRgbs[j]);
    const simulated = proposedRgbs.map((rgb) => simulateForConfig(rgb, config));
    const dist = computeDistinguishability(simulated, { threshold });
    const contrastFailures = [];
    proposedRgbs.forEach((rgb, index) => {
      if (!meetsThreshold(contrastRatio(rgb, backgroundRgb), WCAG_THRESHOLDS.graphics)) {
        contrastFailures.push(index);
      }
    });

    if (contrastFailures.length === 0 && dist.conflicts.length === 0) {
      return { passed: true, assignment: current, swaps, minDelta: minOffDiagonal(dist.matrix) };
    }
    if (!allowSwaps || round === MAX_SWAPS_PER_SCHEME) break;

    // Índice a reparar: primero los fallos de contraste; si no, el miembro
    // más implicado en conflictos de distinguibilidad.
    let target;
    if (contrastFailures.length) {
      target = contrastFailures[0];
    } else {
      const involvement = new Map();
      for (const conflict of dist.conflicts) {
        involvement.set(conflict.i, (involvement.get(conflict.i) || 0) + 1);
        involvement.set(conflict.j, (involvement.get(conflict.j) || 0) + 1);
      }
      target = [...involvement.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    // Mejor sustituto: color libre del esquema que cumpla contraste y
    // maximice la separación mínima simulada con el resto de la propuesta.
    const used = new Set(current);
    let best = null;
    for (let j = 0; j < schemeRgbs.length; j += 1) {
      if (used.has(j)) continue;
      const candidate = schemeRgbs[j];
      if (!meetsThreshold(contrastRatio(candidate, backgroundRgb), WCAG_THRESHOLDS.graphics)) continue;
      const candidateSimulated = simulateForConfig(candidate, config);
      const candidateLab = rgbToLab(candidateSimulated);
      let minSeparation = Infinity;
      simulated.forEach((other, index) => {
        if (index === target) return;
        const delta = ciede2000(candidateLab, rgbToLab(other));
        if (delta < minSeparation) minSeparation = delta;
      });
      if (minSeparation >= threshold && (!best || minSeparation > best.minSeparation)) {
        best = { j, minSeparation };
      }
    }
    if (!best) break; // sin sustituto viable: el esquema no puede repararse

    current[target] = best.j;
    swaps += 1;
  }
  return { passed: false, assignment: current, swaps };
}

/**
 * Punto de entrada de la recomendación.
 * options:
 *   seriesColors: [{hex, rgb}] colores de serie originales (sin simular)
 *   backgroundRgb: fondo dominante del dashboard
 *   deficiencyType: "protanopia" | "deuteranopia" | "tritanopia"
 *   family: "qualitative" | "sequential" (paso 1: lo indica el usuario)
 *   threshold: umbral de confusión ΔE00
 *   originalGraphicsFailures: fallos 1.4.11 de la evaluación de contraste
 *     real (los pares con elemento; una paleta con series solo en
 *     canvas no tiene pares y llega con 0)
 * Devuelve un objeto con outcome: "compliant" | "proposal" | "redesign"
 * (más los informativos "no-deficiency" e "insufficient-series").
 */
export function recommendPalette({
  seriesColors = [],
  backgroundRgb = { r: 255, g: 255, b: 255 },
  deficiencyType = "none",
  family = "qualitative",
  threshold = DEFAULT_CONFUSION_THRESHOLD,
  originalGraphicsFailures = 0
} = {}) {
  if (deficiencyType === "none") {
    return { outcome: "no-deficiency" };
  }
  if (seriesColors.length < 2) {
    return { outcome: "insufficient-series" };
  }

  // Severidad siempre máxima: dos corridas dan la misma propuesta aunque
  // el usuario esté explorando una severidad menor.
  const config = { type: deficiencyType, severity: 1 };

  // ---- Salida temprana ----
  const originalSimulated = seriesColors.map((color) => simulateForConfig(color.rgb, config));
  const originalDist = computeDistinguishability(originalSimulated, { threshold });
  if (originalGraphicsFailures === 0 && originalDist.conflicts.length === 0) {
    return {
      outcome: "compliant",
      deficiencyType,
      threshold,
      minDelta: minOffDiagonal(originalDist.matrix)
    };
  }

  // ---- Paso 2: candidatos acreditados con capacidad suficiente ----
  const accredited = PALETTE_CATALOG.filter(
    (scheme) => scheme.family === family && scheme.accreditedFor.includes(deficiencyType)
  );
  const candidates = accredited.filter((scheme) => scheme.size >= seriesColors.length);
  if (candidates.length === 0) {
    return {
      outcome: "redesign",
      exhausted: false,
      seriesCount: seriesColors.length,
      maxAvailable: accredited.reduce((max, scheme) => Math.max(max, scheme.size), 0),
      family,
      deficiencyType
    };
  }

  // ---- Pasos 3 y 4 por candidato, en orden de catálogo ----
  const attempts = [];
  for (const scheme of candidates) {
    // En secuenciales solo se usa el tramo de la rampa que supera 3:1
    // sobre el fondo dominante: el extremo claro de viridis, cividis o
    // la escala monocroma nunca cumpliría sobre un fondo blanco. El
    // orden de la escala se preserva dentro del tramo. Si el tramo no
    // alcanza para todas las series, el esquema se descarta con razón.
    let poolHexes = scheme.colors;
    if (family === "sequential") {
      poolHexes = scheme.colors.filter((hex) =>
        meetsThreshold(contrastRatio(hexToRgb(hex), backgroundRgb), WCAG_THRESHOLDS.graphics)
      );
      if (poolHexes.length < seriesColors.length) {
        attempts.push({
          schemeId: scheme.id,
          schemeName: scheme.name,
          passed: false,
          swaps: 0,
          reason: "tramo-con-contraste-insuficiente"
        });
        continue;
      }
    }
    const poolRgbs = poolHexes.map((hex) => hexToRgb(hex));

    const assignment =
      family === "sequential"
        ? assignSequential(seriesColors, poolRgbs)
        : assignQualitative(seriesColors, poolRgbs);
    const result = revalidate(
      assignment,
      poolRgbs,
      backgroundRgb,
      config,
      threshold,
      family === "qualitative"
    );
    attempts.push({ schemeId: scheme.id, schemeName: scheme.name, passed: result.passed, swaps: result.swaps });

    if (result.passed) {
      return {
        outcome: "proposal",
        deficiencyType,
        threshold,
        family,
        scheme: { id: scheme.id, name: scheme.name, size: scheme.size, accreditedFor: scheme.accreditedFor },
        mapping: seriesColors.map((color, index) => ({
          originalHex: color.hex,
          proposedHex: poolHexes[result.assignment[index]],
          proposedRgb: poolRgbs[result.assignment[index]]
        })),
        revalidation: {
          iterations: attempts.length,
          swaps: result.swaps,
          minDelta: result.minDelta
        },
        attempts
      };
    }
  }

  // Ningún candidato superó la revalidación: también es aviso de rediseño,
  // con la traza de lo intentado como razón.
  return {
    outcome: "redesign",
    exhausted: true,
    seriesCount: seriesColors.length,
    maxAvailable: candidates.reduce((max, scheme) => Math.max(max, scheme.size), 0),
    family,
    deficiencyType,
    attempts
  };
}

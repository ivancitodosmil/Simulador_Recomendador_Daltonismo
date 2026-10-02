// ------------------------------------------------------------------
// Generador del reporte de evaluación (RF08): reúne los datos ya
// calculados por el panel (no vuelve a evaluar nada) en una estructura
// serializable que consume plantilla.js. Todo el contenido es local,
// sin peticiones de red ni recursos externos (RNF02). Sprint 5.
// ------------------------------------------------------------------

import { rgbToHex } from "../color/conversion.js";
import { simulateForConfig } from "../evaluacion/distinguibilidad.js";

/**
 * Construye la estructura de datos del reporte.
 * options:
 *   evaluation: carga guardada por el service worker (paleta, contraste,
 *     niveles, stats, url, evaluatedAt, approximate)
 *   extensionVersion: versión del manifest
 *   simulation: { type, severity } vigentes en el panel
 *   threshold: umbral de confusión ΔE00 vigente
 *   family: familia indicada por el usuario (qualitative | sequential)
 *   series: entradas de serie (las de la matriz)
 *   selection: Map hex → boolean (series consideradas)
 *   notes: Map hex → nota del criterio por defecto (o null)
 *   simulatedRgbs: colores de serie simulados con la configuración vigente
 *   distSimulated / distOriginal: matrices de distinguibilidad vigentes
 *   recommendation: resultado de recommendPalette
 *   overview: desenlace bajo las tres deficiencias cuando no hay
 *     simulación: [{ type, outcome, schemeName, minDelta, seriesCount,
 *     maxAvailable, exhausted }]
 */
export function buildReportData({
  evaluation,
  extensionVersion,
  simulation,
  threshold,
  family,
  series = [],
  selection = new Map(),
  notes = new Map(),
  simulatedRgbs = [],
  distSimulated = null,
  distOriginal = null,
  recommendation = null,
  overview = null
}) {
  const palette = evaluation.palette || [];
  const contrast = evaluation.contrast || { text: [], graphics: [] };

  const consideredSeries = series.map((entry, index) => ({
    hex: entry.hex,
    simulatedHex: simulatedRgbs[index] ? rgbToHex(simulatedRgbs[index]) : entry.hex,
    share: entry.share,
    selected: selection.get(entry.hex) !== false,
    note: notes.get(entry.hex) || null,
    hasElements: (entry.examples || []).length > 0
  }));

  // Colores considerados que provienen del muestreo de canvas: la
  // previsualización no puede recolorearlos (exclusión documentada en
  // el content script) y el reporte lo declara.
  const selectedWithoutElements = consideredSeries.filter(
    (entry) => entry.selected && !entry.hasElements
  ).length;

  // Colores agrupados como variante de suavizado de una serie declarada
  // (absorción de la selección por defecto): el reporte lo declara si ocurrió.
  const variantsGrouped = consideredSeries.filter(
    (entry) => typeof entry.note === "string" && entry.note.startsWith("variante de")
  ).length;

  const conflicts = (distSimulated && distSimulated.conflicts ? distSimulated.conflicts : []).map(
    (conflict) => ({
      aHex: series[conflict.i].hex,
      bHex: series[conflict.j].hex,
      aSimulatedHex: simulatedRgbs[conflict.i] ? rgbToHex(simulatedRgbs[conflict.i]) : series[conflict.i].hex,
      bSimulatedHex: simulatedRgbs[conflict.j] ? rgbToHex(simulatedRgbs[conflict.j]) : series[conflict.j].hex,
      deltaSimulated: conflict.delta,
      deltaOriginal: distOriginal ? distOriginal.matrix[conflict.i][conflict.j] : null
    })
  );

  const contrastRow = (group) => ({
    foregroundHex: group.foreground.hex,
    backgroundHex: group.background.hex,
    ratio: group.ratio,
    threshold: group.threshold,
    passes: group.passes,
    largeText: group.largeText === true,
    count: group.count,
    roles: group.roles || [],
    examples: group.examples || []
  });

  return {
    meta: {
      url: evaluation.url || "(sin dirección registrada)",
      // Título de la pestaña evaluada (portada y nombre de archivo del PDF).
      title: evaluation.title || "",
      evaluatedAt: evaluation.evaluatedAt || Date.now(),
      generatedAt: Date.now(),
      extensionVersion,
      levels: evaluation.levels || [],
      simulationType: simulation.type,
      simulationSeverity: simulation.severity,
      threshold,
      family
    },
    warnings: {
      approximate: evaluation.approximate === true,
      selectedWithoutElements,
      variantsGrouped
    },
    palette: palette.map((color) => ({
      hex: color.hex,
      // Versión simulada con la configuración vigente (fichas del reporte).
      simulatedHex: rgbToHex(simulateForConfig(color.rgb, simulation)),
      roles: color.roles,
      levels: color.levels,
      share: color.share,
      examples: color.examples || []
    })),
    contrast: {
      text: contrast.text.map(contrastRow),
      graphics: contrast.graphics.map(contrastRow)
    },
    conflicts,
    // Matriz ΔE00 completa (simulada), en el orden de consideredSeries.
    matrix: distSimulated && distSimulated.matrix ? distSimulated.matrix : null,
    consideredSeries,
    recommendation,
    overview
  };
}

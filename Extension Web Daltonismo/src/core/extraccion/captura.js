// ------------------------------------------------------------------
// Sprint 1 · Nivel 3 de extracción (respaldo): captura de la pestaña
// visible con chrome.tabs.captureVisibleTab, procesada con el mismo
// muestreo y corte mediano de canvas.js. Se ejecuta en el service
// worker (usa OffscreenCanvas, no DOM). Su resultado se marca como
// aproximado porque pierde la relación entre color y elemento.
// ------------------------------------------------------------------

import { samplePixels, medianCutQuantize, discardRareTones } from "./canvas.js";

// Lado mayor al que se reduce la captura antes de muestrear: acota el coste.
const MAX_CAPTURE_SIDE = 1200;

// La captura incluye texto y bordes de toda la página: se muestrea más y se
// filtra un poco más fino que en un canvas individual.
const MAX_CAPTURE_SAMPLES = 80000;
const MIN_CAPTURE_TONE_SHARE = 0.008;

/**
 * Captura la pestaña visible de la ventana indicada y devuelve entradas
 * {rgb, weight, role} con la marca approximate: true.
 */
export async function extractFromCapture(windowId) {
  // PNG para no introducir artefactos de compresión en los colores.
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  // Reducción previa: el corte mediano no necesita la resolución completa.
  const scale = Math.min(1, MAX_CAPTURE_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const imageData = context.getImageData(0, 0, width, height);
  const pixels = samplePixels(imageData, MAX_CAPTURE_SAMPLES);
  const quantized = discardRareTones(medianCutQuantize(pixels), pixels.length, MIN_CAPTURE_TONE_SHARE);

  // Sin relación color-elemento solo cabe una heurística mínima de rol:
  // el tono dominante de la captura es el fondo de la página.
  const dominant = quantized.reduce((a, b) => (b.count > a.count ? b : a), quantized[0]);
  const entries = quantized.map((color) => ({
    rgb: color.rgb,
    weight: color.count / pixels.length,
    role: color === dominant ? "background" : "series"
  }));

  return { entries, approximate: true, samples: pixels.length };
}

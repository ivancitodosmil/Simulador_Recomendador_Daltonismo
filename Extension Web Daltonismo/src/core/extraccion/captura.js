// ------------------------------------------------------------------
// Nivel 3 de extracción, respaldo (RF01): captura de la pestaña visible
// con chrome.tabs.captureVisibleTab, recortada a las zonas de gráficos
// que los niveles 1 y 2 no pudieron leer (iframes sin inyectar, canvas
// contaminados o zonas sin colores de datos) y cuantizada con el umbral
// cromático de cuantizacion.js. Se ejecuta en el service worker (usa
// OffscreenCanvas, no DOM); su resultado se marca como aproximado porque
// pierde la relación entre color y elemento. Sprint 1; recorte y umbral
// cromático desde la versión 1.0.0.
// ------------------------------------------------------------------

import { quantizeImages } from "./cuantizacion.js";

// Lado mayor al que se reduce cada recorte antes de muestrear: acota el coste.
const MAX_CAPTURE_SIDE = 1200;

// Muestras totales repartidas entre los recortes según su área; cada
// recorte recibe al menos un mínimo para no perder las líneas finas.
const MAX_CAPTURE_SAMPLES = 120000;
const MIN_REGION_SAMPLES = 4000;

/** Recorta una imagen {data, width, height} al rectángulo dado (en píxeles). */
export function cropImageData(image, rect) {
  const clamp = (value, max) => Math.min(max, Math.max(0, value));
  const x0 = clamp(Math.floor(rect.x), image.width);
  const y0 = clamp(Math.floor(rect.y), image.height);
  const x1 = clamp(Math.ceil(rect.x + rect.width), image.width);
  const y1 = clamp(Math.ceil(rect.y + rect.height), image.height);
  const width = x1 - x0;
  const height = y1 - y0;
  if (width <= 0 || height <= 0) return { data: new Uint8ClampedArray(0), width: 0, height: 0 };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const start = ((y0 + y) * image.width + x0) * 4;
    data.set(image.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { data, width, height };
}

/**
 * Convierte los recortes en CSS px del marco superior a píxeles de la
 * captura (la captura mide el área visible a la escala del dispositivo)
 * y los acota a la imagen. Sin recortes válidos devuelve la imagen entera.
 */
export function regionsToPixels(regions, viewport, imageWidth, imageHeight) {
  const scaleX = viewport && viewport.width ? imageWidth / viewport.width : 1;
  const scaleY = viewport && viewport.height ? imageHeight / viewport.height : scaleX;
  const pixelRects = (regions || [])
    .map((rect) => ({ x: rect.x * scaleX, y: rect.y * scaleY, width: rect.width * scaleX, height: rect.height * scaleY }))
    .map((rect) => {
      const x = Math.max(0, rect.x);
      const y = Math.max(0, rect.y);
      return { x, y, width: Math.min(imageWidth, rect.x + rect.width) - x, height: Math.min(imageHeight, rect.y + rect.height) - y };
    })
    .filter((rect) => rect.width >= 2 && rect.height >= 2);
  return pixelRects.length ? pixelRects : [{ x: 0, y: 0, width: imageWidth, height: imageHeight }];
}

/** Muestras que corresponden a cada recorte según su área. */
export function samplesPerRegion(pixelRects, total = MAX_CAPTURE_SAMPLES, minimum = MIN_REGION_SAMPLES) {
  const area = pixelRects.reduce((sum, rect) => sum + rect.width * rect.height, 0) || 1;
  return pixelRects.map((rect) => Math.max(minimum, Math.round((total * rect.width * rect.height) / area)));
}

/**
 * Captura la pestaña visible de la ventana indicada, recorta las zonas
 * dadas (CSS px del marco superior; sin zonas, toda la pestaña) y
 * devuelve entradas {rgb, weight, role, inChart} con la marca
 * approximate: true. El llamador retira antes el filtro de simulación y
 * la previsualización y los restaura después, para capturar colores
 * reales; capture permite inyectar una captura que respete la cuota de
 * llamadas de captureVisibleTab.
 */
export async function extractFromCapture(windowId, regions = [], viewport = null, capture = null) {
  // PNG para no introducir artefactos de compresión en los colores.
  const dataUrl = capture ? await capture(windowId) : await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
  // fetch sobre una URL data: no es una petición de red (RNF02): solo
  // decodifica localmente el PNG en base64 que devolvió la captura.
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);

  const pixelRects = regionsToPixels(regions, viewport, bitmap.width, bitmap.height);
  const budgets = samplesPerRegion(pixelRects);
  const images = pixelRects.map((rect) => {
    // Reducción previa solo si el recorte es grande: el corte mediano no
    // necesita la resolución completa, pero las líneas finas sí la agradecen.
    const scale = Math.min(1, MAX_CAPTURE_SIDE / Math.max(rect.width, rect.height));
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  });
  bitmap.close();

  const samples = budgets.reduce((sum, budget, index) => sum + Math.min(budget, images[index].width * images[index].height), 0);
  return { entries: quantizeImages(images, budgets), approximate: true, samples, regions: pixelRects.length };
}

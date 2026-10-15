// ------------------------------------------------------------------
// Nivel 2 de extracción (RF01): muestreo de píxeles de elementos canvas
// con getImageData y cuantización cromática (cuantizacion.js), que
// conserva las series finas y separa fondos y ejes acromáticos. Recibe
// los canvas de las zonas de gráficos, también los de shadow roots, y
// devuelve los rectángulos de los que no pudo leer para que la captura
// los recorte. Sprint 1; cuantización cromática desde la versión 1.0.0.
// ------------------------------------------------------------------

import { medianCut, quantizeImages, samplePixels } from "./cuantizacion.js";

// Área mínima (px²) para considerar un canvas como gráfico y no como icono.
const MIN_CANVAS_AREA = 4096;

// Máximo de píxeles muestreados por canvas: acota el coste a < 3 s.
const MAX_SAMPLES_PER_CANVAS = 60000;

// Número máximo de cajas del corte mediano.
const MAX_QUANTIZED_COLORS = 24;

// Proporción mínima de muestras para conservar un tono: por debajo se
// considera producto del antialiasing.
const MIN_TONE_SHARE = 0.01;

// El muestreo vive en cuantizacion.js; se reexporta por compatibilidad.
export { samplePixels };

/**
 * Corte mediano de Heckbert (medianCut de cuantizacion.js) hasta
 * maxColors cajas. La mediana puede partir por la mitad una zona de color
 * uniforme y dejar varias cajas con el mismo promedio: se fusionan antes
 * de devolver {rgb, count}.
 */
export function medianCutQuantize(pixels, maxColors = MAX_QUANTIZED_COLORS) {
  const averaged = medianCut(pixels, maxColors);
  const merged = [];
  for (const color of averaged) {
    const twin = merged.find(
      (existing) =>
        Math.abs(existing.rgb.r - color.rgb.r) <= 3 &&
        Math.abs(existing.rgb.g - color.rgb.g) <= 3 &&
        Math.abs(existing.rgb.b - color.rgb.b) <= 3
    );
    if (twin) {
      // Promedio ponderado para no sesgar el representante del grupo.
      const total = twin.count + color.count;
      twin.rgb = {
        r: Math.round((twin.rgb.r * twin.count + color.rgb.r * color.count) / total),
        g: Math.round((twin.rgb.g * twin.count + color.rgb.g * color.count) / total),
        b: Math.round((twin.rgb.b * twin.count + color.rgb.b * color.count) / total)
      };
      twin.count = total;
    } else {
      merged.push({ rgb: { ...color.rgb }, count: color.count });
    }
  }
  return merged;
}

/**
 * Descarta los tonos con proporción de muestras inferior a minShare,
 * atribuibles al suavizado de bordes. Si el filtro vaciara el resultado,
 * conserva los tres tonos más frecuentes.
 */
export function discardRareTones(colors, totalSamples, minShare = MIN_TONE_SHARE) {
  if (!colors.length || totalSamples <= 0) return [];
  const kept = colors.filter((color) => color.count / totalSamples >= minShare);
  if (kept.length) return kept;
  return colors.slice().sort((a, b) => b.count - a.count).slice(0, 3);
}

/**
 * Punto de entrada del nivel 2. Recibe la lista de canvas de las zonas de
 * gráficos (también los de shadow roots) o, por compatibilidad, un nodo
 * raíz del que tomar sus canvas. Lee sus píxeles y devuelve entradas
 * {rgb, weight, role, inChart} normalizadas para la consolidación, y los
 * rectángulos de los canvas que no se pudieron leer (WebGL o contaminado
 * por CORS) para que el orquestador los capture recortados.
 */
export function extractCanvasColors(target = document) {
  const candidates = Array.isArray(target) ? target : Array.from(target.querySelectorAll("canvas"));
  const canvases = candidates.filter((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return rect.width * rect.height >= MIN_CANVAS_AREA && canvas.width > 0 && canvas.height > 0;
  });

  const perCanvasResults = [];
  const failedRects = [];
  let failed = 0;
  const rectOf = (canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };

  for (const canvas of canvases) {
    try {
      const context = canvas.getContext("2d");
      if (!context) {
        // Contexto WebGL u otro: este nivel no puede leerlo.
        failed += 1;
        failedRects.push(rectOf(canvas));
        continue;
      }
      // Se lee desde una copia propia creada con willReadFrequently: leer
      // directamente del canvas de la página dispara la advertencia
      // "Canvas2D: multiple readback operations..." de Chrome, porque su
      // contexto lo creó la librería de gráficos sin esa bandera y no puede
      // cambiarse a posteriori. Copiar un canvas contaminado por CORS
      // contamina también la copia, así que el SecurityError se conserva.
      const readCopy = new OffscreenCanvas(canvas.width, canvas.height);
      const readContext = readCopy.getContext("2d", { willReadFrequently: true });
      readContext.drawImage(canvas, 0, 0);
      const imageData = readContext.getImageData(0, 0, canvas.width, canvas.height);
      perCanvasResults.push({ imageData });
    } catch (error) {
      // SecurityError: canvas contaminado por contenido de otro origen.
      failed += 1;
      failedRects.push(rectOf(canvas));
    }
  }

  const entries = [];
  // Canvas legibles en los que no hay nada pintado (todo transparente):
  // gráficos sin datos todavía.
  let empty = 0;
  for (const { imageData } of perCanvasResults) {
    // Cuantización cromática (la misma que la captura): conserva las series
    // finas aunque ocupen poco y separa los acromáticos de fondo y ejes.
    const quantized = quantizeImages([imageData], [MAX_SAMPLES_PER_CANVAS]);
    if (!quantized.length) empty += 1;
    for (const entry of quantized) {
      // El peso se reparte entre canvas para que el nivel sume como máximo 1.
      entries.push({ ...entry, weight: entry.weight / perCanvasResults.length });
    }
  }

  return { entries, canvasTotal: canvases.length, canvasFailed: failed, canvasEmpty: empty, failedRects };
}

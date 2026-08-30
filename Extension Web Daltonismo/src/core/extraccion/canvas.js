// ------------------------------------------------------------------
// Sprint 1 · Nivel 2 de extracción: muestreo de píxeles de elementos
// canvas con getImageData, cuantización por corte mediano (median cut,
// Heckbert 1982) y descarte de los tonos poco frecuentes que produce el
// suavizado de bordes (antialiasing).
// Las funciones de muestreo y cuantización son puras y las reutiliza
// captura.js (nivel 3) desde el service worker.
// ------------------------------------------------------------------

// Área mínima (px²) para considerar un canvas como gráfico y no como icono.
const MIN_CANVAS_AREA = 4096;

// Máximo de píxeles muestreados por canvas: acota el coste a < 3 s.
const MAX_SAMPLES_PER_CANVAS = 60000;

// Número máximo de cajas del corte mediano.
const MAX_QUANTIZED_COLORS = 24;

// Proporción mínima de muestras para conservar un tono: por debajo se
// considera producto del antialiasing.
const MIN_TONE_SHARE = 0.01;

/**
 * Muestrea los píxeles de un ImageData con paso constante y descarta los
 * casi transparentes. Los semitransparentes se componen sobre blanco como
 * criterio de extracción: el canvas es transparente por defecto y el color
 * percibido de un píxel semitransparente depende de la superficie que tenga
 * detrás, por lo que se compone sobre blanco en consistencia con el fondo
 * sintético que registra el nivel 1 cuando la página no declara uno propio.
 */
export function samplePixels(imageData, maxSamples = MAX_SAMPLES_PER_CANVAS) {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  let step = Math.max(1, Math.floor(totalPixels / maxSamples));
  // Evita que el paso quede alineado con el ancho de fila (bandas verticales).
  if (width > 1 && step > 1 && step % width === 0) step += 1;

  const pixels = [];
  for (let p = 0; p < totalPixels; p += step) {
    const i = p * 4;
    const alpha = data[i + 3];
    if (alpha < 32) continue;
    if (alpha < 255) {
      const factor = alpha / 255;
      pixels.push([
        Math.round(data[i] * factor + 255 * (1 - factor)),
        Math.round(data[i + 1] * factor + 255 * (1 - factor)),
        Math.round(data[i + 2] * factor + 255 * (1 - factor))
      ]);
    } else {
      pixels.push([data[i], data[i + 1], data[i + 2]]);
    }
  }
  return pixels;
}

/** Canal con mayor rango dentro de una caja y el valor de ese rango. */
function widestChannel(box) {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const pixel of box) {
    for (let c = 0; c < 3; c += 1) {
      if (pixel[c] < min[c]) min[c] = pixel[c];
      if (pixel[c] > max[c]) max[c] = pixel[c];
    }
  }
  const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const channel = ranges.indexOf(Math.max(...ranges));
  return { channel, range: ranges[channel] };
}

/**
 * Corte mediano de Heckbert: divide repetidamente la caja con mayor rango
 * cromático por la mediana de su canal más ancho, hasta maxColors cajas.
 * Devuelve el color medio de cada caja con su número de muestras.
 */
export function medianCutQuantize(pixels, maxColors = MAX_QUANTIZED_COLORS) {
  if (!pixels.length) return [];
  let boxes = [pixels.slice()];

  while (boxes.length < maxColors) {
    let bestIndex = -1;
    let bestChannel = 0;
    let bestRange = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      const { channel, range } = widestChannel(box);
      if (range > bestRange) {
        bestRange = range;
        bestIndex = index;
        bestChannel = channel;
      }
    });
    // Ninguna caja divisible: todos los tonos ya son uniformes.
    if (bestIndex === -1) break;

    const box = boxes[bestIndex];
    box.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const half = Math.floor(box.length / 2);
    boxes.splice(bestIndex, 1, box.slice(0, half), box.slice(half));
  }

  const averaged = boxes.map((box) => {
    const sum = [0, 0, 0];
    for (const pixel of box) {
      sum[0] += pixel[0];
      sum[1] += pixel[1];
      sum[2] += pixel[2];
    }
    return {
      rgb: {
        r: Math.round(sum[0] / box.length),
        g: Math.round(sum[1] / box.length),
        b: Math.round(sum[2] / box.length)
      },
      count: box.length
    };
  });

  // La mediana puede partir por la mitad una zona de color uniforme y dejar
  // varias cajas con el mismo promedio: se fusionan antes de devolver.
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
 * Punto de entrada del nivel 2: recorre los canvas visibles del contenedor,
 * lee sus píxeles y devuelve entradas {rgb, weight, role} normalizadas para
 * la consolidación. Cuenta los canvas que no se pudieron leer (WebGL o
 * canvas contaminado por CORS) para que el orquestador decida el respaldo.
 */
export function extractCanvasColors(root = document) {
  const canvases = Array.from(root.querySelectorAll("canvas")).filter((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return rect.width * rect.height >= MIN_CANVAS_AREA && canvas.width > 0 && canvas.height > 0;
  });

  const perCanvasResults = [];
  let failed = 0;

  for (const canvas of canvases) {
    try {
      const context = canvas.getContext("2d");
      if (!context) {
        // Contexto WebGL u otro: este nivel no puede leerlo.
        failed += 1;
        continue;
      }
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = samplePixels(imageData);
      if (!pixels.length) continue;
      const quantized = discardRareTones(medianCutQuantize(pixels), pixels.length);
      perCanvasResults.push({ quantized, samples: pixels.length });
    } catch (error) {
      // SecurityError: canvas contaminado por contenido de otro origen.
      failed += 1;
    }
  }

  const entries = [];
  for (const { quantized, samples } of perCanvasResults) {
    // El tono dominante de un gráfico suele ser su fondo; el resto, series.
    const dominant = quantized.reduce((a, b) => (b.count > a.count ? b : a), quantized[0]);
    for (const color of quantized) {
      const share = color.count / samples;
      const role = color === dominant && share > 0.3 ? "background" : "series";
      // El peso se reparte entre canvas para que el nivel sume como máximo 1.
      entries.push({ rgb: color.rgb, weight: share / perCanvasResults.length, role });
    }
  }

  return { entries, canvasTotal: canvases.length, canvasFailed: failed };
}

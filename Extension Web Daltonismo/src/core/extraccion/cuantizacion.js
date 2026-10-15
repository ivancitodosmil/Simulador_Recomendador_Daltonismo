// ------------------------------------------------------------------
// Cuantización cromática de imágenes (RF01) para el nivel 2 (canvas) y
// el nivel 3 (captura recortada). Separa los píxeles cromáticos de los
// acromáticos, agrupa los cromáticos alrededor de los colores exactos que
// se repiten (trazos y rellenos) y el residuo por corte mediano, fusiona
// los tonos a menos de ΔE00 3, pliega el suavizado de bordes en su color
// puro mirando qué píxeles toca cada grupo en la imagen y aplica un
// umbral relativo a los píxeles cromáticos, no a toda la pantalla.
// Funciones puras sin DOM (trabajan con {data, width, height}): las
// ejercitan las pruebas unitarias. Versión 1.0.0.
// ------------------------------------------------------------------

import { rgbToLab } from "../color/conversion.js";
import { ciede2000 } from "../color/diferencia.js";

// Muestras por imagen cuando el llamador no indica otra cosa.
const DEFAULT_SAMPLES = 60000;

// Croma C*ab mínimo para considerar cromático un píxel: por debajo quedan
// los grises puros y los grises con un ligero matiz (texto y ejes de
// interfaz, C*ab 5 a 9); la serie real menos saturada del banco ronda 20.
const CHROMA_MIN = 10;

// Semillas: colores exactos que se repiten (trazos y rellenos de un
// gráfico vectorial pintado en canvas o capturado). Cada píxel cromático
// se asigna a la semilla más cercana en CIELAB; los que quedan lejos de
// todas (degradados, fotografías) van al corte mediano.
const SEED_MIN_SHARE = 0.001;
const SEED_MAX = 64;
const SEED_MAX_DISTANCE = 15;

// Cajas del corte mediano para el residuo cromático y para los acromáticos.
const CHROMATIC_BOXES = 48;
const ACHROMATIC_BOXES = 8;

// Un color exacto representa a su caja si se repite al menos este número
// de veces y esta fracción de la caja; si no, la caja se promedia.
const MODE_MIN_PIXELS = 4;
const MODE_MIN_SHARE = 0.03;

// Dos tonos con ΔE00 menor que esto son el mismo color.
const MERGE_DELTA = 3;

// Suavizado de bordes: un grupo cuyos píxeles tocan, en más de esta
// fracción, píxeles de otro grupo más saturado (al menos este croma de
// diferencia) es la transición de ese color hacia el fondo y se pliega
// en él. Un tinte con área propia toca a su vecino solo en el borde.
const MIXTURE_TOUCH_SHARE = 0.5;
const MIXTURE_CHROMA_STEP = 2;

// Umbral de conservación cromático: relativo al total de píxeles
// cromáticos, con un mínimo absoluto de muestras.
const CHROMATIC_MIN_SHARE = 0.004;
const CHROMATIC_MIN_PIXELS = 12;

// Los acromáticos (fondos, ejes, texto) sí se miden contra el total.
const ACHROMATIC_MIN_SHARE = 0.02;

// Tope razonable de colores por lectura.
const MAX_CHROMATIC_COLORS = 24;
const MAX_ACHROMATIC_COLORS = 4;

const chromaOf = (lab) => Math.hypot(lab.a, lab.b);
const keyOf = (r, g, b) => r * 65536 + g * 256 + b;

/**
 * Color [r,g,b] del píxel que empieza en data[i], o null si es casi
 * transparente. Los semitransparentes se componen sobre blanco como
 * criterio de extracción: el canvas es transparente por defecto y el
 * color percibido de un píxel semitransparente depende de la superficie
 * que tenga detrás, por lo que se compone sobre blanco en consistencia
 * con el fondo sintético que registra el nivel 1 cuando la página no
 * declara uno propio. El muestreo y el mapa de etiquetas usan la misma
 * composición, para que cada muestra encuentre sus píxeles en la imagen.
 */
function compositedPixel(data, i) {
  const alpha = data[i + 3];
  if (alpha < 32) return null;
  if (alpha === 255) return [data[i], data[i + 1], data[i + 2]];
  const factor = alpha / 255;
  return [
    Math.round(data[i] * factor + 255 * (1 - factor)),
    Math.round(data[i + 1] * factor + 255 * (1 - factor)),
    Math.round(data[i + 2] * factor + 255 * (1 - factor))
  ];
}

/**
 * Muestrea los píxeles de una imagen {data, width, height} con paso
 * constante y descarta los casi transparentes (ver compositedPixel).
 */
export function samplePixels(imageData, maxSamples = DEFAULT_SAMPLES) {
  const { data, width, height } = imageData;
  const totalPixels = width * height;
  let step = Math.max(1, Math.floor(totalPixels / maxSamples));
  // Evita que el paso quede alineado con el ancho de fila (bandas verticales).
  if (width > 1 && step > 1 && step % width === 0) step += 1;

  const pixels = [];
  for (let p = 0; p < totalPixels; p += step) {
    const pixel = compositedPixel(data, p * 4);
    if (pixel) pixels.push(pixel);
  }
  return pixels;
}

/** Corte mediano de Heckbert sobre [[r,g,b], ...]; devuelve {rgb, count}. */
export function medianCut(pixels, maxColors) {
  if (!pixels.length) return [];
  let boxes = [pixels.slice()];
  const widest = (box) => {
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
  };
  while (boxes.length < maxColors) {
    let bestIndex = -1;
    let bestChannel = 0;
    let bestRange = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      const { channel, range } = widest(box);
      if (range > bestRange) {
        bestRange = range;
        bestIndex = index;
        bestChannel = channel;
      }
    });
    if (bestIndex === -1) break;
    const box = boxes[bestIndex];
    box.sort((a, b) => a[bestChannel] - b[bestChannel]);
    const half = Math.floor(box.length / 2);
    boxes.splice(bestIndex, 1, box.slice(0, half), box.slice(half));
  }
  // Representante de cada caja: el color exacto más frecuente (el trazo
  // puro de una línea o el relleno de una barra) en lugar del promedio,
  // que arrastraría el color hacia los tonos de suavizado que lo rodean.
  // Si ningún color se repite lo bastante (degradados), el promedio.
  return boxes.map((box) => {
    const sum = [0, 0, 0];
    const counts = new Map();
    let mode = null;
    let modeCount = 0;
    for (const pixel of box) {
      sum[0] += pixel[0];
      sum[1] += pixel[1];
      sum[2] += pixel[2];
      const key = keyOf(pixel[0], pixel[1], pixel[2]);
      const count = (counts.get(key) || 0) + 1;
      counts.set(key, count);
      if (count > modeCount) {
        modeCount = count;
        mode = pixel;
      }
    }
    const useMode = modeCount >= MODE_MIN_PIXELS && modeCount >= box.length * MODE_MIN_SHARE;
    return {
      rgb: useMode
        ? { r: mode[0], g: mode[1], b: mode[2] }
        : { r: Math.round(sum[0] / box.length), g: Math.round(sum[1] / box.length), b: Math.round(sum[2] / box.length) },
      count: box.length
    };
  });
}

/**
 * Separa los píxeles [[r,g,b]] en cromáticos (C*ab ≥ 10) y acromáticos.
 * chromaticLabs guarda, en paralelo, el CIELAB de cada píxel cromático.
 */
export function classifyPixels(pixels) {
  const chromatic = [];
  const chromaticLabs = [];
  const achromatic = [];
  for (const pixel of pixels) {
    const lab = rgbToLab({ r: pixel[0], g: pixel[1], b: pixel[2] });
    if (chromaOf(lab) >= CHROMA_MIN) {
      chromatic.push(pixel);
      chromaticLabs.push(lab);
    } else {
      achromatic.push(pixel);
    }
  }
  return { chromatic, chromaticLabs, achromatic };
}

/** Fusiona los grupos con ΔE00 menor que maxDelta (promedio ponderado). */
export function mergeCloseColors(clusters, maxDelta = MERGE_DELTA) {
  const sorted = clusters
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((cluster) => ({ rgb: { ...cluster.rgb }, count: cluster.count, lab: rgbToLab(cluster.rgb), chromatic: cluster.chromatic }));
  const merged = [];
  for (const cluster of sorted) {
    const twin = merged.find((existing) => existing.chromatic === cluster.chromatic && ciede2000(existing.lab, cluster.lab) < maxDelta);
    if (!twin) {
      merged.push(cluster);
      continue;
    }
    const total = twin.count + cluster.count;
    twin.rgb = {
      r: Math.round((twin.rgb.r * twin.count + cluster.rgb.r * cluster.count) / total),
      g: Math.round((twin.rgb.g * twin.count + cluster.rgb.g * cluster.count) / total),
      b: Math.round((twin.rgb.b * twin.count + cluster.rgb.b * cluster.count) / total)
    };
    twin.count = total;
    twin.lab = rgbToLab(twin.rgb);
  }
  return merged;
}

/**
 * Semillas de un conjunto de píxeles cromáticos: los colores exactos que
 * se repiten al menos un mínimo de veces, fusionados a menos de ΔE00 3 y
 * ordenados por frecuencia. Devuelve [{rgb, lab, count, chromatic}].
 */
export function seedColors(pixels) {
  const counts = new Map();
  for (const pixel of pixels) {
    const key = keyOf(pixel[0], pixel[1], pixel[2]);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { rgb: { r: pixel[0], g: pixel[1], b: pixel[2] }, count: 1, chromatic: true });
  }
  const minCount = Math.max(MODE_MIN_PIXELS, pixels.length * SEED_MIN_SHARE);
  const frequent = [...counts.values()].filter((entry) => entry.count >= minCount).sort((a, b) => b.count - a.count).slice(0, SEED_MAX * 2);
  return mergeCloseColors(frequent).slice(0, SEED_MAX);
}

/** Índice del grupo más cercano a un CIELAB (distancia euclídea) y esa distancia. */
function nearestCluster(lab, clusters) {
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < clusters.length; i += 1) {
    const c = clusters[i].lab;
    const distance = (lab.l - c.l) * (lab.l - c.l) + (lab.a - c.a) * (lab.a - c.a) + (lab.b - c.b) * (lab.b - c.b);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return { index: best, distance: Math.sqrt(bestDistance) };
}

/**
 * Asigna cada píxel cromático a la semilla más cercana en CIELAB si está
 * a menos de 15 unidades; el resto queda como residuo para el corte mediano.
 */
export function assignToSeeds(pixels, labs, seeds) {
  const clusters = seeds.map((seed) => ({ rgb: seed.rgb, lab: seed.lab, count: 0, chromatic: true }));
  const residual = [];
  for (let i = 0; i < pixels.length; i += 1) {
    const { index, distance } = nearestCluster(labs[i], clusters);
    if (index >= 0 && distance <= SEED_MAX_DISTANCE) clusters[index].count += 1;
    else residual.push(pixels[i]);
  }
  return { clusters: clusters.filter((cluster) => cluster.count > 0), residual };
}

/**
 * Agrupa muestras [[r,g,b]] sin mirar la imagen: semillas, corte mediano
 * del residuo, acromáticos y fusión a menos de ΔE00 3. Devuelve los
 * grupos {rgb, lab, count, chromatic} aún sin plegar ni filtrar.
 */
export function clusterSamples(pixels) {
  const { chromatic, chromaticLabs, achromatic } = classifyPixels(pixels);
  const seeds = seedColors(chromatic);
  const { clusters: seeded, residual } = assignToSeeds(chromatic, chromaticLabs, seeds);
  const chromaticClusters = mergeCloseColors([
    ...seeded,
    ...medianCut(residual, CHROMATIC_BOXES).map((c) => ({ ...c, chromatic: true }))
  ]);
  const achromaticClusters = mergeCloseColors(medianCut(achromatic, ACHROMATIC_BOXES).map((c) => ({ ...c, chromatic: false })));
  return { clusters: [...chromaticClusters, ...achromaticClusters], chromaticCount: chromatic.length, total: pixels.length };
}

// Etiquetas de los píxeles acromáticos en el mapa de la imagen.
const LABEL_BACKGROUND = -1;
const LABEL_INK = -2;

// Un acromático cuya claridad L difiere del fondo en al menos esto es
// tinta (texto, ejes); los acromáticos claros sobre fondo claro (cuadrícula,
// suavizado de un color pálido) cuentan como fondo.
const INK_LIGHTNESS_STEP = 25;
const INK_RADIUS = 2;

/**
 * Etiqueta cada píxel de la imagen con el índice de su grupo cromático,
 * o con LABEL_BACKGROUND (acromático cercano a la claridad del fondo) o
 * LABEL_INK (acromático muy distinto del fondo: texto, ejes). Los colores
 * exactos se resuelven una sola vez.
 */
function labelImage(image, clusters, backgroundLightness, cache) {
  const labels = new Int16Array(image.width * image.height);
  const { data } = image;
  for (let i = 0, p = 0; i < labels.length; i += 1, p += 4) {
    const pixel = compositedPixel(data, p);
    if (!pixel) {
      labels[i] = LABEL_BACKGROUND;
      continue;
    }
    const key = keyOf(pixel[0], pixel[1], pixel[2]);
    let label = cache.get(key);
    if (label === undefined) {
      const lab = rgbToLab({ r: pixel[0], g: pixel[1], b: pixel[2] });
      if (chromaOf(lab) >= CHROMA_MIN) label = nearestCluster(lab, clusters).index;
      else label = Math.abs(lab.l - backgroundLightness) >= INK_LIGHTNESS_STEP ? LABEL_INK : LABEL_BACKGROUND;
      cache.set(key, label);
    }
    labels[i] = label;
  }
  return labels;
}

/**
 * Pliega el suavizado mirando la imagen. Para cada grupo cromático cuenta
 * qué fracción de sus píxeles toca (vecindad de 4) un píxel de otro grupo
 * con más croma, y qué fracción toca tinta acromática (texto, ejes).
 * Las transiciones de un color hacia el fondo tocan casi siempre su color
 * puro y se pliegan en él; un tinte con área propia (barras claras junto
 * a barras oscuras) solo lo toca en el borde y se conserva. Las franjas
 * de color del suavizado subpíxel del texto tocan sobre todo la tinta (o
 * a otras franjas) y se descartan. achromaticClusters va ordenado con el
 * dominante primero: su claridad define qué es fondo y qué es tinta.
 * Devuelve los grupos cromáticos restantes con los píxeles sumados.
 */
export function foldByAdjacency(images, chromaticClusters, achromaticClusters = []) {
  const clusters = chromaticClusters.map((cluster) => ({ ...cluster }));
  if (!clusters.length) return clusters;
  const cache = new Map();
  const backgroundLightness = achromaticClusters.length ? achromaticClusters[0].lab.l : 100;
  const chroma = clusters.map((cluster) => chromaOf(cluster.lab));
  const total = new Float64Array(clusters.length);
  const inkTouches = new Float64Array(clusters.length);
  const touches = clusters.map(() => new Map());
  const anyTouches = clusters.map(() => new Map());
  for (const image of images) {
    const labels = labelImage(image, clusters, backgroundLightness, cache);
    const { width, height } = image;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const label = labels[y * width + x];
        if (label < 0) continue;
        total[label] += 1;
        let higher = -1;
        let higherChroma = chroma[label] + MIXTURE_CHROMA_STEP;
        let ink = false;
        const neighbours = [
          x > 0 ? labels[y * width + x - 1] : LABEL_BACKGROUND,
          x < width - 1 ? labels[y * width + x + 1] : LABEL_BACKGROUND,
          y > 0 ? labels[(y - 1) * width + x] : LABEL_BACKGROUND,
          y < height - 1 ? labels[(y + 1) * width + x] : LABEL_BACKGROUND
        ];
        const seen = new Set();
        for (const other of neighbours) {
          if (other < 0 || other === label || seen.has(other)) continue;
          seen.add(other);
          anyTouches[label].set(other, (anyTouches[label].get(other) || 0) + 1);
          if (chroma[other] >= higherChroma) {
            higher = other;
            higherChroma = chroma[other];
          }
        }
        // La tinta se busca en una ventana de 5×5: las franjas del suavizado
        // subpíxel pueden quedar a dos píxeles del trazo del texto.
        for (let dy = -INK_RADIUS; dy <= INK_RADIUS && !ink; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -INK_RADIUS; dx <= INK_RADIUS; dx += 1) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            if (labels[yy * width + xx] === LABEL_INK) {
              ink = true;
              break;
            }
          }
        }
        if (ink) inkTouches[label] += 1;
        if (higher >= 0) touches[label].set(higher, (touches[label].get(higher) || 0) + 1);
      }
    }
  }
  // Franjas del suavizado subpíxel del texto: pegadas a la tinta o a otra
  // franja (el suavizado puede tener dos columnas de color).
  const fringes = new Set();
  for (let round = 0; round < 3; round += 1) {
    let changed = false;
    clusters.forEach((cluster, index) => {
      if (!total[index] || fringes.has(index)) return;
      let touching = inkTouches[index];
      for (const [other, count] of anyTouches[index]) if (fringes.has(other)) touching += count;
      if (touching / total[index] >= MIXTURE_TOUCH_SHARE) {
        fringes.add(index);
        changed = true;
      }
    });
    if (!changed) break;
  }
  // Los grupos menos saturados se resuelven primero, así una transición
  // plegada en otra transición acaba en el color puro.
  const order = clusters.map((cluster, index) => index).sort((a, b) => chroma[a] - chroma[b]);
  const foldedInto = new Map();
  for (const index of order) {
    if (!total[index] || fringes.has(index)) continue;
    let touching = 0;
    let target = -1;
    let targetCount = 0;
    for (const [other, count] of touches[index]) {
      if (fringes.has(other)) continue;
      touching += count;
      if (count > targetCount) {
        targetCount = count;
        target = other;
      }
    }
    if (target >= 0 && touching / total[index] >= MIXTURE_TOUCH_SHARE) foldedInto.set(index, target);
  }
  const resolveTarget = (index) => {
    let current = index;
    const seen = new Set();
    while (foldedInto.has(current) && !seen.has(current)) {
      seen.add(current);
      current = foldedInto.get(current);
    }
    return current;
  };
  for (const [index] of foldedInto) {
    const target = resolveTarget(index);
    if (target !== index) clusters[target].count += clusters[index].count;
  }
  return clusters.filter((cluster, index) => !foldedInto.has(index) && !fringes.has(index));
}

/**
 * Cuantiza una o varias imágenes {data, width, height} (el canvas de un
 * gráfico o los recortes de una captura) y devuelve entradas {rgb,
 * weight, role, chromatic, inChart} listas para la consolidación: las
 * cromáticas como serie (umbral relativo a los píxeles cromáticos, mínimo
 * de muestras) y las acromáticas como fondo (la mayor) o borde (ejes,
 * cuadrículas). budgets: muestras a tomar de cada imagen.
 */
export function quantizeImages(images, budgets) {
  const pixels = [];
  images.forEach((image, index) => {
    for (const pixel of samplePixels(image, budgets[index])) pixels.push(pixel);
  });
  const total = pixels.length;
  if (!total) return [];
  const { clusters, chromaticCount } = clusterSamples(pixels);
  const achromaticClusters = clusters.filter((cluster) => !cluster.chromatic).sort((a, b) => b.count - a.count);
  const chromaticClusters = foldByAdjacency(images, clusters.filter((cluster) => cluster.chromatic), achromaticClusters);

  const entries = [];
  const chromaticMin = Math.max(CHROMATIC_MIN_PIXELS, chromaticCount * CHROMATIC_MIN_SHARE);
  chromaticClusters
    .filter((cluster) => cluster.count >= chromaticMin)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CHROMATIC_COLORS)
    .forEach((cluster) => {
      entries.push({ rgb: cluster.rgb, weight: cluster.count / total, role: "series", chromatic: true, inChart: true });
    });
  achromaticClusters
    .filter((cluster) => cluster.count >= total * ACHROMATIC_MIN_SHARE)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_ACHROMATIC_COLORS)
    .forEach((cluster, index) => {
      entries.push({
        rgb: cluster.rgb,
        weight: cluster.count / total,
        role: index === 0 ? "background" : "border",
        chromatic: false,
        inChart: true
      });
    });
  return entries;
}

// ------------------------------------------------------------------
// Pruebas unitarias de la extracción (versión 1.0.0). Herramienta de
// desarrollo: no forma parte del paquete. Ejecutar con:
//   node herramientas/pruebas-extraccion.mjs
//
// Cubre, con imágenes sintéticas y sin navegador: el recorte de la
// captura, el reparto de muestras, la separación cromática, el umbral
// relativo a los píxeles cromáticos (una línea fina sobrevive aunque
// ocupe menos del 1 % de la pantalla), la fusión de tonos a menos de
// ΔE00 3, el plegado del suavizado de bordes, la composición de marcos
// con los recortes a capturar y la fusión de paletas y contrastes.
// Sale con código 1 si algo falla.
// ------------------------------------------------------------------

import { cropImageData, regionsToPixels, samplesPerRegion } from "../src/core/extraccion/captura.js";
import {
  classifyPixels,
  mergeCloseColors,
  quantizeImages,
  seedColors
} from "../src/core/extraccion/cuantizacion.js";
import { composeFrames, captureRegions } from "../src/core/extraccion/marcos.js";
import { mergeFramePalettes } from "../src/core/extraccion/consolidacion.js";
import { mergeContrastResults, addApproximateSeriesContrast } from "../src/core/evaluacion/contraste-wcag.js";
import { ciede2000 } from "../src/core/color/diferencia.js";
import { hexToRgb, rgbToLab } from "../src/core/color/conversion.js";

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log("OK   " + name);
  } else {
    failed += 1;
    console.log("FALLO " + name + (detail ? " -> " + detail : ""));
  }
}

// ---- Imagen sintética {data, width, height} ------------------------
function makeImage(width, height, fill = [255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}
function paintRect(image, x, y, width, height, rgb) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      if (xx < 0 || yy < 0 || xx >= image.width || yy >= image.height) continue;
      const i = (yy * image.width + xx) * 4;
      image.data[i] = rgb[0];
      image.data[i + 1] = rgb[1];
      image.data[i + 2] = rgb[2];
    }
  }
}
const rgbOf = (hex) => {
  const c = hexToRgb(hex);
  return [c.r, c.g, c.b];
};
const blend = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
const quantizeAll = (image) => quantizeImages([image], [image.width * image.height]);
const delta = (hex, rgb) => ciede2000(rgbToLab(hexToRgb(hex)), rgbToLab(rgb));
const nearest = (entries, hex) => {
  const lab = rgbToLab(hexToRgb(hex));
  let best = null;
  for (const entry of entries) {
    const delta = ciede2000(rgbToLab(entry.rgb), lab);
    if (!best || delta < best.delta) best = { entry, delta };
  }
  return best;
};

// ---- 1. Recorte --------------------------------------------------------
{
  const image = makeImage(20, 10);
  paintRect(image, 5, 0, 5, 10, [200, 30, 30]);
  const crop = cropImageData(image, { x: 5, y: 0, width: 5, height: 10 });
  const allRed = crop.width === 5 && crop.height === 10 &&
    Array.from({ length: 50 }, (_, i) => crop.data[i * 4] === 200 && crop.data[i * 4 + 1] === 30).every(Boolean);
  check("recorte exacto de 5×10 toma solo el bloque rojo", allRed, crop.width + "x" + crop.height);
  const outside = cropImageData(image, { x: 30, y: 0, width: 5, height: 5 });
  check("recorte fuera de la imagen devuelve 0×0", outside.width === 0 && outside.height === 0);
  const partial = cropImageData(image, { x: 17, y: 7, width: 10, height: 10 });
  check("recorte parcial se acota a la imagen (3×3)", partial.width === 3 && partial.height === 3, partial.width + "x" + partial.height);
}

// ---- 2. Regiones CSS → píxeles de la captura ---------------------------
{
  const rects = regionsToPixels([{ x: 10, y: 20, width: 100, height: 50 }], { width: 1000, height: 500 }, 2000, 1000);
  check("región CSS escalada por 2 (captura a dpr 2)", rects.length === 1 && rects[0].x === 20 && rects[0].y === 40 && rects[0].width === 200 && rects[0].height === 100, JSON.stringify(rects));
  const whole = regionsToPixels([], { width: 1000, height: 500 }, 2000, 1000);
  check("sin regiones se usa la imagen entera", whole.length === 1 && whole[0].width === 2000 && whole[0].height === 1000);
  const clipped = regionsToPixels([{ x: 900, y: 450, width: 300, height: 300 }], { width: 1000, height: 500 }, 1000, 500);
  check("región que sobresale se acota al borde", clipped[0].x === 900 && clipped[0].width === 100 && clipped[0].height === 50, JSON.stringify(clipped));
  const budgets = samplesPerRegion([{ x: 0, y: 0, width: 100, height: 100 }, { x: 0, y: 0, width: 300, height: 100 }], 40000, 1000);
  check("muestras proporcionales al área (10 000 y 30 000)", budgets[0] === 10000 && budgets[1] === 30000, budgets.join(","));
  const minimum = samplesPerRegion([{ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 1000, height: 1000 }], 40000, 4000);
  check("un recorte minúsculo recibe el mínimo de muestras", minimum[0] === 4000, minimum.join(","));
}

// ---- 3. Clasificación cromática ----------------------------------------
{
  const { chromatic, achromatic } = classifyPixels([[255, 255, 255], [128, 128, 128], [242, 142, 43], [36, 36, 36], [79, 159, 216]]);
  check("blancos y grises son acromáticos; naranja y azul, cromáticos", chromatic.length === 2 && achromatic.length === 3);
}

// ---- 4. Umbral relativo: la línea fina sobrevive -----------------------
{
  const image = makeImage(400, 300);
  const dark = rgbOf("#1F4E79");
  const light = rgbOf("#4F9FD8");
  const orange = rgbOf("#F28E2B");
  paintRect(image, 40, 60, 60, 200, dark);   // 12 000 px = 10 %
  paintRect(image, 120, 100, 60, 160, light); // 9 600 px = 8 %
  // Línea naranja de 1 px de alto y 300 de largo (300 px = 0,25 % del total)
  // con suavizado variable por encima y por debajo (otros 600 px, con la
  // cobertura cambiante de una línea que no es exactamente horizontal):
  // incluso sumando el suavizado ocupa el 0,75 % de la pantalla, bajo el
  // antiguo umbral del 0,8 %.
  paintRect(image, 20, 40, 300, 1, orange);
  for (let x = 20; x < 320; x += 1) {
    const t = 0.3 + 0.4 * ((x % 7) / 6);
    paintRect(image, x, 39, 1, 1, blend(orange, [255, 255, 255], t));
    paintRect(image, x, 41, 1, 1, blend(orange, [255, 255, 255], 1 - t));
  }
  const entries = quantizeAll(image);
  const orangeHit = nearest(entries.filter((e) => e.chromatic), "#F28E2B");
  check("la línea naranja (0,25 % de la pantalla) se conserva", orangeHit && orangeHit.delta < 3, orangeHit ? "ΔE " + orangeHit.delta.toFixed(2) : "sin cromáticos");
  check("…y su proporción queda por debajo del antiguo umbral del 0,8 %", orangeHit && orangeHit.entry.weight < 0.008, orangeHit ? String(orangeHit.entry.weight.toFixed(4)) : "");
  const darkHit = nearest(entries.filter((e) => e.chromatic), "#1F4E79");
  const lightHit = nearest(entries.filter((e) => e.chromatic), "#4F9FD8");
  check("las barras azul oscuro y azul claro se conservan como dos colores", darkHit.delta < 3 && lightHit.delta < 3 && darkHit.entry !== lightHit.entry,
    "ΔE " + darkHit.delta.toFixed(2) + " / " + lightHit.delta.toFixed(2));
  const blendHex = "#" + blend(orange, [255, 255, 255], 0.5).map((v) => v.toString(16).padStart(2, "0")).join("");
  const blendHit = nearest(entries, blendHex);
  check("el tono de suavizado (naranja al 50 %) no aparece como color propio", !(blendHit.delta < 3), "ΔE " + blendHit.delta.toFixed(2));
  const background = entries.find((e) => e.role === "background");
  check("el blanco dominante sale como fondo", background && ciede2000(rgbToLab(background.rgb), rgbToLab({ r: 255, g: 255, b: 255 })) < 2);
  check("no hay más de 24 cromáticos ni más de 4 acromáticos", entries.filter((e) => e.chromatic).length <= 24 && entries.filter((e) => !e.chromatic).length <= 4);
}

// ---- 5. Fusión a menos de ΔE00 3 ---------------------------------------
{
  const merged = mergeCloseColors([
    { rgb: hexToRgb("#4E79A7"), count: 100, chromatic: true },
    { rgb: hexToRgb("#4F7AA8"), count: 50, chromatic: true },
    { rgb: hexToRgb("#F28E2B"), count: 30, chromatic: true }
  ]);
  check("dos azules casi iguales se fusionan en uno", merged.length === 2 && merged[0].count === 150, merged.map((m) => m.count).join(","));
}

// ---- 6. Plegado del suavizado por adyacencia ---------------------------
{
  // Línea horizontal gruesa con una fila de suavizado uniforme a cada
  // lado (el mismo tono exacto repetido 300 veces): sin mirar la imagen
  // sería un color propio; como todos sus píxeles tocan el naranja puro,
  // se pliega en él.
  const image = makeImage(400, 200);
  const orange = rgbOf("#F28E2B");
  const halfOrange = blend(orange, [255, 255, 255], 0.5);
  paintRect(image, 20, 90, 300, 3, orange);
  paintRect(image, 20, 89, 300, 1, halfOrange);
  paintRect(image, 20, 93, 300, 1, halfOrange);
  const entries = quantizeAll(image);
  const chromatic = entries.filter((e) => e.chromatic);
  check("el suavizado uniforme de una línea se pliega en su color puro (un solo cromático)", chromatic.length === 1 && delta("#F28E2B", chromatic[0].rgb) < 1, JSON.stringify(chromatic.map((e) => e.rgb)));
  check("…y suma sus píxeles (900 + 600 de 80 000)", chromatic.length === 1 && Math.abs(chromatic[0].weight - 1500 / 80000) < 1e-6, chromatic.length ? String(chromatic[0].weight) : "");

  // Un rosa pálido con área propia junto a un rojo: solo se tocan en el
  // borde, así que los dos se conservan aunque el rosa sea un tinte del rojo.
  const tint = makeImage(400, 200);
  paintRect(tint, 40, 40, 100, 120, rgbOf("#D62728"));
  paintRect(tint, 140, 40, 100, 120, rgbOf("#FF9DA7"));
  const tintEntries = quantizeAll(tint).filter((e) => e.chromatic);
  check("un rosa con área propia junto a un rojo es un color real: se conservan los dos", tintEntries.length === 2, JSON.stringify(tintEntries.map((e) => e.rgb)));

  // Franja de color del suavizado subpíxel de un texto gris: pegada a la
  // tinta, no es una serie.
  const text = makeImage(300, 100);
  paintRect(text, 40, 40, 120, 14, [66, 66, 66]);          // «texto» gris oscuro
  paintRect(text, 40, 39, 120, 1, [255, 201, 155]);        // franja naranja pálida arriba
  paintRect(text, 40, 54, 120, 1, [148, 201, 255]);        // franja azul pálida abajo
  paintRect(text, 200, 20, 40, 60, rgbOf("#F28E2B"));      // barra naranja real
  const textEntries = quantizeAll(text).filter((e) => e.chromatic);
  check("las franjas subpíxel del texto se descartan y la barra naranja se conserva", textEntries.length === 1 && delta("#F28E2B", textEntries[0].rgb) < 1, JSON.stringify(textEntries.map((e) => e.rgb)));

  const seeds = seedColors([[242, 142, 43], [242, 142, 43], [242, 142, 43], [242, 142, 43], [1, 2, 3], [250, 150, 50]]);
  check("las semillas son los colores exactos repetidos (naranja, 4 veces)", seeds.length === 1 && seeds[0].count === 4 && seeds[0].rgb.r === 242, JSON.stringify(seeds));
}

// ---- 7. Composición de marcos y recortes -------------------------------
{
  const results = [
    { frameId: 0, response: { ok: true, url: "http://x/index.html", frame: { width: 1000, height: 600 }, zones: [
      { kind: "svg", rect: { x: 10, y: 10, width: 300, height: 200 } },
      { kind: "iframe", rect: { x: 400, y: 10, width: 500, height: 400 }, childFrameId: 5, src: "http://x/a.html" },
      { kind: "iframe", rect: { x: 10, y: 300, width: 300, height: 200 }, childFrameId: -1, src: "http://x/b.html" },
      { kind: "iframe", rect: { x: 10, y: 520, width: 300, height: 200 }, childFrameId: -1, src: "http://x/c.html" }
    ], failedCanvasRects: [] } },
    { frameId: 5, response: { ok: true, url: "http://x/a.html", frame: { width: 500, height: 400 }, zones: [
      { kind: "canvas", rect: { x: 20, y: 20, width: 100, height: 100 } }
    ], failedCanvasRects: [{ x: 50, y: 50, width: 40, height: 40 }] } },
    { frameId: 7, response: { ok: true, url: "http://x/b.html", frame: { width: 300, height: 200 }, zones: [
      { kind: "svg", rect: { x: 0, y: 0, width: 300, height: 200 } }
    ], failedCanvasRects: [] } }
  ];
  const composition = composeFrames(results);
  const offset5 = composition.offsets.get(5);
  check("el marco 5 se sitúa en el origen de su iframe (400, 10)", offset5 && offset5.x === 400 && offset5.y === 10, JSON.stringify(offset5));
  const canvasZone = composition.chartZones.find((z) => z.kind === "canvas");
  check("el canvas del marco 5 queda en coordenadas del marco superior (420, 30)", canvasZone && canvasZone.rect.x === 420 && canvasZone.rect.y === 30, JSON.stringify(canvasZone));
  const byUrl = composition.iframeZones.find((z) => z.rect.y === 300);
  check("un iframe sin frameId se empareja con su marco por URL (b.html)", byUrl && byUrl.injected && byUrl.childFrameId === 7, JSON.stringify(byUrl));
  const notInjected = composition.iframeZones.find((z) => z.rect.y === 520);
  check("el iframe c.html queda como no inyectado", notInjected && notInjected.injected === false);
  const withData = captureRegions(composition, { hasChromaticData: true });
  check("con colores de datos solo se capturan el canvas ilegible y el iframe sin inyectar (recortados y acotados al área visible)",
    withData.length === 2 && withData.some((r) => r.x === 450 && r.y === 60) && withData.some((r) => r.y === 520 && r.height === 80),
    JSON.stringify(withData));
  const withoutData = captureRegions(composition, { hasChromaticData: false });
  check("sin colores de datos se capturan además todas las zonas de gráficos", withoutData.length === 5, String(withoutData.length));
  const empty = captureRegions({ chartZones: [], iframeZones: [], failedCanvasRects: [], viewport: { width: 800, height: 600 } }, { hasChromaticData: false, paletteEmpty: true });
  check("sin zonas ni colores se captura toda el área visible", empty.length === 1 && empty[0].width === 800 && empty[0].height === 600);
}

// ---- 8. Fusión de paletas y de contrastes entre marcos -----------------
{
  const palette = mergeFramePalettes([
    { palette: [{ rgb: hexToRgb("#FFFFFF"), weight: 1, roles: ["background"], levels: ["dom-svg"], examples: ["body"], inCharts: false }], domObservations: 10 },
    { palette: [{ rgb: hexToRgb("#F28E2B"), weight: 0.5, roles: ["series"], levels: ["dom-svg"], examples: ["rect.barra"], inCharts: true },
      { rgb: hexToRgb("#FFFFFF"), weight: 0.5, roles: ["background"], levels: ["dom-svg"], examples: ["svg"], inCharts: false }], domObservations: 30 }
  ]);
  const white = palette.find((c) => c.hex === "#FFFFFF");
  const orange = palette.find((c) => c.hex === "#F28E2B");
  check("los pesos se escalan por observaciones (blanco 0,625; naranja 0,375)", white && orange && Math.abs(white.weight - 0.625) < 1e-9 && Math.abs(orange.weight - 0.375) < 1e-9,
    JSON.stringify(palette.map((c) => [c.hex, c.weight])));
  check("la marca inCharts sobrevive a la fusión", orange.inCharts === true && white.inCharts === false);

  const group = (fg, bg, passes, count) => ({ criterion: "1.4.3", foreground: { hex: fg }, background: { hex: bg }, ratio: 3, threshold: 4.5, largeText: false, passes, count, roles: ["text"], examples: ["p"] });
  const contrast = mergeContrastResults([
    { text: [group("#242424", "#FFFFFF", true, 4)], graphics: [] },
    { text: [group("#242424", "#FFFFFF", true, 6), group("#9E9E9E", "#FFFFFF", false, 1)], graphics: [] }
  ]);
  check("los pares iguales de dos marcos se suman (10 elementos) y los fallos van primero", contrast.text.length === 2 && contrast.text[0].passes === false && contrast.text[1].count === 10,
    JSON.stringify(contrast.text.map((g) => [g.foreground.hex, g.count])));
}

// ---- Contraste aproximado de las series sin par propio ----
{
  const color = (hex, rgb, roles, levels, weight = 0.1) => ({ hex, rgb, roles, levels, weight, share: weight, examples: [] });
  const white = { r: 255, g: 255, b: 255 };
  const grey = { r: 229, g: 229, b: 229 };
  const palette = [
    color("#FFFFFF", white, ["background"], ["dom-svg", "capture"], 0.6),
    color("#4E79A7", { r: 78, g: 121, b: 167 }, ["series"], ["dom-svg"]),      // con fila propia
    color("#29DACB", { r: 41, g: 218, b: 203 }, ["series"], ["capture"]),      // captura: 1,75:1
    color("#0072B2", { r: 0, g: 114, b: 178 }, ["series"], ["canvas"]),        // canvas: contra el fondo del canvas
    color("#767676", { r: 118, g: 118, b: 118 }, ["border"], ["capture"])      // no es serie: sin fila
  ];
  const own = { criterion: "1.4.11", foreground: { hex: "#4E79A7", rgb: { r: 78, g: 121, b: 167 } }, background: { hex: "#FFFFFF", rgb: white }, ratio: 4.47, threshold: 3, largeText: false, passes: true, count: 3, examples: ["rect.barra"], roles: ["series"] };
  const result = addApproximateSeriesContrast(palette, { text: [], graphics: [own] }, {
    pageBackground: { hex: "#FFFFFF", rgb: white },
    canvasBackground: { hex: "#E5E5E5", rgb: grey },
    captureBackground: { hex: "#FFFFFF", rgb: white }
  });
  const added = result.graphics.filter((g) => g.approximate);
  check("aproximado: se añade una fila por serie muestreada sin par propio (2) y la fila propia no cambia",
    added.length === 2 && result.graphics.length === 3 && result.graphics.some((g) => g === own || (g.foreground.hex === "#4E79A7" && !g.approximate)),
    JSON.stringify(result.graphics.map((g) => [g.foreground.hex, g.approximate === true])));
  const capture = added.find((g) => g.foreground.hex === "#29DACB");
  const canvas = added.find((g) => g.foreground.hex === "#0072B2");
  check("aproximado: la serie de captura va contra el fondo de la captura (1,75:1, incumple) y la de canvas contra el fondo CSS del canvas",
    capture && capture.source === "capture" && capture.background.hex === "#FFFFFF" && Math.abs(capture.ratio - 1.75) < 0.01 && capture.passes === false && capture.count === 0 &&
    canvas && canvas.source === "canvas" && canvas.background.hex === "#E5E5E5",
    JSON.stringify(added.map((g) => [g.foreground.hex, g.source, g.background.hex, g.ratio.toFixed(2), g.passes])));
  check("aproximado: los fallos van primero y el borde sin serie no recibe fila", result.graphics[0].passes === false && !result.graphics.some((g) => g.foreground.hex === "#767676"));
  const fallback = addApproximateSeriesContrast(palette.slice(0, 3), { text: [], graphics: [] }, {});
  check("aproximado: sin fondos conocidos usa el fondo de mayor peso de la paleta (blanco)",
    fallback.graphics.length === 1 && fallback.graphics[0].background.hex === "#FFFFFF", JSON.stringify(fallback.graphics.map((g) => g.background.hex)));
  const untouched = addApproximateSeriesContrast([palette[1]], { text: [], graphics: [own] }, {});
  check("aproximado: una paleta solo con series de elemento devuelve el mismo contraste", untouched.graphics.length === 1 && untouched.graphics[0] === own);
}

console.log("\n" + passed + " pruebas pasan, " + failed + " fallan" + (failed === 0 ? "  — TODAS LAS PRUEBAS PASAN" : ""));
process.exit(failed === 0 ? 0 : 1);

// ------------------------------------------------------------------
// Pruebas unitarias de la simulación por captura (versión 1.0.0).
// Herramienta de desarrollo: no forma parte del paquete. Ejecutar con:
//   node herramientas/pruebas-simulacion.mjs
//
// Comprueba que la simulación píxel a píxel (imagen.js) da exactamente
// el mismo resultado que simulateMachado y simulateTritanopia color a
// color, que conserva el alfa, que la detección de captura uniforme
// distingue una página en blanco de un dashboard y que la decisión de
// modo (filtro o captura) responde al perfil de la página.
// Sale con código 1 si algo falla.
// ------------------------------------------------------------------

import { simulateImageData, isNearlyUniform, decideSimulationMode } from "../src/core/simulacion/imagen.js";
import { simulateMachado } from "../src/core/simulacion/machado.js";
import { simulateTritanopia } from "../src/core/simulacion/brettel.js";

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

// Píxeles deterministas: una rejilla del cubo RGB más algunos extremos.
function samplePixels() {
  const pixels = [];
  for (let r = 0; r < 256; r += 51) for (let g = 0; g < 256; g += 51) for (let b = 0; b < 256; b += 51) pixels.push([r, g, b]);
  pixels.push([1, 2, 3], [254, 253, 252], [46, 117, 182], [157, 195, 230], [242, 142, 43], [2, 72, 122]);
  return pixels;
}
function makeImage(pixels) {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => {
    data[i * 4] = p[0];
    data[i * 4 + 1] = p[1];
    data[i * 4 + 2] = p[2];
    data[i * 4 + 3] = (i * 37) % 256;
  });
  return { data, width: pixels.length, height: 1 };
}

// ---- 1. Igualdad píxel a píxel con las funciones color a color --------
{
  const pixels = samplePixels();
  const image = makeImage(pixels);
  const configs = [
    { type: "protanopia", severity: 1 },
    { type: "protanopia", severity: 0.4 },
    { type: "deuteranopia", severity: 1 },
    { type: "deuteranopia", severity: 0.7 },
    { type: "tritanopia", severity: 1 }
  ];
  for (const config of configs) {
    const out = simulateImageData(image, config);
    let mismatches = 0;
    let alphaLost = 0;
    pixels.forEach((p, i) => {
      const expected = config.type === "tritanopia"
        ? simulateTritanopia({ r: p[0], g: p[1], b: p[2] })
        : simulateMachado({ r: p[0], g: p[1], b: p[2] }, config.type, config.severity);
      if (out.data[i * 4] !== expected.r || out.data[i * 4 + 1] !== expected.g || out.data[i * 4 + 2] !== expected.b) mismatches += 1;
      if (out.data[i * 4 + 3] !== image.data[i * 4 + 3]) alphaLost += 1;
    });
    check(config.type + " " + config.severity + ": " + pixels.length + " píxeles idénticos a la función color a color", mismatches === 0, mismatches + " distintos");
    check(config.type + " " + config.severity + ": el alfa se conserva", alphaLost === 0);
  }
  const identity = simulateImageData(image, { type: "protanopia", severity: 0 });
  check("severidad 0 devuelve una copia bit a bit", identity.data.every((v, i) => v === image.data[i]));
  const none = simulateImageData(image, { type: "none" });
  check("«none» devuelve una copia bit a bit", none.data.every((v, i) => v === image.data[i]) && none.data !== image.data);
}

// ---- 2. Captura uniforme (página en blanco) ---------------------------
{
  const fill = (w, h, rgb) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      data[i * 4] = rgb[0];
      data[i * 4 + 1] = rgb[1];
      data[i * 4 + 2] = rgb[2];
      data[i * 4 + 3] = 255;
    }
    return { data, width: w, height: h };
  };
  const white = fill(64, 36, [255, 255, 255]);
  check("una captura blanca es uniforme", isNearlyUniform(white));
  const noisy = fill(64, 36, [250, 250, 250]);
  for (let i = 0; i < noisy.data.length; i += 4) noisy.data[i] = 245 + (i % 9);
  check("una captura casi blanca con ruido leve es uniforme", isNearlyUniform(noisy));
  const dashboard = fill(64, 36, [255, 255, 255]);
  for (let y = 10; y < 30; y += 1) for (let x = 5; x < 20; x += 1) { const i = (y * 64 + x) * 4; dashboard.data[i] = 46; dashboard.data[i + 1] = 117; dashboard.data[i + 2] = 182; }
  check("una captura con un 13 % de barras azules no es uniforme", !isNearlyUniform(dashboard));
  const empty = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
  check("una captura vacía cuenta como uniforme", isNearlyUniform(empty));
}

// ---- 3. Decisión de modo -----------------------------------------------
{
  check("documento de imagen: captura", decideSimulationMode({ isImageDocument: true }) === "capture");
  check("imagen que ocupa el 70 % de la vista: captura", decideSimulationMode({ imageShare: 0.7 }) === "capture");
  check("canvas WebGL que ocupa el 60 %: captura", decideSimulationMode({ webglShare: 0.6 }) === "capture");
  check("canvas WebGL pequeño (20 %) e imagen pequeña: filtro", decideSimulationMode({ webglShare: 0.2, imageShare: 0.1 }) === "filter");
  check("sin perfil: filtro", decideSimulationMode(null) === "filter");
  check("dashboard SVG sin canvas ni imágenes: filtro", decideSimulationMode({ isImageDocument: false, imageShare: 0, webglShare: 0, canvasCount: 0 }) === "filter");
}

console.log("\n" + passed + " pruebas pasan, " + failed + " fallan" + (failed === 0 ? "  — TODAS LAS PRUEBAS PASAN" : ""));
process.exit(failed === 0 ? 0 : 1);

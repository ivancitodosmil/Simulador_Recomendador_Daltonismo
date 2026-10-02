// ------------------------------------------------------------------
// Rastreo estático de la interfaz (iteración 0.6.8). Herramienta de
// DESARROLLO: no forma parte del paquete. Ejecutar con:
//   node herramientas/rastreo-ui.mjs
//
// Comprueba, sobre el panel, su hoja de estilos, la página del reporte
// y la plantilla, las reglas visuales del proyecto:
//   1. Sin iconos ni glifos decorativos: ningún <svg> salvo los DOS del
//      selector de tema (data-icono="sol" y "luna" dentro de
//      #theme-group), ningún carácter Unicode decorativo ni emoji fuera
//      de comentarios, ningún resto del módulo de iconos de 0.6.0.
//   2. Sin sombras salvo la de la pieza del selector (.tema .pulgar).
//   3. Sin etiquetas en mayúsculas con espaciado (text-transform).
//   4. Sin barras laterales de color en párrafos (border-left sin los
//      demás bordes), salvo los divisores de las tarjetas del veredicto
//      del reporte (.ver + .ver) y la rejilla del método.
// Sale con código 1 si algo falla.
// ------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = [
  "src/ui/panel/panel.html",
  "src/ui/panel/panel.js",
  "src/ui/panel/tema.js",
  "src/ui/estilos/componentes.css",
  "src/ui/estilos/tokens.css",
  "src/ui/reporte/reporte.html",
  "src/ui/reporte/reporte.js",
  "src/core/reporte/plantilla.js"
];

const GLYPHS = /[✔✖▲▾▴ℹ→←↑↓•◆■●✓✗⚠\u{1F300}-\u{1FAFF}]/u;
const COMMENT = /^\s*(\/\/|\/\*|\*|<!--)/;

let fallos = 0;
const fail = (text) => { fallos += 1; console.log(" FALLO " + text); };
const ok = (text) => console.log(" ok    " + text);

for (const file of FILES) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const lines = text.split("\n");

  // 1. SVG: solo los dos del selector de tema en panel.html.
  const svgs = (text.match(/<svg\b/g) || []).length;
  if (file === "src/ui/panel/panel.html") {
    const group = (text.match(/<div class="tema" id="theme-group"[\s\S]*?<\/div>/) || [""])[0];
    const inGroup = (group.match(/<svg\b[^>]*data-icono="(sol|luna)"/g) || []).length;
    if (svgs === 2 && inGroup === 2) ok(file + ": 2 SVG, ambos en el selector de tema (sol y luna)");
    else fail(file + ": " + svgs + " SVG en total, " + inGroup + " admitidos en el selector (se esperan 2 y 2)");
  } else if (svgs > 0) {
    fail(file + ": " + svgs + " <svg> fuera del selector de tema");
  } else {
    ok(file + ": sin <svg>");
  }

  // Glifos decorativos y emoji fuera de comentarios.
  const glyphHits = lines.map((line, i) => (GLYPHS.test(line) && !COMMENT.test(line) ? i + 1 : 0)).filter(Boolean);
  if (glyphHits.length) fail(file + ": glifos decorativos en líneas " + glyphHits.join(", "));
  else ok(file + ": sin glifos decorativos ni emoji");

  // Restos del módulo de iconos de 0.6.0.
  if (/iconMarkup|iconElement|comunes\/iconos/.test(text)) fail(file + ": referencia al módulo de iconos retirado");

  if (file.endsWith(".css") || file === "src/core/reporte/plantilla.js" || file === "src/ui/reporte/reporte.html") {
    // 2. Sombras: solo .tema .pulgar.
    const shadowLines = lines.map((line, i) => (/box-shadow/.test(line) && !COMMENT.test(line) ? i + 1 : 0)).filter(Boolean);
    const allowedShadow = shadowLines.filter((n) => {
      // La regla a la que pertenece la línea: buscar hacia atrás el selector.
      for (let k = n - 1; k >= Math.max(0, n - 12); k -= 1) {
        if (/^\s*\.tema \.pulgar \{/.test(lines[k])) return true;
        if (/\{\s*$/.test(lines[k]) && k !== n - 1) return false;
      }
      return false;
    });
    const badShadow = shadowLines.filter((n) => !allowedShadow.includes(n));
    if (badShadow.length) fail(file + ": box-shadow fuera de .tema .pulgar en líneas " + badShadow.join(", "));
    else ok(file + ": sin sombras" + (allowedShadow.length ? " (salvo la pieza del selector)" : ""));

    // 3. Mayúsculas con espaciado.
    if (/text-transform\s*:\s*uppercase/.test(text)) fail(file + ": text-transform: uppercase");
    else ok(file + ": sin text-transform: uppercase");

    // 4. Barras laterales de color.
    const sideLines = lines.map((line, i) => (/border-left\s*:\s*[1-9]/.test(line) && !COMMENT.test(line) ? i + 1 : 0)).filter(Boolean);
    const allowedSide = sideLines.filter((n) => /\.ver \+ \.ver|\.metodo div|\.tema button \+ button/.test(lines[n - 1]));
    const badSide = sideLines.filter((n) => !allowedSide.includes(n));
    if (badSide.length) fail(file + ": border-left de color en líneas " + badSide.join(", "));
    else ok(file + ": sin barras laterales de color");
  }
}

console.log("\nTOTAL FALLOS: " + fallos + (fallos === 0 ? "  — RASTREO SUPERADO" : ""));
process.exit(fallos === 0 ? 0 : 1);

// ------------------------------------------------------------------
// Auditoría automatizada de tokens (iteración 0.6.0, frente 3).
// Herramienta de DESARROLLO: no forma parte del paquete de la
// extensión (empaquetar.mjs la excluye). Ejecutar con: node
// herramientas/auditoria-tokens.mjs (desde la carpeta de la extensión).
//
// Lee src/ui/estilos/tokens.css, reconstruye los DOS temas (claro y
// oscuro) y verifica, con los módulos de la propia extensión:
//   1. Contraste ≥ 4,5:1 de todo token de texto (texto, secundario,
//      acento como enlace, correcto, aviso, error) sobre cada
//      superficie (fondo-pagina, superficie, superficie-2).
//   2. Cada semántico ≥ 4,5:1 sobre su fondo suave (pastillas) y el
//      texto del acento ≥ 4,5:1 sobre el acento (botón primario).
//   3. Borde y anillo de foco ≥ 3:1 sobre cada superficie.
//   4. correcto/aviso/error distinguibles entre sí: ΔE00 ≥ 10 bajo
//      protanopía y deuteranopía (Machado, severidad 1,0) y
//      tritanopía (Brettel).
//   5. La copia literal del tema claro embebida en
//      src/core/reporte/plantilla.js coincide token a token.
// Sale con código 1 si algo falla.
// ------------------------------------------------------------------

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = pathToFileURL(ROOT + "/").href;

const { contrastRatio } = await import(base + "src/core/color/contraste.js");
const { hexToRgb, rgbToLab } = await import(base + "src/core/color/conversion.js");
const { ciede2000 } = await import(base + "src/core/color/diferencia.js");
const { simulateForConfig } = await import(base + "src/core/evaluacion/distinguibilidad.js");

// ---- lectura de tokens.css ---------------------------------------

const cssText = await readFile(join(ROOT, "src/ui/estilos/tokens.css"), "utf8");

/** Extrae { --nombre: valor } del primer bloque :root a partir de un índice. */
function parseRootBlock(text, fromIndex) {
  const start = text.indexOf(":root", fromIndex);
  if (start === -1) return null;
  const open = text.indexOf("{", start);
  const close = text.indexOf("}", open);
  const body = text.slice(open + 1, close);
  const tokens = {};
  for (const match of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[match[1]] = match[2].trim();
  }
  return { tokens, end: close };
}

const lightBlock = parseRootBlock(cssText, 0);
// Se buscan los SELECTORES reales (la cabecera comentada también los menciona).
const darkIndex = cssText.indexOf("@media (prefers-color-scheme: dark)");
const darkBlock = darkIndex === -1 ? null : parseRootBlock(cssText, darkIndex);
if (!lightBlock || !darkBlock) {
  console.error("FALLO: no se encontraron los dos bloques :root (claro y oscuro) en tokens.css");
  process.exit(1);
}
// 0.6.3: el bloque oscuro manual (:root[data-tema="oscuro"]) debe ser
// idéntico al automático (prefers-color-scheme), token a token.
const manualIndex = cssText.indexOf(':root[data-tema="oscuro"] {');
const manualBlock = manualIndex === -1 ? null : parseRootBlock(cssText, manualIndex);
if (!manualBlock) {
  console.error("FALLO: falta el bloque :root[data-tema=\"oscuro\"] en tokens.css");
  process.exit(1);
}
// El tema oscuro hereda lo que no redefine.
const CLARO = lightBlock.tokens;
const OSCURO = { ...lightBlock.tokens, ...darkBlock.tokens };

const SUPERFICIES = ["fondo-pagina", "superficie", "superficie-2"];
const TEXTOS = ["texto", "texto-secundario", "acento", "correcto", "aviso", "error"];
const TRIO = ["correcto", "aviso", "error"];
const CONFIGS = [
  { type: "protanopia", severity: 1 },
  { type: "deuteranopia", severity: 1 },
  { type: "tritanopia", severity: 1 }
];

let fallos = 0;
const filas = [];

function check(tema, etiqueta, fgHex, bgHex, minimo) {
  const ratio = contrastRatio(hexToRgb(fgHex), hexToRgb(bgHex));
  const ok = ratio >= minimo;
  if (!ok) fallos += 1;
  filas.push(
    (ok ? " ok    " : " FALLO ") + tema + "  " + etiqueta.padEnd(34) +
    fgHex + " sobre " + bgHex + " = " + ratio.toFixed(2).padStart(6) + ":1 (min " + minimo + ")"
  );
}

function auditaTema(nombre, T) {
  for (const s of SUPERFICIES) {
    for (const t of TEXTOS) {
      check(nombre, t + " / " + s, T[t], T[s], 4.5);
    }
  }
  for (const sem of TRIO) {
    check(nombre, sem + " / " + sem + "-suave", T[sem], T[sem + "-suave"], 4.5);
  }
  check(nombre, "acento-texto / acento", T["acento-texto"], T["acento"], 4.5);
  for (const s of SUPERFICIES) {
    check(nombre, "borde / " + s, T["borde"], T[s], 3);
    check(nombre, "foco (acento) / " + s, T["acento"], T[s], 3);
  }
  // Distinguibilidad del trío semántico bajo las tres deficiencias.
  for (const cfg of CONFIGS) {
    for (let i = 0; i < TRIO.length; i += 1) {
      for (let j = i + 1; j < TRIO.length; j += 1) {
        const a = rgbToLab(simulateForConfig(hexToRgb(T[TRIO[i]]), cfg));
        const b = rgbToLab(simulateForConfig(hexToRgb(T[TRIO[j]]), cfg));
        const d = ciede2000(a, b);
        const ok = d >= 10;
        if (!ok) fallos += 1;
        filas.push(
          (ok ? " ok    " : " FALLO ") + nombre + "  dE00 " +
          (cfg.type + " " + TRIO[i] + "-" + TRIO[j]).padEnd(40) + d.toFixed(1)
        );
      }
    }
  }
}

auditaTema("claro ", CLARO);
auditaTema("oscuro", OSCURO);

// ---- los dos bloques oscuros son idénticos -----------------------
for (const name of new Set([...Object.keys(darkBlock.tokens), ...Object.keys(manualBlock.tokens)])) {
  const ok = darkBlock.tokens[name] === manualBlock.tokens[name];
  if (!ok) fallos += 1;
  filas.push((ok ? " ok    " : " FALLO ") + "tema manual --" + name.padEnd(20) + (ok ? "coincide con el automático" : "difiere: " + darkBlock.tokens[name] + " vs " + manualBlock.tokens[name]));
}

// ---- sincronía con la plantilla del reporte ----------------------

const plantilla = await readFile(join(ROOT, "src/core/reporte/plantilla.js"), "utf8");
for (const match of plantilla.matchAll(/--([a-z0-9-]+)\s*:\s*([^;\\]+);/gi)) {
  const name = match[1];
  const value = match[2].trim().replaceAll('\\"', '"');
  if (!(name in CLARO)) {
    fallos += 1;
    filas.push(" FALLO plantilla  --" + name + " no existe en tokens.css");
    continue;
  }
  const expected = CLARO[name];
  const ok = value === expected;
  if (!ok) fallos += 1;
  filas.push(
    (ok ? " ok    " : " FALLO ") + "plantilla  --" + name.padEnd(20) +
    (ok ? "coincide" : "difiere: reporte '" + value + "' vs tokens '" + expected + "'")
  );
}

console.log("Auditoría de tokens (contraste con contraste.js, simulación con");
console.log("machado.js/brettel.js, diferencia con diferencia.js):\n");
for (const fila of filas) console.log(fila);
console.log("\nTOTAL FALLOS: " + fallos + (fallos === 0 ? "  — AUDITORÍA SUPERADA" : ""));
process.exit(fallos === 0 ? 0 : 1);

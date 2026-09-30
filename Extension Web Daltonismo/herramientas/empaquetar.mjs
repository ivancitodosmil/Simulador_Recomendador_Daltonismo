// ------------------------------------------------------------------
// Empaquetado para la Chrome Web Store (iteración 0.6.0, frente 4).
// Herramienta de DESARROLLO. Ejecutar con: node herramientas/empaquetar.mjs
//
// - Verifica que la versión del manifest coincide con la primera
//   versión del CHANGELOG; si no, FALLA sin generar nada.
// - Copia a una carpeta temporal SOLO lo que la extensión necesita:
//   manifest.json, src/** y assets/** (sin herramientas, documentos,
//   banco de pruebas ni archivos de desarrollo).
// - Genera empaquetado/evaluador-cromatico-dashboards-<version>.zip
//   con PowerShell Compress-Archive (sin dependencias de Node).
// ------------------------------------------------------------------

import { cp, mkdir, readFile, rm, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1. Versión del manifest = primera versión del CHANGELOG, o se aborta.
const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
const changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf8");
const firstVersion = (changelog.match(/^## \[([0-9.]+)\]/m) || [])[1];
if (!firstVersion) {
  console.error("FALLO: el CHANGELOG no tiene ninguna entrada '## [x.y.z]'.");
  process.exit(1);
}
if (firstVersion !== manifest.version) {
  console.error(
    "FALLO: la versión del manifest (" + manifest.version +
    ") no coincide con la primera del CHANGELOG (" + firstVersion + ")."
  );
  process.exit(1);
}

// 2. Copia selectiva: solo lo que el paquete necesita.
const INCLUDE = ["manifest.json", "src", "assets"];
const stagingRoot = join(ROOT, "empaquetado");
const staging = join(stagingRoot, "paquete");
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const entry of INCLUDE) {
  await cp(join(ROOT, entry), join(staging, entry), { recursive: true });
}

// 3. Comprobación defensiva: nada de archivos de desarrollo dentro.
async function listFiles(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}
const files = await listFiles(staging);
const forbidden = files.filter((f) => /\.(md|mjs|zip)$|LICENSE/i.test(f));
if (forbidden.length) {
  console.error("FALLO: el paquete contiene archivos de desarrollo:\n" + forbidden.join("\n"));
  process.exit(1);
}

// 4. ZIP con PowerShell (Windows).
const zipName = "evaluador-cromatico-dashboards-" + manifest.version + ".zip";
const zipPath = join(stagingRoot, zipName);
await rm(zipPath, { force: true });
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  "Compress-Archive -Path '" + staging + "\\*' -DestinationPath '" + zipPath + "'"
]);

console.log("Paquete generado: " + zipPath);
console.log("Archivos incluidos: " + files.length);

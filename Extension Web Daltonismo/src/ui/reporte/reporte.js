// ------------------------------------------------------------------
// Iteración 0.6.5 · Página propia del reporte. Se abre en una pestaña
// nueva desde el panel («Exportar PDF») con los datos de la evaluación
// pasados por chrome.storage.session (clave report:<id> en ?id=).
// Pinta el reporte con plantilla.js, pone como título el nombre de
// archivo que propondrá Chrome («Reporte cromático · nombre · fecha»)
// y, cuando termina de pintarse, lanza window.print() para que el
// usuario lo guarde con el destino «Guardar como PDF». El PDF lo
// genera el propio navegador: texto real y seleccionable, sin
// librerías ni permisos adicionales. Sin peticiones de red (RNF02).
// ------------------------------------------------------------------

import { REPORT_STYLES, renderReportBody, reportTitle } from "../../core/reporte/plantilla.js";

const article = document.getElementById("reporte");
const instruction = document.getElementById("instruccion");
const reprintButton = document.getElementById("reimprimir");

document.getElementById("estilos-reporte").textContent = REPORT_STYLES;

/** Muestra un mensaje en lugar del reporte (sin abrir el diálogo). */
function showError(text) {
  instruction.className = "error";
  instruction.textContent = "Error " + text;
  reprintButton.hidden = true;
  article.textContent = "";
}

/** Abre el diálogo de impresión cuando la página ya está pintada. */
function printWhenPainted() {
  const open = () => {
    try { window.print(); } catch (error) { /* el usuario puede pulsar el botón */ }
  };
  const ready = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  ready.then(() => {
    // Dos cuadros de animación: el primero pinta, el segundo garantiza el pintado.
    requestAnimationFrame(() => requestAnimationFrame(open));
  });
}

async function init() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    showError("No se indicó qué evaluación mostrar. Vuelve al panel y pulsa «Exportar PDF».");
    return;
  }
  let data = null;
  try {
    const stored = await chrome.storage.session.get("report:" + id);
    data = stored["report:" + id] || null;
  } catch (error) {
    data = null;
  }
  if (!data || !data.meta) {
    showError("No se encontró la evaluación de este reporte (la sesión del navegador se cerró). Vuelve al panel y pulsa «Exportar PDF».");
    return;
  }
  document.title = reportTitle(data);
  article.innerHTML = renderReportBody(data);
  printWhenPainted();
}

reprintButton.addEventListener("click", () => {
  try { window.print(); } catch (error) { /* sin diálogo disponible */ }
});

init();

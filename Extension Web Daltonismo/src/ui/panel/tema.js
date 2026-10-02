// ------------------------------------------------------------------
// Tema antes del primer pintado. Script clásico (no módulo) cargado en
// el <head> de panel.html: aplica la elección manual de tema guardada
// antes de que se pinte nada, para que no haya parpadeo. Panel lateral,
// versión 0.6.3.
//
// chrome.storage.local es la preferencia real (global para todas las
// pestañas), pero su lectura es asíncrona; por eso panel.js mantiene un
// espejo síncrono en localStorage (mismo origen de la extensión,
// compartido por todos los paneles) que es el que se lee aquí. Sin
// elección guardada no se pone nada: manda el sistema.
// ------------------------------------------------------------------
(function () {
  try {
    var tema = localStorage.getItem("tema");
    if (tema === "claro" || tema === "oscuro") {
      document.documentElement.setAttribute("data-tema", tema);
    }
  } catch (error) {
    // Sin localStorage disponible: sigue la preferencia del sistema.
  }
})();

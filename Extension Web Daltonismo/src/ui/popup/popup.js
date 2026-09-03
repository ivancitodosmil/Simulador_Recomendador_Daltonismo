// ------------------------------------------------------------------
// Popup · superficie auxiliar mínima tras el ajuste de UX post-Sprint 3.
// Toda la funcionalidad (controles de simulación, extracción, paleta y
// evaluaciones) se trasladó al panel lateral, que el icono de la
// extensión abre directamente (openPanelOnActionClick en el service
// worker). Este popup solo ofrece un acceso alternativo al panel y se
// conserva porque la estructura de superficies del proyecto es fija.
// ------------------------------------------------------------------

const openPanelButton = document.getElementById("open-panel-button");
const statusElement = document.getElementById("status");

/** Estado con icono de forma distinta + texto. */
function setStatus(kind, icon, text) {
  statusElement.className = "estado estado--" + kind;
  statusElement.replaceChildren();
  const iconElement = document.createElement("span");
  iconElement.className = "estado-icono";
  iconElement.setAttribute("aria-hidden", "true");
  iconElement.textContent = icon;
  const message = document.createElement("span");
  message.textContent = text;
  statusElement.append(iconElement, message);
}

/** Abre el panel lateral sobre la pestaña activa (requiere gesto de usuario). */
async function openPanel() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      setStatus("error", "✖", "No se encontró una pestaña activa.");
      return;
    }
    await chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  } catch (error) {
    setStatus("error", "✖", "No se pudo abrir el panel lateral en esta ventana.");
  }
}

openPanelButton.addEventListener("click", openPanel);

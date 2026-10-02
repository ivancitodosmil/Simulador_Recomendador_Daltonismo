# Evaluador cromático de dashboards

Extensión de navegador (Manifest V3) que evalúa la accesibilidad
cromática de dashboards para personas con deficiencias en la percepción
del color: extrae la paleta, simula protanopía, deuteranopía y
tritanopía, mide contraste WCAG 2.1 y distinguibilidad CIEDE2000, y
propone paletas accesibles. Todo el cálculo es local: la extensión no
realiza ninguna petición de red.

Prototipo desarrollado como trabajo de titulación.

## Instalación en modo desarrollador

1. Descarga o clona este repositorio.
2. Abre `chrome://extensions` en Chrome (116 o superior).
3. Activa **Modo de desarrollador** (esquina superior derecha).
4. Pulsa **Cargar descomprimida** y elige la carpeta
   `Extension Web Daltonismo` (la que contiene `manifest.json`).
5. Abre la pestaña del dashboard a evaluar y haz clic en el icono de la
   extensión: el panel lateral se abre para esa pestaña.
6. Para evaluar archivos locales (`file://`), activa además
   **Permitir acceso a URL de archivo** en la ficha de la extensión.

## Estructura

- `manifest.json` — Manifest V3: panel lateral, service worker, permisos
  y módulos accesibles desde la página.
- `src/core/` — módulos de cálculo sin dependencias externas:
  `color/` (conversión, contraste WCAG, CIEDE2000), `extraccion/`
  (niveles DOM/SVG, canvas y captura, consolidación), `simulacion/`
  (Machado, Brettel, filtro SVG en vivo), `evaluacion/` (contraste y
  distinguibilidad), `recomendacion/` (catálogo y algoritmo) y
  `reporte/` (datos y plantilla del reporte).
- `src/ui/panel/` — panel lateral: `panel.html`, `panel.js` y `tema.js`
  (tema aplicado antes del primer pintado).
- `src/ui/reporte/` — página del reporte que se exporta a PDF con el
  diálogo de impresión del navegador.
- `src/ui/estilos/` — `tokens.css` (identidad visual, temas claro y
  oscuro) y `componentes.css` (componentes del panel).
- `src/background/` y `src/content/` — service worker y content script.
- `assets/iconos/` — icono de la extensión.
- `herramientas/` — utilidades de desarrollo (auditoría de tokens,
  empaquetado y rastreo de la interfaz); no forman parte del paquete.
- `../Pruebas/` — banco de pruebas con seis paneles de ejemplo y, en
  `Pruebas/Docs/`, las dos maquetas de diseño vigentes
  (`maqueta-panel.html` y `maqueta-reporte.html`); fuera del paquete.

## Herramientas de desarrollo

```
node herramientas/auditoria-tokens.mjs   # auditoría de contraste y CVD de los tokens
node herramientas/rastreo-ui.mjs         # rastreo estático de las reglas visuales de la interfaz
node herramientas/empaquetar.mjs         # genera el ZIP para la Chrome Web Store
```

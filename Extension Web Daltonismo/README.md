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
2. Abre `chrome://extensions` en Chrome (117 o superior).
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
  (nivel 1 DOM/SVG con zonas de gráficos y shadow roots, nivel 2 canvas,
  nivel 3 captura recortada, cuantización cromática, composición de
  marcos y consolidación), `simulacion/` (Machado, Brettel, filtro SVG en
  vivo y simulación píxel a píxel de una captura), `evaluacion/`
  (contraste y distinguibilidad), `recomendacion/` (catálogo y
  algoritmo) y `reporte/` (datos y plantilla del reporte).
- `src/ui/panel/` — panel lateral: `panel.html`, `panel.js` y `tema.js`
  (tema aplicado antes del primer pintado).
- `src/ui/reporte/` — página del reporte que se exporta a PDF con el
  diálogo de impresión del navegador.
- `src/ui/estilos/` — `tokens.css` (identidad visual, temas claro y
  oscuro) y `componentes.css` (componentes del panel).
- `src/background/` y `src/content/` — service worker y content script.
- `assets/iconos/` — icono de la extensión.
- `herramientas/` — utilidades de desarrollo (pruebas unitarias de la
  extracción, auditoría de tokens, rastreo de la interfaz y empaquetado);
  no forman parte del paquete.
- `../Pruebas/` — banco de pruebas con diez paneles de ejemplo (entre
  ellos una plataforma de informes con iframes, shadow DOM y más de
  5000 nodos, un dashboard como imagen PNG, un lienzo WebGL y un panel
  de ventas que cumple, también como PNG) y, en
  `Pruebas/Docs/`, las dos guías de diseño vigentes
  (`maqueta-panel.html`, la guía del panel, y `maqueta-reporte.html`);
  fuera del paquete.

## Cómo evalúa una página

1. El service worker inyecta el content script en todos los marcos de la
   pestaña y les pide suspender el filtro de simulación y la
   previsualización, para leer siempre los colores reales.
2. Cada marco localiza las zonas de gráficos (svg con marcas, canvas e
   iframes, también dentro de shadow roots abiertos), las recorre antes
   que el resto de la página, deja fuera la interfaz de la aplicación
   (navegación, barra superior, buscadores, menús, iconos) y lo oculto, y
   lee los canvas que no estén contaminados.
3. El service worker compone los marcos, captura recortadas las zonas que
   nadie pudo leer (iframes sin inyectar, canvas ilegibles, gráficos o
   imágenes sin colores de datos), fusiona paletas y contrastes y
   restaura el filtro y la previsualización.

## Cómo simula una deficiencia

- En una página normal aplica un filtro SVG (`feColorMatrix`) sobre el
  contenedor del dashboard del marco superior, que también alcanza a los
  iframes.
- Cuando el filtro no puede actuar (documento de imagen, imagen que
  ocupa la mayor parte de la vista, canvas WebGL como el lienzo de Figma
  o página que queda en blanco al filtrar) pasa a simulación por
  captura: captura la pestaña, la simula píxel a píxel con las mismas
  matrices del cálculo y la muestra como una capa fija que no captura el
  puntero; se recalcula al cambiar la severidad y se vuelve a capturar
  al desplazarse o redimensionar. El panel lo indica con una nota.
- Si la página de la pestaña cambia (recarga, navegación o cambio de
  ruta sin recarga), la simulación vuelve a «Ninguna», se retiran los
  efectos y se descarta la evaluación anterior; el panel lo avisa.
- La previsualización de la paleta propuesta recolorea con estilos en
  línea los elementos con alguno de los colores de las series
  consideradas y deja en cada uno una marca con sus valores previos; se
  retira siempre antes de leer la página, aunque la haya puesto otra
  instancia del content script. Cuando ninguna serie considerada tiene
  elementos recoloreables (canvas, WebGL, imagen o captura) el
  interruptor queda deshabilitado y lo explica.

## Herramientas de desarrollo

```
node herramientas/pruebas-extraccion.mjs # pruebas unitarias de recorte, cuantización y marcos
node herramientas/pruebas-simulacion.mjs # pruebas unitarias de la simulación por captura
node herramientas/auditoria-tokens.mjs   # auditoría de contraste y CVD de los tokens
node herramientas/rastreo-ui.mjs         # rastreo estático de las reglas visuales de la interfaz
node herramientas/empaquetar.mjs         # genera el ZIP para la Chrome Web Store
```

Requiere Chrome 117 o superior (`chrome.runtime.getFrameId` para situar
los iframes). Permisos: `scripting`, `sidePanel`, `storage` y
`webNavigation` (detectar los cambios de página de la pestaña); acceso
de host a todas las URL para inyectar el content script en todos los
marcos y capturar la pestaña (hace innecesario `activeTab`).

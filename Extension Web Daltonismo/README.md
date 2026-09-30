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

- `src/core/` — módulos de cálculo (color, extracción, simulación,
  evaluación, recomendación, reporte), sin dependencias externas.
- `src/ui/` — panel lateral y estilos (tokens + componentes).
- `src/background/` y `src/content/` — service worker y content script.
- `herramientas/` — utilidades de desarrollo (auditoría de tokens y
  empaquetado); no forman parte del paquete.

## Herramientas de desarrollo

```
node herramientas/auditoria-tokens.mjs   # auditoría de contraste y CVD de los tokens
node herramientas/empaquetar.mjs         # genera el ZIP para la Chrome Web Store
```

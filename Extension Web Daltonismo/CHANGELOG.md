# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Las versiones corresponden a los sprints del trabajo de titulación.

## [0.6.7] — 2026-09-29

### Cambiado
- Prueba del tema oscuro «Azul noche»: neutros azulados poco saturados
  (fondo #0F1420, superficies #1E2A40/#27364E aclaradas para separar
  los colores oscuros del dashboard, borde #8794AA, texto
  #E6ECF5, secundario #A5B1C4, acento #8AB4F8) con los mismos colores de
  estado (correcto #78CFBE, aviso #E5C46E, error #F28080) sobre fondos
  suaves ajustados, en los dos bloques oscuros de tokens.css. El tema
  claro, el reporte, la lógica y el cálculo no cambian.

## [0.6.6] — 2026-09-29

### Cambiado
- Tema oscuro nuevo: paleta grafito, menos saturada y menos deslumbrante
  (fondo #1B1D21, superficies #24272C/#2E3238, texto blanco roto #E3E6EA,
  acento #7FB2E5, correcto verde azulado #78CFBE, aviso ámbar #E5C46E,
  error rojo coral #F28080), en los dos bloques oscuros de tokens.css.
  El tema claro y el reporte no cambian; la auditoría verifica contraste
  y separación semántica bajo las tres deficiencias.
- Al evaluar una pestaña todas las secciones salen abiertas (resumen,
  paleta, contraste, distinguibilidad y recomendación); el plegado se
  recuerda solo en esa pestaña hasta volver a evaluar.
- Comillas españolas en la línea de ayuda del bloque de simulación.

## [0.6.5] — 2026-09-29

### Añadido
- Exportación en PDF: el botón del panel pasa a «Exportar PDF» y abre el
  reporte como página propia de la extensión (`src/ui/reporte/`) en una
  pestaña nueva, con los datos pasados por `chrome.storage.session`; al
  terminar de pintarse lanza `window.print()` para guardarlo con
  «Guardar como PDF». El PDF lo genera el navegador (texto real y
  seleccionable), sin librerías ni permisos nuevos. El título de la
  página es el nombre de archivo propuesto: «Reporte cromático · nombre
  o dominio · fecha». Barra solo en pantalla con la instrucción y un
  botón para reabrir el diálogo.

### Cambiado
- La plantilla del reporte reproduce la maqueta
  `Pruebas/Docs/maqueta-reporte.html`: portada azul con nombre, título,
  dashboard y datos; bandas grandes de la paleta; sección 1 con tres
  cifras y un párrafo de resumen redactado con reglas; paleta en
  fichas; tablas de contraste con muestra «Aa» o barra, escala
  logarítmica de 1 a 21 con el umbral y veredicto; matriz en triángulo
  inferior con número de serie en filas y columnas y tarjetas de pares
  confundibles con muestras típica y simulada y escala 0–50; esquema
  con justificación, tres cifras y columnas de antes y después; método
  y avisos solo si aplican; pie que declara que ningún dato salió del
  navegador. Sin simulación: la portada lo indica, no hay banda
  simulada y la sección 5 muestra el resumen bajo las tres deficiencias.
- Impresión A4 con márgenes de 14 mm, colores de fondo conservados,
  bloques y encabezados sin partir, pastillas con borde.
- Ya no se descarga el archivo HTML.

## [0.6.3] — 2026-09-29

### Cambiado
- El diseño del panel reproduce la maqueta `Pruebas/Docs/maqueta-panel.html`:
  cabecera con logotipo, nombre, línea de estado y selector de tema;
  bloque de simulación con el botón de evaluar dentro; resumen con las
  dos bandas de la paleta (series consideradas en visión típica y
  simuladas) y marcador de cuatro datos con totales; paleta, contraste
  (muestra «Aa» y barra del objeto sobre su fondo) y distinguibilidad
  (triángulo inferior de la matriz y pares conflictivos con escala de 0
  a 50) como bloques plegables; recomendación con resumen de series
  consideradas y enlace «Revisar», esquema, tres cifras del algoritmo,
  bandas original/propuesta, correspondencia e interruptor; pie con
  exportar como botón secundario y limpiar como enlace de texto.
- Selector de tema Claro/Oscuro (`role="radiogroup"`, teclado): sin
  elegir sigue al sistema; la elección se guarda en
  `chrome.storage.local` (global) y se aplica antes del primer pintado
  vía un espejo en `localStorage` leído por `src/ui/panel/tema.js`.
  tokens.css: claro en `:root`, oscuro automático guardado con
  `:root:not([data-tema="claro"])` y repetido en `:root[data-tema="oscuro"]`;
  la auditoría verifica que ambos bloques oscuros son idénticos.
- Escala tipográfica fija 12/13/14/16/22 px en rem (1.4.4), sin texto
  bajo 12 px y sin contenedores de texto de altura fija (1.4.12).
- El reporte adopta los mismos componentes: bandas, marcador, muestras
  «Aa» y escalas de los pares.

## [0.6.2] — 2026-09-29

### Cambiado
- El selector de deficiencia vuelve a ser el desplegable nativo con su
  etiqueta visible «Tipo de deficiencia», a todo el ancho del bloque; el
  control segmentado partía «Deuteranopía» en anchos estrechos.
- Sin tarjetas por defecto: las secciones son bloques sobre el fondo del
  panel separados por espacio y una línea fina; sin sombras; solo llevan
  borde las muestras de color y los campos de formulario. Encabezados y
  etiquetas en mayúscula inicial (sin `text-transform: uppercase`).
- Sin barras laterales de color: la confirmación de simulación pasa solo
  a la región para lectores de pantalla; la propuesta arranca con
  «Esquema propuesto: …» en semibold y su explicación debajo; los avisos
  y errores son párrafos que empiezan por «Aviso» o «Error» en semibold
  y en su color, sin caja ni fondo. Igual en el reporte.
- El resumen es un solo bloque como tabla sin marco (2×2 en estrecho y
  medio, 4 en fila en ancho) con la etiqueta arriba y el valor debajo
  acompañado de su palabra: «7 incumplen» / «Ninguno», «4 pares
  confundibles», «Niveles 1 y 2», «Exacta» / «Aproximada».
- Fuera los rellenos que solo decoran párrafos y filas, y los radios
  mayores que el pequeño salvo en botones y pastillas.

## [0.6.1] — 2026-09-28

### Cambiado
- Orden del panel: cabecera con una sola línea de estado («Pestaña sin
  evaluar» / «Evaluada a las HH:MM en N ms»), bloque de simulación
  siempre abierto con control segmentado (`role="radiogroup"`, flechas
  del teclado), botón de evaluar después («Volver a evaluar» en estilo
  secundario tras evaluar), fichas y secciones, y «Limpiar todo» al
  final. Cada dato se dice una sola vez: el resumen de cifras solo se
  anuncia a lectores de pantalla.
- Iconografía cero: se retiran todos los iconos y SVG decorativos del
  panel y del reporte (solo queda el logotipo). Los estados se
  comunican con texto y forma: pastillas con la palabra, avisos con
  borde izquierdo, celdas conflictivas en negrita con texto para
  lectores («confundible») y cheurones dibujados con bordes CSS.
- Responsividad real con consultas de contenedor sobre el ancho del
  panel: estrecho (≤ 360 px: segmentado en 2×2, fichas en dos columnas,
  muestras en una columna), medio (361–560) y ancho (≥ 561: cuatro
  fichas en fila, paleta y recomendación en dos columnas, contenido
  centrado a 760 px). Los tamaños de letra no cambian.

### Eliminado
- `src/ui/comunes/iconos.js`.

## [0.6.0] — 2026-09-28

### Añadido
- Conjunto único de iconos SVG de trazo (`src/ui/comunes/iconos.js`)
  compartido por el panel y el reporte; desaparecen todos los caracteres
  Unicode decorativos (✔ ✖ ▲ ℹ ▾).
- Panel lateral **por pestaña**: el clic en el icono lo habilita y lo abre
  solo para la pestaña pulsada (`chrome.sidePanel.setOptions` +
  `sidePanel.open` en el mismo gesto); el panel nace deshabilitado
  globalmente en la instalación.
- Estado por pestaña persistido en `chrome.storage.session` y restaurado
  al volver: simulación (`sim:<tabId>`), familia de paleta, selección de
  series consideradas, secciones plegadas y desplazamiento (`ui:<tabId>`).
- Resumen de recomendación bajo las tres deficiencias a severidad máxima
  cuando el selector está en «Ninguna».
- Sistema de tokens de diseño con tema claro y oscuro
  (`prefers-color-scheme`), neutros con sesgo azul, un solo acento y
  semánticos derivados de Okabe-Ito verificados con la simulación propia
  (ΔE00 ≥ 10 bajo las tres deficiencias) y contraste ≥ 4,5:1 / ≥ 3:1.
- Cabecera fija con estado de pestaña, franja de cuatro tarjetas de
  resumen, secciones plegables, matriz con encabezados fijos,
  correspondencias original→propuesta con flecha y diferencia ΔE00,
  interruptor real (`role="switch"`), objetivos táctiles de 24 px,
  `prefers-reduced-motion` y diseño sin desbordes desde 320 px.
- Auditoría automatizada de tokens (`herramientas/auditoria-tokens.mjs`)
  con los módulos de la propia extensión, incluida la sincronía con la
  copia del tema claro embebida en el reporte.
- Guion de empaquetado (`herramientas/empaquetar.mjs`), textos para la
  Chrome Web Store (`textos-web-store.md`), licencia y este registro.

### Cambiado
- La simulación de la página ahora es por pestaña y su único control es
  el selector de deficiencia: elegirla la aplica al instante y «Ninguna»
  la retira. `chrome.storage.local` conserva solo la última configuración
  usada, adoptada como valor sugerido al evaluar una pestaña sin
  simulación propia.
- `web_accessible_resources` recortado a los diez módulos que el content
  script importa realmente (cierre transitivo).
- `minimum_chrome_version: 116` (requisito de `chrome.sidePanel.open`).
- El reporte exportable usa la misma identidad visual que el panel
  (copia literal del tema claro de tokens.css, verificada por la
  auditoría).

### Eliminado
- El popup auxiliar (`src/ui/popup/`) y `openPanelOnActionClick`:
  `action.onClicked` no se dispara con un popup declarado y el flujo por
  pestaña lo sustituye.

## [0.5.0] — Sprint 5

### Añadido
- Selección por defecto de series consideradas con absorción por
  proximidad calibrada en vivo (piso 0,8 %, ΔE00 9,0, croma mínimo 6).
- Reporte HTML autocontenido exportable (HU08/RF08).
- Evaluación por pestaña con reconciliación del estado real de la página
  (`GET_PAGE_STATE`) al abrir el panel.
- Conmutador propio del filtro de página, botón «Limpiar todo», estados
  de carga y listas vacías diseñadas.

## [0.4.0] — Sprint 4

### Añadido
- Recomendación de paletas accesibles (HU06/RF06): catálogo acreditado
  (Okabe-Ito, Tol, IBM, Viridis/Cividis, monocromática), algoritmo de
  cuatro pasos con salida temprana, asignación inyectiva y revalidación
  contra el fondo dominante.
- Previsualización de la propuesta sobre la página (HU07/RF07) con
  restauración exacta.

## [0.3.0] — Sprint 3

### Añadido
- Evaluación de contraste WCAG 2.1 (1.4.3 y 1.4.11) sobre los colores
  declarados y distinguibilidad entre series con CIEDE2000 (HU04/HU05,
  RF04/RF05), validación de Sharma (34 pares).
- Panel lateral unificado e insignia numérica por pestaña.

## [0.2.0] — Sprint 2

### Añadido
- Simulación de deficiencias cromáticas (HU01/HU02, RF02/RF03): matrices
  de Machado (2009) con once severidades en RGB lineal, tritanopía exacta
  de Brettel (1997) y filtro SVG en vivo sobre la página.

## [0.1.0] — Sprint 1

### Añadido
- Estructura base MV3 y extracción de la paleta (HU03, RF01) en tres
  niveles: DOM/SVG, muestreo de canvas (median-cut) y captura de pestaña,
  con consolidación perceptual.

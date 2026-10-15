# Registro de cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Las versiones corresponden a los sprints del trabajo de titulación.

## [1.0.0] — 2026-10-09

Versión final del prototipo. Corrige la extracción en plataformas reales
(Power BI, Looker Studio, Tableau Public), que el Sprint 1 solo había
validado sobre el banco de pruebas.

### Corregido
- Mensajes cuando no hay colores de datos, según lo que haya en la
  página: sin zonas de gráficos (ni svg con marcas, ni canvas, ni
  imágenes grandes), «Esta página no tiene gráficos que evaluar. El
  contraste de textos y bordes sigue disponible en Contraste»; con zonas
  de gráficos vacías (svg grandes sin marcas, canvas en blanco o
  contenedores de gráfico con «Todavía no hay datos para mostrar»), «Los
  gráficos de esta página no muestran datos todavía. Carga datos o cambia
  el filtro y vuelve a evaluar»; «No se detectaron colores de datos en
  los gráficos…» queda solo para gráficos con marcas sin ningún color
  cromático de datos. Igual en el panel y en el reporte. El content script
  resume las zonas (con marcas, vacías, imágenes) y el nivel 2 cuenta los
  canvas en blanco. La captura de toda el área visible queda solo para
  cuando el nivel 1 no leyó ningún color: sin zonas de gráficos no se
  captura la página, porque convertía en «series» el color de la marca
  en textos y botones.
- Falso «Cumple» con series sin par de contraste: los colores de canvas y
  de captura no tienen elemento, no entraban en ningún par 1.4.11 y «0
  fallos» se tomaba como cumplimiento (un dashboard exportado desde Figma
  con cinco series por debajo de 3:1 salía como «Cumple»). Ahora cada
  serie muestreada sin par propio recibe un par 1.4.11 aproximado contra
  el fondo dominante de su zona (canvas: fondo CSS efectivo del canvas;
  captura: acromático dominante del recorte) o, en su defecto, contra el
  fondo de página; esas filas se marcan «aproximado» en Contraste y en el
  reporte, y la tarjeta «Cumple» lo declara. «Cumple» exige que el
  contraste de todas las series consideradas se haya evaluado y pase: si
  alguna queda sin evaluar nunca hay «Cumple», sino la recomendación
  normal con el aviso «No se pudo evaluar el contraste de N series
  consideradas». Con las series por captura, nota junto a las casillas:
  «En una imagen la extensión no distingue gráficos de iconos: desmarca
  los colores que no sean series de datos». Con una sola serie que cumple
  3:1 se muestra «Cumple» con «Una sola serie: no hay pares que
  comparar»; si incumple o no se pudo evaluar, «Sin recomendación» con
  la causa; con cero series sigue «Sin colores de datos». Consecuencia en
  el banco: panel-conforme (Okabe-Ito completo en canvas) ya no cumple,
  porque su amarillo, ámbar y celeste quedan bajo 3:1 sobre blanco.
- La extracción lee siempre los colores reales: el content script
  suspende el filtro de simulación y la previsualización en todos los
  marcos antes de leer el DOM y los canvas y antes de la captura, espera
  dos cuadros de animación y los restaura exactamente después. Evaluar
  con una deficiencia activa da la misma paleta que con «Ninguna».
- El content script se inyecta en todos los marcos de la pestaña y el
  service worker fusiona la paleta y el contraste de cada uno; los
  iframes en los que no se puede inyectar (sandbox, otro origen sin
  permiso) se capturan recortados a su rectángulo en vez de perderse en
  silencio.
- El nivel 1 empieza por las zonas de gráficos (svg con marcas, canvas e
  iframes, también dentro de shadow roots abiertos) y sigue hacia fuera
  desde la región que comparten; si se alcanza el tope de 5000 nodos por
  marco, el panel y el reporte lo avisan.
- Quedan fuera del recorrido la interfaz de la aplicación (navegación,
  barra superior, buscadores, menús, barras de herramientas y controles
  de formulario), los iconos (svg menores de 32 px, con `use` o dentro
  de botones, menús y pestañas) y lo oculto (display, visibility,
  opacity, tamaño cero, fuera de la página, texto solo para lectores
  recortado y regiones en vivo sin texto visible).
- La captura se recorta a las zonas de gráficos y se cuantiza con
  separación cromática: los colores exactos repetidos actúan como
  semillas, el umbral es relativo a los píxeles cromáticos (con un mínimo
  de muestras), los tonos a menos de ΔE00 3 se fusionan, el suavizado de
  bordes se pliega en su color puro según la adyacencia real de los
  píxeles y las franjas subpíxel del texto se descartan. El nivel 2
  (canvas) usa la misma cuantización, así que las líneas finas
  sobreviven aunque ocupen menos del 1 % de la pantalla.
- El nivel 3 se activa también cuando los niveles 1 y 2 no encuentran
  ningún color cromático de datos en las zonas de gráficos.
- Marcado por defecto de las series consideradas: solo los colores
  cromáticos dentro de las zonas de gráficos; quedan desmarcados los
  fondos, los acromáticos (blanco, casi blancos, grises) y los
  estructurales.
- Sin colores de datos la recomendación ya no dice «Cumple sin
  reemplazo»: muestra «No se detectaron colores de datos en los
  gráficos. Revisa que el dashboard esté visible o usa la captura.»,
  también en el reporte.
- Cuando la página de la pestaña cambia (recarga, navegación o cambio de
  ruta sin recarga: pushState, replaceState con otra dirección o cambio
  de fragmento), la simulación vuelve a «Ninguna», se retiran el filtro,
  la capa por captura y la previsualización si seguían puestos, se
  descarta la evaluación y el panel lo avisa con «La página cambió: se
  restableció «Ninguna» y se descartó la evaluación anterior.». Solo
  afecta a esa pestaña. Al abrir el panel o volver a la pestaña se
  comprueba con la página si el filtro sigue realmente aplicado y, si
  no, el selector queda en «Ninguna».
- La previsualización solo se aplica cuando el usuario enciende el
  interruptor; ningún render la reaplica. Cambiar el tipo de
  deficiencia con la previsualización activa la retira en todos los
  marcos, deja el interruptor apagado y lo avisa («Cambiaste a <tipo>:
  se retiró la previsualización…»); mover la severidad no la toca; tras
  «Volver a evaluar», «Limpiar todo» o un cambio de página el
  interruptor refleja lo que la página tiene de verdad.
- Nunca se lee la página con la previsualización puesta: cada elemento
  recoloreado lleva una marca con sus valores previos, de modo que
  cualquier instancia del content script (también tras recargar la
  extensión) la detecta en el estado de la página y la retira antes de
  extraer; la lectura comprueba al final que no quede ningún elemento
  marcado. Antes, la memoria de lo recoloreado vivía solo en la
  instancia que lo aplicó y una evaluación posterior podía leer la
  propuesta como si fuera la paleta original.
- El interruptor de previsualización se deshabilita cuando ninguna
  serie considerada tiene elementos recoloreables (gráficos en canvas,
  WebGL, imagen o simulación por captura), con la nota «No disponible
  en esta página: los gráficos están dibujados en canvas o vienen de una
  captura. La propuesta solo se puede ver en el panel y en el
  reporte.»; se recalcula al cambiar las series consideradas o la
  familia. Con algunos recoloreables y otros en canvas sigue disponible.

### Añadido
- Copiar colores y descargar el tema de Power BI desde la tabla de
  recomendación (maqueta de copiar). Cada hex propuesto es un botón
  «Copiar #…» (mono, fondo transparente, muestra a la izquierda) que
  copia solo el hex en mayúsculas y muestra «Copiado» en `--correcto`
  durante dos segundos; la palabra «Copiar» aparece al pasar o enfocar
  sin que la tabla salte. «Copiar todos» (botón tonal de 34 px) copia
  los colores propuestos uno por línea en el orden de la tabla y dice
  «Copiados N colores» o «Copiado 1 color». «Descargar tema de Power BI
  (.json)» genera `tema-accesible-powerbi.json` con solo `name` y
  `dataColors` (Blob y `<a download>`, sin permiso de descargas) y dice
  «Tema de Power BI descargado»; debajo, la nota de importación. Un solo
  estado temporal a la vez (otro clic lo reinicia), anuncios por
  `aria-live`, errores en la región de estado del bloque («No se pudo
  copiar…», «No se pudo descargar el tema»). El mismo bloque, titulado
  «Paleta accesible», acompaña a la tarjeta «Cumple» con la paleta
  original, también con una sola serie y en familias secuenciales. El
  reporte PDF no cambia.
- Banco de pruebas `Pruebas/panel-cumple/`: dashboard de ventas en SVG a
  mano (cuatro indicadores de texto, barras agrupadas por trimestre,
  líneas mensuales de 2,5 px con marcadores y dona con `padAngle` sin
  bordes) con cuatro series de Okabe-Ito que superan 3:1 sobre blanco
  (`#0072B2`, `#D55E00`, `#009E73`, `#CC79A7`), textos `#1F2933` y
  `#4B5563`, ejes y bordes `#767676` (4,54:1), tabla con los datos y
  `dashboard.png` capturado a 1440 px: el caso que cumple bajo las tres
  deficiencias (ΔE00 mínimo 12,26 protanopía, 16,11 deuteranopía, 10,50
  tritanopía con Brettel), también por captura con contraste aproximado.
- Pruebas unitarias del contraste aproximado en
  `herramientas/pruebas-extraccion.mjs` (fila por serie muestreada,
  fondo de canvas y de captura, fondo de respaldo, filas propias
  intactas).
- Simulación por captura cuando el filtro CSS no puede actuar: documento
  de imagen, imagen que ocupa la mayor parte de la vista, canvas WebGL
  (como el lienzo de Figma) o página que queda en blanco al filtrar
  (comprobado con una captura reducida antes y después). Se captura la
  pestaña con la capa oculta, se simula píxel a píxel con las mismas
  matrices de Machado (2009) y el método de Brettel (1997) del cálculo
  (`src/core/simulacion/imagen.js`) y se muestra como capa fija encima
  de la página, sin capturar el puntero; al cambiar la severidad se
  recalcula desde la captura guardada y al desplazarse, redimensionar o
  soltar el puntero se vuelve a capturar con retardo. El panel lo indica
  con «Simulación por captura: la vista simulada es una imagen de la
  pantalla y se actualiza al desplazarte.». La extracción en esos casos
  usa la captura (nivel 3) con el aviso de evaluación aproximada.
- Paneles `panel-imagen` (dashboard como PNG, también abrible como
  documento de imagen) y `panel-webgl` (barras en un canvas WebGL) del
  banco de pruebas.
- `herramientas/pruebas-simulacion.mjs`: pruebas unitarias de la
  simulación píxel a píxel (idéntica a las funciones color a color),
  de la detección de captura uniforme y de la decisión de modo.
- Módulos `src/core/extraccion/cuantizacion.js` (cuantización cromática)
  y `src/core/extraccion/marcos.js` (composición de marcos y recortes a
  capturar), con `mergeFramePalettes` y `mergeContrastResults`.
- Panel `Pruebas/panel-plataforma` del banco de pruebas: armazón de
  plataforma de informes, más de 5000 nodos, aviso solo para lectores,
  iframe aislado, iframe con canvas y shadow root.
- `herramientas/pruebas-extraccion.mjs`: pruebas unitarias de recorte,
  umbral cromático, plegado por adyacencia y composición de marcos.
- Avisos nuevos en el panel y en el reporte: recorte del recorrido y
  resultado sin colores de datos; la línea de extracción indica el
  número de marcos leídos.

### Cambiado
- Mensajes de estado por tarjeta y sin restos: los de la simulación
  (aplicada o retirada, cambio de página) van en «Simulación» y los de la
  evaluación (terminada o descartada, previsualización, reporte, errores)
  en «Evaluación de accesibilidad»; solo hay uno a la vez y cualquier
  acción del usuario (cambiar deficiencia, mover la severidad, evaluar,
  previsualizar, cambiar familia, series o umbral, exportar, limpiar) lo
  borra antes, así nunca queda un mensaje que contradiga el estado
  actual. «Limpiar todo» deja «Todo limpio: simulación, previsualización
  y evaluación retiradas.», que desaparece con la siguiente acción. Tras
  evaluar se oculta también «Analiza los gráficos visibles de esta
  pestaña:» junto con la lista; al limpiar vuelven los dos.
- Evaluación separada de la simulación según la guía del panel
  (`Pruebas/Docs/maqueta-panel.html`, actualizada con la tarjeta de
  evaluación, el selector con lista, los botones y la tarjeta «Cumple»;
  en Docs solo quedan la guía del panel y la del reporte). La tarjeta
  «Simulación» conserva el selector, la
  severidad y su nota, y pierde el botón. Debajo, la tarjeta nueva
  «Evaluación de accesibilidad» explica qué se analiza («Analiza los
  gráficos visibles de esta pestaña:») con una lista de definiciones de
  tres filas separadas por líneas `--borde-suave`, rótulo semibold en una
  columna de 118 px que crece si hace falta y descripción secundaria
  (Contraste: WCAG 2.1, criterios 1.4.3 y 1.4.11; Distinguibilidad:
  series bajo la deficiencia elegida (ΔE00); Recomendación: paleta
  accesible equivalente), el botón principal «Evaluar accesibilidad»
  (antes «Extraer paleta y evaluar») y los mensajes de estado debajo.
  Tras evaluar, el botón pasa a «Volver a evaluar» en tonal y la lista se
  oculta; al limpiar vuelve el estado inicial. Encabezado, «Limpiar todo»
  y los resultados no cambian.
- Controles del panel según la maqueta de controles (integrada en la guía
  del panel). Los
  selectores «Tipo de deficiencia» y «Familia de la paleta» son campos
  rellenos: fondo `--campo` con borde de 1 px `--borde` en reposo (≥ 3:1
  sobre la tarjeta y sobre el campo en los dos temas), radio 10 px, alto
  mínimo 58 px, rótulo de 12 px y valor de 16 px semibold dentro, flecha
  en un tramo de 48 px separado por una línea `--borde`; borde `--texto`
  en hover; borde `--acento`, fondo `--superficie` y anillo de 4 px al
  22 % con el foco o la lista abierta. El select nativo sigue
  cubriendo el campo (teclado y lector de pantalla iguales); con el
  select personalizable de Chrome (`appearance: base-select`, dentro de
  `@supports`) la lista lleva fondo `--superficie`, borde, radio 10 px,
  padding 6 px y sombra `--sombra-lista`, opciones con radio 7 px, nombre
  de 15 px semibold y descripción de 12,5 px (`data-desc`), hover
  `--superficie-2` y elegida `--acento-suave` con el nombre en
  `--acento`; «Ninguna» va primero, separada por `<hr>`. Sin soporte
  queda la lista nativa.
- Botones de 48 px, radio 10 px y texto de 15 px semibold, sin iconos:
  principal (`--acento`, hover `--acento-hover`) para «Evaluar
  accesibilidad» y «Exportar PDF»; tonal (`--acento-suave`, texto `--acento`,
  hover `--acento-suave-hover`) para «Volver a evaluar»; borrar (texto
  `--borrar` con borde al 45 %, hover `--borrar-suave`) para «Limpiar
  todo». Foco con teclado: outline de 2 px `--acento` a 3 px; al
  presionar bajan 1 px salvo con `prefers-reduced-motion`. Pie en
  proporción 1,5 a 1; sin evaluación «Limpiar todo» ocupa todo el ancho.
- Tokens nuevos en los dos temas: `--campo` (#EEF2F7 / #26344B),
  `--acento-hover` (#0F4C86 / #A8C7FA), `--acento-suave` (#E3EDF8 /
  #22385A), `--acento-suave-hover` (#D2E2F3 / #2A4570), `--borrar`
  (#9A2D10 / #F4A48A), `--borrar-suave` (#FBE9E3 / #3A2526) y
  `--sombra-lista`. El rojo del botón no sustituye a `--error`: como
  token global dejaba aviso y error a ΔE00 6,2 bajo deuteranopía, por
  debajo del mínimo 10 que exige la auditoría para las pastillas. La
  auditoría de tokens comprueba también los pares nuevos y el rastreo
  admite el anillo del campo, la sombra de la lista y la línea de la
  flecha.
- Cuando la paleta considerada ya cumple, el panel y la sección 5 del
  reporte muestran la tarjeta «Cumple» de la maqueta de cierre en
  lugar del título «Cumple sin reemplazo» y su párrafo: sello «Cumple»,
  contexto «<deficiencia> (severidad máxima)», título «Tu paleta ya es
  accesible», texto con el número de series, bandas en visión típica y
  bajo la deficiencia a severidad máxima (mismo orden), tres cifras
  (ΔE00 mínimo, fallos de contraste entre series, series evaluadas) y
  la regla «Par más cercano frente al umbral» de 0 a 50 con la zona
  bajo el umbral, el punto en el ΔE00 mínimo y el margen en texto. Solo
  tokens, `role="status"` en la tarjeta, regla con
  `aria-hidden`, sin iconos ni animaciones, contraste ≥ 4,5:1 en texto y
  ≥ 3:1 en gráficos en los dos temas. El aviso de incumplimientos fuera
  del conjunto de series sigue debajo sin cambios; el caso con
  reemplazo no cambia.
- Tres tokens semánticos de éxito en los dos temas, `--exito-fondo`,
  `--exito-borde` y `--exito-texto` (#F3FAF3, #CFE6D0 y #2D6830 en
  claro; #1A3029, #2C4A3F y #9AD6A4 en Azul noche), también en la copia
  del tema claro del reporte. La tarjeta «Cumple» los usa: fondo y
  borde de la tarjeta, sello (fondo en texto de éxito y letra en fondo
  de éxito), cifras, margen, pista y punto de la regla (con anillo en
  fondo de éxito) y borde de las cajas de cifras. Título, texto,
  bandas, zona del umbral y el aviso de abajo no cambian.
- «Limpiar todo» pasa de enlace subrayado a botón neutro: fondo de
  superficie, borde `--borde` (≥ 3:1 sobre el fondo del panel) y texto
  en el color normal (≥ 4,5:1), misma altura y radio que «Exportar PDF»
  y «Volver a evaluar», con hover y foco visibles y los mismos tokens en
  Azul noche. Sin evaluación ocupa todo el ancho; con evaluación va
  junto a «Exportar PDF», los dos del mismo tamaño.
- `minimum_chrome_version` pasa a 117 (`chrome.runtime.getFrameId`).
- Se retira el permiso `activeTab`: era redundante con
  `host_permissions <all_urls>`, que ya cubre la inyección del content
  script y la captura de la pestaña en cualquier sitio.
- Permiso `webNavigation` para detectar los cambios de página.
- `web_accessible_resources` incluye `cuantizacion.js`, `brettel.js` e
  `imagen.js`.

## [0.6.10] — 2026-10-02

### Corregido
- El panel se abre al primer clic en el icono también con el service
  worker en frío (tras recargar la extensión o abrir el navegador):
  `sidePanel.open()` se llama en el mismo gesto que `setOptions()`, sin
  esperar entre ambas. Antes el `await` consumía el gesto, Chrome
  rechazaba la apertura y solo prosperaba el segundo clic.

### Cambiado
- Las casillas de series consideradas aparecen abiertas al evaluar, como
  el resto de secciones; el botón pasa a «Ocultar» y el plegado se
  recuerda solo en esa pestaña hasta volver a evaluar.

## [0.6.9] — 2026-10-01

### Cambiado
- Depuración final sin cambio de comportamiento: la evaluación de los
  seis paneles del banco de pruebas y el reporte generado son idénticos
  a los de la 0.6.8 (comparación automática de los datos del reporte,
  del texto del panel y del HTML del reporte de panel-svg).
- Comentarios: cada archivo abre con una cabecera que dice qué hace, qué
  requisito cubre (RF01 a RF08) y en qué sprint o versión nació; las
  funciones exportadas llevan JSDoc; las decisiones no obvias conservan
  su justificación y las citas; se retiran las referencias al historial
  (sprints, frentes, bloques, iteraciones) y las mayúsculas de énfasis.
- `README.md` describe la estructura real: panel, página del reporte,
  estilos, herramientas y las dos maquetas de diseño de `Pruebas/Docs`,
  que llevan ahora una nota de cabecera como documentos de diseño fuera
  del paquete.

### Eliminado
- Mensajes `EXTRACT_PALETTE` y `PING` del service worker y del content
  script (restos del flujo del popup), la importación sin uso de
  `rgbToHex` en `algoritmo.js`, los tokens de espaciado `--esp-1` a
  `--esp-6` sin uso y la clase `lista-rc` sin regla. Dejan de exportarse
  `relativeLuminance`, `xyzToLab`, `labToXyz`, `SHARMA_TEST_PAIRS` y
  `resolveContainer`, que solo se usan dentro de su módulo.
- Archivo vacío `muestras-azul-noche-b.mjs` de la raíz y maquetas
  antiguas de `Pruebas/Docs` (copias, borradores, captura y PDF de
  impresión): quedan solo `maqueta-panel.html` y `maqueta-reporte.html`.

## [0.6.8] — 2026-10-01

### Cambiado
- Selector de tema nuevo (de `docs/maqueta-panel.html`): píldora con dos
  opciones del mismo ancho, sol «Claro» y luna «Oscuro», y una pieza con
  borde `--borde` y sombra muy suave que se desliza a la elegida en
  180 ms (sin movimiento bajo `prefers-reduced-motion`). La elegida va
  en acento y semibold; la otra en texto secundario. Los dos SVG de
  trazo son la única excepción a la regla de no usar iconos; el nombre
  accesible de cada opción sigue siendo su palabra y cada una lleva
  `title`.
- La cabecera queda siempre en una línea: consulta de contenedor sobre
  la cabecera (≤ 420 px solo sol y luna, las palabras pasan a solo
  lector), el título no se parte y la línea de estado se recorta con
  puntos suspensivos. A 320 px ya no se parte en dos líneas.
- El selector refleja el tema efectivo (el del sistema mientras no se
  elige); la lógica de guardado y aplicación antes del primer pintado
  no cambia.
- Herramienta `herramientas/rastreo-ui.mjs`: rastreo estático que admite
  solo esos dos SVG y la sombra de la pieza del selector.

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

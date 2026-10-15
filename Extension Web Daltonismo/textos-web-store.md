# Textos para la ficha de la Chrome Web Store

Material preparado para el formulario de publicación (versión 1.0.0).
Este archivo no forma parte del paquete: `herramientas/empaquetar.mjs`
lo excluye.

## Nombre

Evaluador cromático de dashboards

## Descripción breve (máx. 132 caracteres)

Evalúa la accesibilidad cromática de dashboards: simula daltonismo, mide
contraste WCAG y propone paletas. 100 % local.

## Descripción larga

¿Tu dashboard se entiende igual con daltonismo? Esta extensión lo
comprueba desde un panel lateral, sin salir de la pestaña:

- Extrae la paleta de colores real del dashboard en todos sus marcos:
  estilos del DOM y SVG, muestreo de gráficos canvas y, como respaldo,
  captura recortada de las zonas de gráficos que no se pueden leer
  (visuales WebGL, marcos de otro origen, dashboards como imagen).
- Simula cómo percibe esos colores una persona con protanopía o
  deuteranopía (matrices de Machado, con severidad graduable) o con
  tritanopía (método de Brettel), sobre la propia página y en el panel.
  Cuando el filtro no puede actuar (Figma, lienzos WebGL, imágenes), la
  simulación se hace por captura y se actualiza al desplazarte.
- Evalúa el contraste según WCAG 2.1 (criterios 1.4.3 y 1.4.11) y la
  distinguibilidad entre series de datos con la diferencia de color
  CIEDE2000 bajo la deficiencia elegida, con el umbral a la vista.
- Si la paleta ya es accesible lo dice con una tarjeta «Cumple»; si no,
  propone una paleta equivalente a partir de esquemas acreditados
  (Okabe-Ito, Paul Tol, IBM Carbon, Viridis, Cividis y una escala
  monocroma), validada a severidad máxima, y permite previsualizarla
  sobre la página sin recargar. Si el catálogo no alcanza, recomienda
  rediseñar.
- Exporta un reporte en PDF con la paleta, los pares de contraste, la
  matriz de distinguibilidad y la recomendación.
- Panel accesible: contraste verificado, operable con teclado y lector
  de pantalla, con tema claro y tema oscuro «Azul noche».

Todo el cálculo ocurre en tu equipo: la extensión no envía ni recibe
ningún dato por la red, no usa servicios externos y no requiere cuenta.
Las capturas de pantalla se procesan en memoria y se descartan.

Prototipo académico desarrollado como trabajo de titulación.

## Declaración de propósito único

La extensión tiene un único propósito: evaluar la accesibilidad
cromática de la página visible (extraer su paleta, simular deficiencias
de percepción del color, medir contraste y distinguibilidad y proponer
paletas alternativas). Todas sus funciones sirven a ese propósito.

## Justificación de permisos

- **scripting**: inyecta el content script en los marcos de la pestaña
  evaluada para leer los estilos declarados y los píxeles de los canvas,
  aplicar y retirar el filtro de simulación, la capa de simulación por
  captura y la previsualización, siempre a petición del usuario desde el
  panel.
- **sidePanel**: la interfaz de la extensión es un panel lateral que se
  habilita por pestaña al hacer clic en el icono.
- **storage**: guarda la evaluación y el estado de interfaz de cada
  pestaña (almacenamiento de sesión, se borra al cerrar), la última
  configuración de simulación usada como sugerencia y el tema elegido
  (almacenamiento local). Ningún dato sale del navegador.
- **webNavigation**: detecta cuándo la pestaña evaluada cambia de página
  (recarga, ruta de aplicación o fragmento) para retirar la simulación,
  descartar la evaluación anterior y avisarlo en el panel.
- **Acceso amplio a sitios (`<all_urls>`)**: el panel permanece abierto
  mientras el usuario navega y evalúa dashboards en cualquier sitio
  (incluidas herramientas internas y archivos locales); el acceso cubre
  la inyección en todos los marcos y la captura de la pestaña, por lo
  que no se pide `activeTab`. A las páginas **se accede sin
  transmitir**: los estilos, los píxeles y las capturas se procesan
  localmente y nunca se envían a ningún servidor.

## Declaración de privacidad

La extensión no recopila, almacena de forma persistente, transmite ni
vende ningún dato personal ni de navegación. No contiene analítica, no
llama a ningún servicio externo y funciona íntegramente sin conexión.
Las capturas de pantalla que usa como respaldo se procesan en memoria y
se descartan al terminar; no se guardan en disco ni en el almacenamiento
del navegador. Lo único que guarda el navegador es la evaluación de cada
pestaña (hasta que la pestaña se cierra), la última configuración de
simulación elegida y el tema del panel, en el almacenamiento local del
propio navegador.

## Categoría sugerida

Herramientas para desarrolladores / Accesibilidad.

## Idioma

Español.

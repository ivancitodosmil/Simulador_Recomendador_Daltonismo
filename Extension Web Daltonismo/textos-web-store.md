# Textos para la ficha de la Chrome Web Store

Material preparado para el formulario de publicación (versión 0.6.0).
Este archivo no forma parte del paquete: `herramientas/empaquetar.mjs`
lo excluye.

## Nombre

Evaluador cromático de dashboards

## Descripción breve (máx. 132 caracteres)

Evalúa la accesibilidad cromática de dashboards: simula daltonismo, mide
contraste WCAG y propone paletas. 100 % local.

## Descripción larga

¿Tu dashboard se entiende igual con daltonismo? Esta extensión lo
comprueba sin salir de la pestaña:

- Extrae la paleta de colores real del dashboard (estilos del DOM y SVG,
  muestreo de gráficos canvas y, como respaldo, captura de la pestaña).
- Simula cómo percibe esos colores una persona con protanopía,
  deuteranopía (matrices de Machado, con severidad graduable) o
  tritanopía (método de Brettel), tanto en el panel como sobre la propia
  página.
- Evalúa el contraste según WCAG 2.1 (criterios 1.4.3 y 1.4.11) y la
  distinguibilidad entre series de datos con la diferencia de color
  CIEDE2000.
- Propone una paleta alternativa accesible a partir de esquemas
  acreditados (Okabe-Ito, Paul Tol, IBM, Viridis/Cividis) y permite
  previsualizarla sobre la página sin recargar.
- Exporta un reporte HTML autocontenido con toda la evaluación.

Todo el cálculo ocurre en tu equipo: la extensión no envía ni recibe
ningún dato por la red, no usa servicios externos y no requiere cuenta.

Prototipo académico desarrollado como trabajo de titulación.

## Declaración de propósito único

La extensión tiene un único propósito: evaluar la accesibilidad
cromática de la página visible (extraer su paleta, simular deficiencias
de percepción del color, medir contraste y distinguibilidad y proponer
paletas alternativas). Todas sus funciones sirven a ese propósito.

## Justificación de permisos

- **activeTab**: concede acceso puntual a la pestaña sobre la que el
  usuario hace clic, que es la que se evalúa.
- **scripting**: inyecta el content script que lee los estilos
  declarados y aplica/retira el filtro de simulación y la
  previsualización, siempre a petición del usuario desde el panel.
- **sidePanel**: la interfaz de la extensión es un panel lateral que se
  habilita por pestaña al hacer clic en el icono.
- **storage**: guarda la evaluación y el estado de interfaz de cada
  pestaña (almacenamiento de sesión, se borra al cerrar) y la última
  configuración de simulación usada (almacenamiento local). Ningún dato
  sale del navegador.
- **Acceso amplio a sitios (`<all_urls>`)**: el panel permanece abierto
  mientras el usuario navega y evalúa dashboards en cualquier sitio
  (incluidas herramientas internas y archivos locales); con solo
  activeTab, el acceso caduca al recargar y el flujo del panel
  persistente se rompe. A las páginas **se accede sin transmitir**: los
  estilos y los píxeles leídos se procesan localmente y nunca se envían
  a ningún servidor.

## Declaración de privacidad

La extensión no recopila, almacena de forma persistente, transmite ni
vende ningún dato personal ni de navegación. No contiene analítica, no
llama a ningún servicio externo y funciona íntegramente sin conexión.
Lo único que guarda el navegador es la evaluación de cada pestaña
(hasta que la pestaña se cierra) y la última configuración de simulación
elegida, en el almacenamiento local del propio navegador.

## Categoría sugerida

Herramientas para desarrolladores / Accesibilidad.

## Idioma

Español.

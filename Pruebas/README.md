# Banco de pruebas — Accesibilidad cromática de dashboards

Diez paneles web autónomos (HTML + CSS + JavaScript vanilla, sin frameworks ni bundler) construidos a propósito para validar una extensión de navegador que evalúa la accesibilidad cromática de dashboards. Los datos son ficticios pero verosímiles: ventas de 2025 por región, en miles de euros (los mensuales del panel secuencial suman exactamente los trimestrales del resto).

## Paneles

| Panel | Escenario que cubre | Estrategia de extracción que ejercita |
|---|---|---|
| [panel-svg](panel-svg/) | Barras, líneas, área y pastel como SVG con D3; colores en variables CSS y en atributos `fill`/`stroke` | Extracción de primer nivel: lectura del DOM y del CSS computado, con resolución de `var()` |
| [panel-canvas](panel-canvas/) | Los mismos cuatro gráficos con Chart.js sobre `canvas`, sin un solo color declarado en CSS | Muestreo de píxeles del canvas |
| [panel-categorias](panel-categorias/) | Barras apiladas con 18 categorías y leyenda de 18 colores | Caso en que ningún catálogo de paletas accesibles alcanza (Okabe-Ito: 8, Tol bright: 7, Tol muted: 9): obliga a generar o extender una paleta |
| [panel-contraste](panel-contraste/) | Fallos deliberados: texto `#9E9E9E`/`#BDBDBD`/`#C8C8C8` sobre blanco, ejes de bajo contraste y dos pares de series adyacentes con luminancia casi idéntica (1.08:1) | Verificación del cálculo de contraste: cada par lleva su ratio WCAG esperado anotado como comentario HTML en `panel-contraste/index.html` |
| [panel-conforme](panel-conforme/) | Paleta Okabe-Ito completa: se distingue bajo las tres deficiencias, pero el amarillo, el naranja y el celeste no llegan a 3:1 contra blanco (WCAG 1.4.11). El caso que cumple todo es panel-cumple. | Contraste aproximado de las series de canvas contra el fondo del canvas: la extensión propone un reemplazo por las tres series bajo 3:1 |
| [panel-secuencial](panel-secuencial/) | Mapa de calor SVG/D3 (regiones × meses) con rampa semáforo `#C62828`→`#FBC02D`→`#2E7D32` por escalones (`NUM_CLASES = 3` en `datos.js`, ampliable a 5 para el capítulo 5) | Detección de rampa secuencial hostil al daltonismo (fills, nivel 1) y propuesta de rampa perceptualmente uniforme |
| [panel-plataforma](panel-plataforma/) | Armazón de una plataforma de informes: barra superior con buscador e iconos `svg use`, navegación lateral, más de 5000 nodos de «actividad reciente» antes del informe, un aviso solo para lectores (1×1 px con `clip`), y el dashboard repartido entre un iframe aislado (`sandbox`, barras SVG `#2E75B6`/`#9DC3E6`), un iframe con canvas (doce líneas de 1,5 px, cada una por debajo del 1 % de la pantalla) y un donut en un shadow root; banda de título `#02487A` | Inyección en todos los marcos, recorrido de shadow roots, zonas de gráficos antes que el armazón (tope de nodos), exclusión de interfaz, iconos y ocultos, captura recortada del iframe que no admite scripts y umbral relativo a los píxeles cromáticos |
| [panel-imagen](panel-imagen/) | El dashboard es `dashboard.png` (captura del panel-svg) incrustado en la página; el PNG también puede abrirse directamente como documento de imagen | Extracción por captura recortada a la imagen (nivel 3, evaluación aproximada) y simulación por captura: capa fija simulada píxel a píxel |
| [panel-webgl](panel-webgl/) | Barras 2025 y 2024 dibujadas en un canvas WebGL que ocupa casi toda la vista, como el lienzo de Figma | El filtro CSS no transforma el canvas: simulación por captura y paleta por captura del canvas ilegible |
| [panel-cumple](panel-cumple/) | Dashboard de ventas en SVG a mano: cuatro indicadores de texto, barras agrupadas por trimestre, líneas mensuales con marcadores y dona con `padAngle`, con cuatro series de Okabe-Ito (`#0072B2`, `#D55E00`, `#009E73`, `#CC79A7`: 5,19 · 3,87 · 3,42 · 3,06:1 sobre blanco) y ejes `#767676` (4,54:1); `dashboard.png` es la misma página capturada a 1440 px | El caso que cumple: tarjeta «Cumple» bajo las tres deficiencias sin incumplimientos de contraste (SVG, evaluación exacta) y también por captura con el contraste aproximado (abrir el PNG directamente) |

## Estructura

```
Pruebas/
├── index.html          ← índice con enlaces a los diez paneles
├── README.md
├── lib/
│   ├── chart.umd.min.js   (Chart.js 4.4.9, local)
│   └── d3.v7.min.js       (D3 7.9.0, local)
└── panel-*/
    ├── index.html      ← título visible del escenario + render de los gráficos
    ├── estilos.css
    └── datos.js        ← datos ficticios y colores usados por el panel
```

## Uso

Abrir `Pruebas/index.html` (o el `index.html` de cualquier panel) directamente en el navegador; no hay dependencias de red ni pasos de build. Si se prefiere un servidor local: `python -m http.server` desde esta carpeta.

## Notas de verificación

- Los ratios de contraste anotados en `panel-contraste/index.html` están calculados con la fórmula de WCAG 2.1 (luminancia relativa sRGB, `(L1+0.05)/(L2+0.05)`).
- La paleta Okabe-Ito de `panel-conforme` está verificada como segura para daltonismo: separación CVD mínima entre pares adyacentes ΔE 15.8 (OKLab×100, simulación deután), muy por encima del umbral 8.
- `panel-canvas/estilos.css` no contiene ninguna declaración de color (ni `color`, ni `background`, ni `border`): cualquier color que la extensión encuentre ahí procede necesariamente del muestreo del canvas.

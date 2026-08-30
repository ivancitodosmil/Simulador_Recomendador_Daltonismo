# Banco de pruebas — Accesibilidad cromática de dashboards

Cinco paneles web autónomos (HTML + CSS + JavaScript vanilla, sin frameworks ni bundler) construidos a propósito para validar una extensión de navegador que evalúa la accesibilidad cromática de dashboards. Los datos son ficticios pero verosímiles: ventas trimestrales de 2025 por región, en miles de euros.

## Paneles

| Panel | Escenario que cubre | Estrategia de extracción que ejercita |
|---|---|---|
| [panel-svg](panel-svg/) | Barras, líneas, área y pastel como SVG con D3; colores en variables CSS y en atributos `fill`/`stroke` | Extracción de primer nivel: lectura del DOM y del CSS computado, con resolución de `var()` |
| [panel-canvas](panel-canvas/) | Los mismos cuatro gráficos con Chart.js sobre `canvas`, sin un solo color declarado en CSS | Muestreo de píxeles del canvas |
| [panel-categorias](panel-categorias/) | Barras apiladas con 18 categorías y leyenda de 18 colores | Caso en que ningún catálogo de paletas accesibles alcanza (Okabe-Ito: 8, Tol bright: 7, Tol muted: 9): obliga a generar o extender una paleta |
| [panel-contraste](panel-contraste/) | Fallos deliberados: texto `#9E9E9E`/`#BDBDBD`/`#C8C8C8` sobre blanco, ejes de bajo contraste y dos pares de series adyacentes con luminancia casi idéntica (1.08:1) | Verificación del cálculo de contraste: cada par lleva su ratio WCAG esperado anotado como comentario HTML en `panel-contraste/index.html` |
| [panel-conforme](panel-conforme/) | Paleta Okabe-Ito (8 colores) sobre fondo blanco con texto `#1A1A1A` (17.40:1) | Informe de cumplimiento: la extensión no debe proponer ningún reemplazo |

## Estructura

```
Pruebas/
├── index.html          ← índice con enlaces a los cinco paneles
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

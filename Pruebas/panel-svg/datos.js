// Datos ficticios pero verosimiles: ventas trimestrales por region (miles de euros), ejercicio 2025.
const TRIMESTRES = ["T1 2025", "T2 2025", "T3 2025", "T4 2025"];

const REGIONES = [
  "Andalucía",
  "Cataluña",
  "Comunidad de Madrid",
  "Comunidad Valenciana",
  "Galicia",
  "País Vasco"
];

// Nombres abreviados para ejes y leyendas.
const NOMBRES_CORTOS = ["Andalucía", "Cataluña", "Madrid", "C. Valenciana", "Galicia", "P. Vasco"];

const VENTAS = {
  "Andalucía":            [312, 348, 295, 391],
  "Cataluña":             [428, 455, 401, 512],
  "Comunidad de Madrid":  [389, 402, 376, 468],
  "Comunidad Valenciana": [247, 259, 301, 288],
  "Galicia":              [176, 168, 190, 205],
  "País Vasco":           [214, 230, 198, 246]
};

// Paleta de series: se aplica desde D3 mediante atributos fill y stroke.
// Los colores de barras y area se declaran aparte, como variables CSS en estilos.css.
const PALETA = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948"];

// Agregados derivados.
const TOTAL_TRIMESTRE = TRIMESTRES.map((t, i) =>
  REGIONES.reduce((suma, r) => suma + VENTAS[r][i], 0)
);
const TOTAL_REGION = REGIONES.map(r => VENTAS[r].reduce((a, b) => a + b, 0));

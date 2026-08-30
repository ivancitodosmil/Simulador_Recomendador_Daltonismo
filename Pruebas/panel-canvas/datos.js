// Datos ficticios pero verosimiles: ventas trimestrales por region (miles de euros), ejercicio 2025.
// En este panel TODOS los colores viven aqui (JavaScript) y acaban pintados en canvas:
// no hay ninguna declaracion de color en estilos.css.
const TRIMESTRES = ["T1 2025", "T2 2025", "T3 2025", "T4 2025"];

const REGIONES = [
  "Andalucía",
  "Cataluña",
  "Comunidad de Madrid",
  "Comunidad Valenciana",
  "Galicia",
  "País Vasco"
];

const NOMBRES_CORTOS = ["Andalucía", "Cataluña", "Madrid", "C. Valenciana", "Galicia", "P. Vasco"];

const VENTAS = {
  "Andalucía":            [312, 348, 295, 391],
  "Cataluña":             [428, 455, 401, 512],
  "Comunidad de Madrid":  [389, 402, 376, 468],
  "Comunidad Valenciana": [247, 259, 301, 288],
  "Galicia":              [176, 168, 190, 205],
  "País Vasco":           [214, 230, 198, 246]
};

// Paleta clasica de dashboard, definida solo en JS.
const PALETA = ["#36A2EB", "#FF6384", "#4BC0C0", "#FF9F40", "#9966FF", "#FFCD56"];
const COLOR_AREA_BORDE = "#4BC0C0";
const COLOR_AREA_RELLENO = "rgba(75, 192, 192, 0.35)";
const COLOR_TEXTO_GRAFICOS = "#3A3F45";

const TOTAL_TRIMESTRE = TRIMESTRES.map((t, i) =>
  REGIONES.reduce((suma, r) => suma + VENTAS[r][i], 0)
);
const TOTAL_REGION = REGIONES.map(r => VENTAS[r].reduce((a, b) => a + b, 0));

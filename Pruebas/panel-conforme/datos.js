// Datos ficticios pero verosimiles: ventas trimestrales por region (miles de euros), ejercicio 2025.
// Ocho regiones para ejercitar los ocho colores de la paleta Okabe-Ito.
const TRIMESTRES = ["T1 2025", "T2 2025", "T3 2025", "T4 2025"];

const REGIONES = [
  "Andalucía",
  "Cataluña",
  "Comunidad de Madrid",
  "Comunidad Valenciana",
  "Galicia",
  "País Vasco",
  "Castilla y León",
  "Canarias"
];

const NOMBRES_CORTOS = [
  "Andalucía", "Cataluña", "Madrid", "C. Valenciana",
  "Galicia", "P. Vasco", "C. y León", "Canarias"
];

const VENTAS = {
  "Andalucía":            [312, 348, 295, 391],
  "Cataluña":             [428, 455, 401, 512],
  "Comunidad de Madrid":  [389, 402, 376, 468],
  "Comunidad Valenciana": [247, 259, 301, 288],
  "Galicia":              [176, 168, 190, 205],
  "País Vasco":           [214, 230, 198, 246],
  "Castilla y León":      [158, 171, 164, 189],
  "Canarias":             [132, 140, 155, 161]
};

// Paleta Okabe-Ito en su orden canonico: segura para deficiencias de vision
// cromatica (protanopia, deuteranopia y tritanopia).
const OKABE_ITO = [
  "#000000", // negro
  "#E69F00", // naranja
  "#56B4E9", // celeste
  "#009E73", // verde azulado
  "#F0E442", // amarillo
  "#0072B2", // azul
  "#D55E00", // bermellon
  "#CC79A7"  // purpura rosado
];

const NOMBRES_COLOR = [
  "negro", "naranja", "celeste", "verde azulado",
  "amarillo", "azul", "bermellón", "púrpura rosado"
];

const TOTAL_REGION = REGIONES.map(r => VENTAS[r].reduce((a, b) => a + b, 0));

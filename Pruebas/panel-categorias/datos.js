// Datos ficticios pero verosimiles: ventas trimestrales por categoria de producto
// (miles de euros), ejercicio 2025. Dieciocho categorias simultaneas: mas series
// que colores tiene cualquier catalogo de paletas accesibles publicado
// (Okabe-Ito: 8 · Paul Tol bright: 7 · Paul Tol muted: 9 · IBM Carbon: 5).
const TRIMESTRES = ["T1 2025", "T2 2025", "T3 2025", "T4 2025"];

const CATEGORIAS = [
  "Electrónica",
  "Alimentación",
  "Moda",
  "Hogar",
  "Deportes",
  "Juguetería",
  "Librería",
  "Música",
  "Jardinería",
  "Automoción",
  "Salud",
  "Belleza",
  "Mascotas",
  "Papelería",
  "Ferretería",
  "Informática",
  "Telefonía",
  "Electrodomésticos"
];

const VENTAS_CATEGORIA = {
  "Electrónica":       [86, 92, 81, 104],
  "Alimentación":      [110, 108, 115, 121],
  "Moda":              [74, 69, 88, 95],
  "Hogar":             [61, 66, 59, 72],
  "Deportes":          [45, 52, 48, 50],
  "Juguetería":        [22, 18, 25, 64],
  "Librería":          [30, 28, 33, 41],
  "Música":            [15, 14, 17, 21],
  "Jardinería":        [38, 49, 31, 18],
  "Automoción":        [55, 58, 52, 57],
  "Salud":             [42, 44, 47, 49],
  "Belleza":           [36, 39, 35, 52],
  "Mascotas":          [27, 29, 31, 33],
  "Papelería":         [19, 17, 34, 26],
  "Ferretería":        [33, 37, 35, 30],
  "Informática":       [68, 64, 71, 83],
  "Telefonía":         [59, 55, 62, 88],
  "Electrodomésticos": [48, 53, 46, 66]
};

// Dieciocho colores distintos: obliga a la extension a generar o extender una
// paleta accesible en lugar de sustituirla por un catalogo cerrado.
const PALETA18 = [
  "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD", "#8C564B",
  "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF", "#3366CC", "#DC3912",
  "#FF9900", "#109618", "#990099", "#0099C6", "#DD4477", "#66AA00"
];

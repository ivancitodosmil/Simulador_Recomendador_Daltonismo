// Datos ficticios pero verosimiles para el panel «plataforma»: ventas 2025 y 2024
// por region (barras en un iframe aislado), evolucion mensual por pais (lineas finas
// en un canvas dentro de un iframe) y cuota por canal (donut en un shadow root).
const REGIONES_PLATAFORMA = ["Andalucía", "Cataluña", "Madrid", "C. Valenciana", "Galicia", "P. Vasco"];
const VENTAS_2025_REGION = [1346, 1796, 1635, 1095, 739, 888];
const VENTAS_2024_REGION = [1210, 1655, 1502, 1010, 702, 815];

// Dos azules de barras: el claro es un tinte del oscuro (caso real de Power BI).
// Distintos de la banda del título (#02487A) para que no se agrupen con ella.
const COLOR_BARRA_2025 = "#2E75B6";
const COLOR_BARRA_2024 = "#9DC3E6";

// Doce paises con lineas de 1,5 px: cada una ocupa mucho menos del 1 % de la pantalla.
const PAISES = ["España", "Portugal", "Francia", "Italia", "Alemania", "Países Bajos",
  "Bélgica", "Irlanda", "Polonia", "Suecia", "Dinamarca", "Austria"];
const COLORES_LINEAS = ["#F28E2B", "#FF9DA7", "#8C8C8C", "#2CA02C", "#9467BD", "#17BECF",
  "#D62728", "#BCBD22", "#1F77B4", "#8C564B", "#E377C2", "#FFB000"];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Serie mensual determinista por pais (sin aleatoriedad: la captura debe ser reproducible).
function serieMensual(indice) {
  const base = 40 + indice * 9;
  return MESES.map((m, j) => Math.round(base + 18 * Math.sin((j + indice) / 1.7) + 6 * Math.cos(j * (indice + 1) / 3)));
}

// Cuota por canal para el donut del shadow root.
const CANALES = ["Tienda", "Web", "Distribuidor", "Mayorista", "Otros"];
const CUOTA_CANAL = [38, 27, 17, 12, 6];
const COLORES_CANAL = ["#E15759", "#59A14F", "#EDC948", "#76B7B2", "#B07AA1"];

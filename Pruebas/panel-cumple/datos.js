// Datos ficticios pero verosimiles: ventas mensuales de 2025 por region
// (miles de euros). Los trimestres y los totales se derivan de los meses.
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const TRIMESTRES = ["T1 2025", "T2 2025", "T3 2025", "T4 2025"];
const REGIONES = ["Norte", "Sur", "Este", "Oeste"];

// Paleta de series: cuatro colores de Okabe-Ito que superan 3:1 sobre
// blanco (5,19 · 3,87 · 3,42 · 3,06) y se distinguen bajo las tres
// deficiencias (par mas cercano por encima de dE00 10).
const PALETA = ["#0072B2", "#D55E00", "#009E73", "#CC79A7"];

const VENTAS_MES = {
  Norte: [132, 139, 149, 151, 156, 158, 160, 149, 181, 176, 180, 184],
  Sur:   [121, 128, 131, 134, 140, 136, 129, 127, 139, 146, 151, 153],
  Este:  [ 94,  98, 103, 104, 108, 108, 112, 115, 123, 125, 129, 131],
  Oeste: [ 77,  80,  83,  85,  88,  89,  91,  94,  95,  99, 104, 107]
};

// Trimestres: suma de cada tres meses.
const VENTAS_TRIMESTRE = {};
for (const region of REGIONES) {
  VENTAS_TRIMESTRE[region] = TRIMESTRES.map((t, i) =>
    VENTAS_MES[region].slice(i * 3, i * 3 + 3).reduce((a, b) => a + b, 0));
}

// Totales anuales por region y total general.
const TOTAL_REGION = REGIONES.map((region) => VENTAS_MES[region].reduce((a, b) => a + b, 0));
const TOTAL_ANUAL = TOTAL_REGION.reduce((a, b) => a + b, 0);

// Indicadores del encabezado (solo texto).
const INDICADORES = [
  { valor: TOTAL_ANUAL.toLocaleString("es-ES") + " k€", etiqueta: "Ventas 2025" },
  { valor: "12.480", etiqueta: "Pedidos" },
  { valor: "480 €", etiqueta: "Ticket medio" },
  { valor: "31,4 %", etiqueta: "Margen bruto" }
];

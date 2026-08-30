// Datos ficticios pero verosimiles: ventas trimestrales por region (miles de euros), ejercicio 2025.
// Los colores de este panel estan elegidos para FALLAR: los ratios esperados de cada par
// estan documentados como comentario HTML en index.html.
const TRIMESTRES = ["T1 2025", "T2 2025", "T3 2025", "T4 2025"];

const VENTAS = {
  "Andalucía":           [312, 348, 295, 391],
  "Cataluña":            [428, 455, 401, 512],
  "Comunidad de Madrid": [389, 402, 376, 468],
  "País Vasco":          [214, 230, 198, 246]
};

// Series adyacentes de luminancia casi identica (ratio esperado 1.08:1 en ambos pares).
const COLOR_LINEA_CATALUNA = "#E67E22";
const COLOR_LINEA_MADRID = "#6AB04C";
const COLOR_BARRA_ANDALUCIA = "#4DB6AC";
const COLOR_BARRA_PAIS_VASCO = "#85BC50";

// Texto de ejes y leyendas de bajo contraste dentro del canvas.
const COLOR_TEXTO_EJES = "#C8C8C8";
const COLOR_TEXTO_LEYENDA = "#BDBDBD";
const COLOR_REJILLA = "#F1F1F1";

// ------------------------------------------------------------------
// Sprint 4 · Catálogo local de esquemas de color accesibles, conforme
// a la Tabla 16 de la tesis. Estructura estática embebida: sin
// consultas externas (regla del proyecto: sin red en runtime).
// Cada entrada registra los colores del esquema, su familia
// (cualitativa o secuencial), el número de colores y los tipos de
// deficiencia para los que existe evidencia publicada.
// Las rampas secuenciales se almacenan SIEMPRE de oscuro a claro.
// ------------------------------------------------------------------

export const PALETTE_CATALOG = [
  {
    id: "okabe-ito",
    name: "Okabe-Ito",
    family: "qualitative",
    size: 8,
    // Acreditada para los tres tipos: diseñada específicamente para
    // dicromatopsias (Okabe e Ito, 2008).
    accreditedFor: ["protanopia", "deuteranopia", "tritanopia"],
    colors: ["#000000", "#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"]
  },
  {
    id: "tol-bright",
    name: "Tol bright",
    family: "qualitative",
    size: 7,
    accreditedFor: ["protanopia", "deuteranopia", "tritanopia"],
    colors: ["#4477AA", "#EE6677", "#228833", "#CCBB44", "#66CCEE", "#AA3377", "#BBBBBB"]
  },
  {
    id: "tol-muted",
    name: "Tol muted",
    family: "qualitative",
    size: 9,
    accreditedFor: ["protanopia", "deuteranopia", "tritanopia"],
    colors: ["#CC6677", "#332288", "#DDCC77", "#117733", "#88CCEE", "#882255", "#44AA99", "#999933", "#AA4499"]
  },
  {
    id: "tol-12",
    name: "Tol cualitativo de 12",
    family: "qualitative",
    size: 12,
    // Variante mayor de los esquemas cualitativos de Tol (nota técnica
    // SRON): es el tope de capacidad del catálogo cualitativo.
    accreditedFor: ["protanopia", "deuteranopia", "tritanopia"],
    colors: [
      "#332288", "#6699CC", "#88CCEE", "#44AA99", "#117733", "#999933",
      "#DDCC77", "#661100", "#CC6677", "#AA4466", "#882255", "#AA4499"
    ]
  },
  {
    id: "ibm-carbon",
    name: "Carbon (IBM)",
    family: "qualitative",
    size: 5,
    // Acreditada solo para protanopia y deuteranopia: su verificación
    // publicada mide contraste de luminancia y no separación de tono,
    // insuficiente como evidencia para tritanopia.
    accreditedFor: ["protanopia", "deuteranopia"],
    colors: ["#648FFF", "#785EF0", "#DC267F", "#FE6100", "#FFB000"]
  },
  {
    id: "viridis",
    name: "Viridis",
    family: "sequential",
    size: 10,
    accreditedFor: ["protanopia", "deuteranopia"],
    colors: [
      "#440154", "#482878", "#3E4A89", "#31688E", "#26828E",
      "#1F9E89", "#35B779", "#6DCD59", "#B4DE2C", "#FDE725"
    ]
  },
  {
    id: "cividis",
    name: "Cividis",
    family: "sequential",
    size: 10,
    accreditedFor: ["protanopia", "deuteranopia"],
    colors: [
      "#00204D", "#00336F", "#39486B", "#575D6D", "#707173",
      "#8A8779", "#A69D75", "#C4B56C", "#E4CF5B", "#FFEA46"
    ]
  },
  {
    id: "monochrome-luminance",
    name: "Escala monocroma de luminancia",
    family: "sequential",
    size: 9,
    // Acreditada para los tres tipos: codifica la magnitud únicamente
    // con la claridad, que las tres dicromatopsias preservan.
    accreditedFor: ["protanopia", "deuteranopia", "tritanopia"],
    colors: [
      "#191919", "#343434", "#4F4F4F", "#6A6A6A", "#858585",
      "#A0A0A0", "#BBBBBB", "#D4D4D4", "#ECECEC"
    ]
  }
];

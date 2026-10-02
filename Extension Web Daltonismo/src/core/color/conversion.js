// ------------------------------------------------------------------
// Conversión de color propia, sin librerías externas: sRGB ↔ RGB lineal
// ↔ XYZ (D65) ↔ CIELAB, más la lectura de los formatos de color que
// devuelve getComputedStyle y del hexadecimal. Base de la extracción
// (RF01), la simulación (RF02) y las métricas (RF04, RF05). Sprint 1.
// ------------------------------------------------------------------

// Matrices sRGB ↔ XYZ con blanco de referencia D65 (IEC 61966-2-1).
const SRGB_TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.0721750],
  [0.0193339, 0.1191920, 0.9503041]
];

const XYZ_TO_SRGB = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.9692660, 1.8760108, 0.0415560],
  [0.0556434, -0.2040259, 1.0572252]
];

// Blanco de referencia D65 normalizado (Y = 1).
const WHITE_D65 = { x: 0.95047, y: 1.0, z: 1.08883 };

// Constantes de la función f(t) de CIELAB (CIE 15:2004).
const EPSILON = 216 / 24389; // (6/29)^3
const KAPPA = 24389 / 27;    // (29/3)^3

/**
 * Linealización gamma explícita de un canal sRGB en [0, 1].
 * El umbral 0.04045 es el del estándar sRGB; WCAG usa 0.03928 y ese
 * cálculo vive en contraste.js con la fórmula literal del estándar.
 */
export function srgbToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** Compresión gamma inversa: canal lineal en [0, 1] a sRGB en [0, 1]. */
export function linearToSrgb(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
}

/** sRGB con canales en [0, 255] a XYZ con Y en [0, 1]. */
export function rgbToXyz({ r, g, b }) {
  const linear = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
  return {
    x: SRGB_TO_XYZ[0][0] * linear[0] + SRGB_TO_XYZ[0][1] * linear[1] + SRGB_TO_XYZ[0][2] * linear[2],
    y: SRGB_TO_XYZ[1][0] * linear[0] + SRGB_TO_XYZ[1][1] * linear[1] + SRGB_TO_XYZ[1][2] * linear[2],
    z: SRGB_TO_XYZ[2][0] * linear[0] + SRGB_TO_XYZ[2][1] * linear[1] + SRGB_TO_XYZ[2][2] * linear[2]
  };
}

/** XYZ (D65) a CIELAB. */
function xyzToLab({ x, y, z }) {
  const f = (t) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  const fx = f(x / WHITE_D65.x);
  const fy = f(y / WHITE_D65.y);
  const fz = f(z / WHITE_D65.z);
  return { l: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIELAB a XYZ (D65), inversa exacta de xyzToLab. */
function labToXyz({ l, a, b }) {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const fInverse = (t) => {
    const cubed = t * t * t;
    return cubed > EPSILON ? cubed : (116 * t - 16) / KAPPA;
  };
  return {
    x: fInverse(fx) * WHITE_D65.x,
    y: fInverse(fy) * WHITE_D65.y,
    z: fInverse(fz) * WHITE_D65.z
  };
}

/** XYZ a sRGB con canales en [0, 255], recortando el gamut al rango válido. */
export function xyzToRgb({ x, y, z }) {
  const linear = [
    XYZ_TO_SRGB[0][0] * x + XYZ_TO_SRGB[0][1] * y + XYZ_TO_SRGB[0][2] * z,
    XYZ_TO_SRGB[1][0] * x + XYZ_TO_SRGB[1][1] * y + XYZ_TO_SRGB[1][2] * z,
    XYZ_TO_SRGB[2][0] * x + XYZ_TO_SRGB[2][1] * y + XYZ_TO_SRGB[2][2] * z
  ];
  const toChannel = (v) => Math.round(Math.min(1, Math.max(0, linearToSrgb(v))) * 255);
  return { r: toChannel(linear[0]), g: toChannel(linear[1]), b: toChannel(linear[2]) };
}

/** Conversión directa sRGB [0,255] → CIELAB. */
export function rgbToLab(rgb) {
  return xyzToLab(rgbToXyz(rgb));
}

/** Conversión directa CIELAB → sRGB [0,255], inversa de rgbToLab (la ejercitan las pruebas). */
export function labToRgb(lab) {
  return xyzToRgb(labToXyz(lab));
}

/** {r,g,b} en [0,255] a "#RRGGBB" en mayúsculas. */
export function rgbToHex({ r, g, b }) {
  const toHex = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0");
  return ("#" + toHex(r) + toHex(g) + toHex(b)).toUpperCase();
}

/** "#RGB", "#RRGGBB" o "#RRGGBBAA" a {r,g,b,a}; null si no es hexadecimal válido. */
export function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  const clean = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
      a: 1
    };
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
      a: clean.length === 8 ? parseInt(clean.slice(6, 8), 16) / 255 : 1
    };
  }
  return null;
}

/**
 * Analiza los formatos de color que entrega getComputedStyle o el marcado:
 * hexadecimal, rgb()/rgba() (con comas o espacios), color(srgb ...) y la
 * palabra clave transparent. Devuelve {r,g,b,a} o null si no es un color
 * (por ejemplo "none" o "url(#degradado)").
 */
export function parseCssColor(text) {
  if (typeof text !== "string") return null;
  const value = text.trim().toLowerCase();
  if (!value || value === "none" || value.startsWith("url(")) return null;
  if (value === "transparent") return { r: 0, g: 0, b: 0, a: 0 };

  if (value.startsWith("#")) return hexToRgb(value);

  const rgbMatch = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgbMatch) {
    const parts = rgbMatch[1].replace(/[,/]/g, " ").split(/\s+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      const clamp255 = (v) => Math.min(255, Math.max(0, Math.round(v)));
      return {
        r: clamp255(parts[0]),
        g: clamp255(parts[1]),
        b: clamp255(parts[2]),
        a: parts.length > 3 && Number.isFinite(parts[3]) ? Math.min(1, Math.max(0, parts[3])) : 1
      };
    }
    return null;
  }

  // Serialización moderna de Chrome para algunos valores: color(srgb r g b [/ a])
  const srgbMatch = value.match(/^color\(srgb\s+([^)]+)\)$/);
  if (srgbMatch) {
    const parts = srgbMatch[1].replace(/\//g, " ").split(/\s+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      const toChannel = (v) => Math.min(255, Math.max(0, Math.round(v * 255)));
      return {
        r: toChannel(parts[0]),
        g: toChannel(parts[1]),
        b: toChannel(parts[2]),
        a: parts.length > 3 && Number.isFinite(parts[3]) ? Math.min(1, Math.max(0, parts[3])) : 1
      };
    }
  }
  return null;
}

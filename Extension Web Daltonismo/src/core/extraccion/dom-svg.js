// ------------------------------------------------------------------
// Nivel 1 de extracción (RF01): colores declarados en el DOM y en SVG.
// Localiza primero las zonas de gráficos (svg con marcas, canvas e
// iframes de visualización, también dentro de shadow roots abiertos),
// las recorre antes que el resto de la página con getComputedStyle y
// registra color, background-color, border-color, fill y stroke con la
// referencia al elemento. Sprint 1; zonas, shadow DOM, elementos
// ocultos e interfaz de la aplicación excluida desde la versión 1.0.0.
// ------------------------------------------------------------------

import { parseCssColor } from "../color/conversion.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// Límite de nodos visitados por marco para respetar el presupuesto de
// tiempo (< 3 s). Las zonas de gráficos se recorren primero, así que al
// agotarse el tope solo queda fuera el armazón de la aplicación.
const MAX_NODES = 5000;

// Un svg con un lado menor que esto es un icono, no un gráfico.
const MIN_SVG_SIDE = 32;
// Área mínima (px²) para considerar un canvas como gráfico y no como icono.
const MIN_CANVAS_AREA = 4096;
// Lado mínimo de un iframe para tratarlo como visualización incrustada.
const MIN_IFRAME_SIDE = 64;
// Lado mínimo de una imagen para tratarla como posible dashboard en imagen
// (captura de pantalla incrustada, documento de imagen abierto en Chrome).
const MIN_IMAGE_SIDE = 150;

// Armazón de la aplicación (navegación, barra superior, buscadores,
// menús, barras de herramientas, controles de formulario) y nodos sin
// representación visual: se excluyen del recorrido con sus descendientes.
// Los header/footer del propio dashboard no se excluyen: contienen
// títulos y notas que sí deben evaluarse; la barra superior de una
// plataforma se reconoce por role="banner".
const EXCLUDED_SELECTOR = [
  "nav",
  "[role=\"navigation\"]",
  "[role=\"banner\"]",
  "[role=\"menu\"]",
  "[role=\"menubar\"]",
  "[role=\"toolbar\"]",
  "[role=\"search\"]",
  "[role=\"searchbox\"]",
  "[role=\"combobox\"]",
  "[role=\"dialog\"]",
  "[role=\"tooltip\"]",
  "input",
  "select",
  "textarea",
  "[contenteditable=\"true\"]",
  "[aria-hidden=\"true\"]",
  "script",
  "style",
  "noscript",
  "template",
  "defs",
  "symbol",
  "mask",
  "clipPath"
].join(", ");

// Contextos en los que un svg es un icono: botones, menús, pestañas y barras.
const ICON_CONTEXT_SELECTOR = [
  "button",
  "[role=\"button\"]",
  "[role=\"menuitem\"]",
  "[role=\"tab\"]",
  "[role=\"tablist\"]",
  "[role=\"toolbar\"]",
  "[role=\"menu\"]",
  "[role=\"menubar\"]",
  "nav",
  "[role=\"navigation\"]",
  "[role=\"banner\"]"
].join(", ");

// Marcas gráficas que convierten un svg en gráfico.
const MARK_SELECTOR = "rect, path, circle, ellipse, line, polyline, polygon";

// Contenedores que una aplicación reserva para un gráfico (por clase o
// id) y que están vacíos: sin marcas, sin canvas ni imagen y con poco
// texto («Todavía no hay datos para mostrar»). Cuentan como zona vacía
// para distinguir «gráficos sin datos» de «página sin gráficos».
const CHART_CONTAINER_SELECTOR = ["chart", "graf", "graph", "plot", "visual", "viz", "diagram"]
  .flatMap((word) => ["[class*=\"" + word + "\" i]", "[id*=\"" + word + "\" i]"])
  .join(", ");
const EMPTY_CONTAINER_CONTENT = "svg " + MARK_SELECTOR.split(", ").join(", svg ") + ", canvas, img, iframe";
const MIN_CONTAINER_WIDTH = 120;
const MIN_CONTAINER_HEIGHT = 80;
const MAX_EMPTY_CONTAINER_TEXT = 160;

// Candidatos a contenedor del dashboard, del más específico al más genérico.
// Si ninguno existe se recorre body: las zonas de gráficos van primero y
// la lista de exclusión deja fuera el armazón de la aplicación.
const CONTAINER_CANDIDATES = ["[data-dashboard]", "#dashboard", ".dashboard", "[data-reporte]"];

/** ¿Tiene el elemento nodos de texto directos con contenido? */
function hasDirectText(element) {
  for (const node of element.childNodes) {
    if (node.nodeType === 3 && node.textContent.trim()) return true;
  }
  return false;
}

/** Padre en el árbol compuesto: el elemento padre o el anfitrión del shadow root. */
function composedParent(node) {
  if (node.parentElement) return node.parentElement;
  const root = node.parentNode;
  return root && root.host ? root.host : null;
}

/** ¿Está node dentro de ancestor, atravesando shadow roots? */
function isInside(node, ancestor) {
  let current = node;
  while (current) {
    if (current === ancestor) return true;
    current = composedParent(current);
  }
  return false;
}

/** Rectángulo serializable relativo a la ventana del marco. */
function rectOf(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

/**
 * Razón por la que un elemento no se lee, o null si es visible. Cubre lo
 * que no pinta (display, visibility, opacity, tamaño cero), el patrón de
 * texto «solo para lectores de pantalla» (1×1 px recortado con clip o
 * clip-path), lo colocado fuera de la página y las regiones en vivo sin
 * texto visible. Solo se aplica a HTML: una línea SVG horizontal mide 0
 * de alto y se descarta por tamaño, igual que antes.
 */
function hiddenReason(element, style, rect, view) {
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return "oculto";
  if (parseFloat(style.opacity) === 0) return "oculto";
  if (rect.width < 1 || rect.height < 1) return "sin-tamano";
  if (element.namespaceURI === SVG_NAMESPACE) return null;

  const clipped =
    (style.clip && style.clip !== "auto" && style.overflow === "hidden") ||
    /inset\((?:50|100)%\)/.test(style.clipPath || "");
  if ((rect.width <= 1 && rect.height <= 1) || (clipped && (rect.width <= 1 || rect.height <= 1))) return "solo-lector";

  const docEl = view.document.documentElement;
  const pageWidth = Math.max(docEl.scrollWidth, view.innerWidth);
  const pageHeight = Math.max(docEl.scrollHeight, view.innerHeight);
  if (rect.right + view.scrollX <= 0 || rect.bottom + view.scrollY <= 0) return "fuera";
  if (rect.left + view.scrollX >= pageWidth || rect.top + view.scrollY >= pageHeight) return "fuera";

  const role = element.getAttribute("role") || "";
  if ((element.hasAttribute("aria-live") || /^(status|alert|log)$/.test(role)) && !(element.textContent || "").trim()) {
    return "vivo-vacio";
  }
  return null;
}

/** ¿Algún ancestro (hasta el contenedor) está excluido o no pinta? */
function blockedByAncestor(element, container, view) {
  let current = composedParent(element);
  while (current && current !== container) {
    if (current.nodeType === 1) {
      if (current.matches(EXCLUDED_SELECTOR)) return true;
      const style = view.getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) return true;
    }
    current = composedParent(current);
  }
  return false;
}

/**
 * Recoge svg, canvas, iframes e imágenes del documento y de sus shadow
 * roots abiertos, y clasifica cada uno: «svg» o «canvas» (zona de
 * gráfico), «iframe» (visualización incrustada, la extrae su propio marco
 * o la captura recortada), «imagen» (una imagen grande: solo la captura
 * puede leer sus colores) o «icono» (svg pequeño, con <use> o dentro de
 * un botón, menú o barra; no se lee en absoluto).
 */
function collectZones(root, view, zones, visitedRoots) {
  if (visitedRoots.has(root)) return;
  visitedRoots.add(root);
  for (const element of root.querySelectorAll("svg, canvas, iframe, img")) {
    const tag = element.tagName.toLowerCase();
    if (tag === "img") {
      const rect = element.getBoundingClientRect();
      if (rect.width >= MIN_IMAGE_SIDE && rect.height >= MIN_IMAGE_SIDE) {
        zones.push({ element, kind: "imagen", rect: rectOf(element) });
      }
    } else if (tag === "svg") {
      // Un svg anidado lo cubre el exterior.
      const parent = composedParent(element);
      if (parent && parent.closest && parent.closest("svg")) continue;
      const rect = element.getBoundingClientRect();
      const isIcon =
        rect.width < MIN_SVG_SIDE || rect.height < MIN_SVG_SIDE ||
        element.querySelector("use") !== null ||
        (element.closest(ICON_CONTEXT_SELECTOR) !== null);
      if (isIcon) {
        zones.push({ element, kind: "icono", rect: rectOf(element) });
        continue;
      }
      // Un svg grande sin marcas es un gráfico sin datos dibujados: se
      // cuenta como zona vacía y no se recorre como gráfico.
      zones.push({ element, kind: element.querySelector(MARK_SELECTOR) ? "svg" : "svg-vacio", rect: rectOf(element) });
    } else if (tag === "canvas") {
      const rect = element.getBoundingClientRect();
      if (rect.width * rect.height >= MIN_CANVAS_AREA && element.width > 0 && element.height > 0) {
        zones.push({ element, kind: "canvas", rect: rectOf(element) });
      }
    } else {
      const rect = element.getBoundingClientRect();
      if (rect.width >= MIN_IFRAME_SIDE && rect.height >= MIN_IFRAME_SIDE) {
        // Caja de contenido del iframe: origen de coordenadas de su documento.
        zones.push({
          element,
          kind: "iframe",
          rect: {
            x: rect.x + element.clientLeft,
            y: rect.y + element.clientTop,
            width: element.clientWidth || rect.width,
            height: element.clientHeight || rect.height
          }
        });
      }
    }
  }
  for (const host of root.querySelectorAll("*")) {
    if (host.shadowRoot) collectZones(host.shadowRoot, view, zones, visitedRoots);
  }
}

/**
 * Contenedores de gráfico vacíos del documento y de sus shadow roots:
 * elementos con clase o id de gráfico, visibles y de tamaño útil, sin
 * marcas svg, canvas, imagen ni iframe dentro y con poco texto. Un
 * contenedor dentro de otro ya contado no se cuenta dos veces.
 */
function collectEmptyChartContainers(root, view, container, out, visitedRoots) {
  if (visitedRoots.has(root)) return;
  visitedRoots.add(root);
  let candidates;
  try {
    candidates = root.querySelectorAll(CHART_CONTAINER_SELECTOR);
  } catch (error) {
    candidates = [];
  }
  for (const element of candidates) {
    if (!isInside(element, container) || element.namespaceURI === SVG_NAMESPACE) continue;
    if (out.some((counted) => isInside(element, counted))) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < MIN_CONTAINER_WIDTH || rect.height < MIN_CONTAINER_HEIGHT) continue;
    const style = view.getComputedStyle(element);
    if (hiddenReason(element, style, rect, view) || blockedByAncestor(element, container, view)) continue;
    if (element.querySelector(EMPTY_CONTAINER_CONTENT)) continue;
    if ((element.textContent || "").trim().length > MAX_EMPTY_CONTAINER_TEXT) continue;
    out.push(element);
  }
  for (const host of root.querySelectorAll("*")) {
    if (host.shadowRoot) collectEmptyChartContainers(host.shadowRoot, view, container, out, visitedRoots);
  }
}

/** Ancestro común más profundo de varios elementos (árbol compuesto). */
function commonAncestor(elements) {
  if (!elements.length) return null;
  const chain = (element) => {
    const out = [];
    let current = element;
    while (current) {
      out.unshift(current);
      current = composedParent(current);
    }
    return out;
  };
  const chains = elements.map(chain);
  let common = null;
  for (let depth = 0; ; depth += 1) {
    const candidate = chains[0][depth];
    if (!candidate || !chains.every((c) => c[depth] === candidate)) break;
    common = candidate;
  }
  return common;
}

/** Registra una observación si el valor es un color con alfa apreciable. */
function pushObservation(state, element, cssColor, property, role) {
  const parsed = parseCssColor(cssColor);
  if (!parsed || parsed.a < 0.05) return;
  state.observations.push({ cssColor, property, role, element, inChart: state.inChart });
}

/** Extrae los colores relevantes de un elemento ya validado como visible. */
function recordColors(element, style, state) {
  if (element.namespaceURI === SVG_NAMESPACE) {
    // En SVG el texto también se pinta con fill; se distingue por etiqueta.
    const tag = element.tagName.toLowerCase();
    const role = tag === "text" || tag === "tspan" ? "text" : "series";
    pushObservation(state, element, style.fill, "fill", role);
    if (parseFloat(style.strokeWidth) > 0) {
      pushObservation(state, element, style.stroke, "stroke", role);
    }
    return;
  }
  if (hasDirectText(element)) {
    pushObservation(state, element, style.color, "color", "text");
  }
  pushObservation(state, element, style.backgroundColor, "background-color", "background");
  if (parseFloat(style.borderTopWidth) > 0) {
    pushObservation(state, element, style.borderTopColor, "border-color", "border");
  }
}

/**
 * Recorrido en profundidad que descarta subárboles excluidos, iconos u
 * ocultos, entra en los shadow roots abiertos y no repite lo ya visitado.
 */
function walk(element, state) {
  if (state.done.has(element)) return;
  if (state.visited >= MAX_NODES) {
    state.truncated = true;
    return;
  }
  state.done.add(element);
  if (state.icons.has(element)) return;
  if (element.matches(EXCLUDED_SELECTOR)) return;

  const style = state.view.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  if (hiddenReason(element, style, rect, state.view)) return;

  state.visited += 1;
  recordColors(element, style, state);

  for (const child of element.children) {
    walk(child, state);
  }
  if (element.shadowRoot) {
    for (const child of element.shadowRoot.children) {
      walk(child, state);
    }
  }
}

/**
 * Garantiza que la paleta incluya un color de fondo de página: si body y
 * html son transparentes, el navegador pinta blanco por defecto.
 */
function ensureBackgroundObservation(state, doc) {
  const hasBackground = state.observations.some((obs) => obs.role === "background");
  if (hasBackground) return;
  for (const element of [doc.body, doc.documentElement]) {
    const parsed = parseCssColor(state.view.getComputedStyle(element).backgroundColor);
    if (parsed && parsed.a > 0.05) return;
  }
  state.observations.push({
    cssColor: "#FFFFFF",
    property: "background-color",
    role: "background",
    element: doc.body,
    inChart: false,
    synthetic: true // fondo por defecto del navegador, no declarado
  });
}

/**
 * Punto de entrada del nivel 1. Devuelve las observaciones crudas (con
 * referencia a elemento y marca inChart), el contenedor empleado, las
 * zonas de gráficos e iframes con su rectángulo, la geometría del marco
 * y las métricas del recorrido (visited, truncated).
 */
export function extractDomSvgColors(doc = document) {
  const view = doc.defaultView;
  const container =
    CONTAINER_CANDIDATES.map((selector) => doc.querySelector(selector)).find(Boolean) || doc.body;

  const allZones = [];
  collectZones(doc, view, allZones, new Set());
  const insideZones = allZones.filter((zone) => isInside(zone.element, container));
  // Los svg sin marcas solo se cuentan: no son gráficos que recorrer.
  const emptySvgs = insideZones.filter((zone) => zone.kind === "svg-vacio").length;
  const zones = insideZones.filter((zone) => zone.kind !== "svg-vacio");
  const icons = new Set(zones.filter((zone) => zone.kind === "icono").map((zone) => zone.element));
  const chartZones = zones.filter(
    (zone) => (zone.kind === "svg" || zone.kind === "canvas") && !blockedByAncestor(zone.element, container, view)
  );
  const emptyContainers = [];
  collectEmptyChartContainers(doc, view, container, emptyContainers, new Set());

  const state = {
    observations: [],
    visited: 0,
    truncated: false,
    icons,
    done: new Set(),
    inChart: false,
    view
  };

  // 1. Zonas de gráficos: siempre antes de agotar el presupuesto.
  state.inChart = true;
  for (const zone of chartZones) walk(zone.element, state);
  state.inChart = false;

  // 2. Hacia fuera desde la región que comparten todas las zonas (también
  //    los iframes): primero lo que rodea a los gráficos (títulos,
  //    leyendas, fichas), después cada nivel superior y, al final, el
  //    resto del contenedor. Así el presupuesto se gasta cerca del
  //    dashboard y, si se agota, lo que falta es el armazón más lejano.
  const region = commonAncestor(zones.filter((zone) => zone.kind !== "icono").map((zone) => zone.element));
  let node = region;
  while (node && isInside(node, container)) {
    walk(node, state);
    if (node === container) break;
    node = composedParent(node);
  }
  walk(container, state);

  ensureBackgroundObservation(state, doc);

  return {
    observations: state.observations,
    container,
    containerTag: container === doc.body ? "body" : container.tagName.toLowerCase(),
    chartRegion: region,
    zones: zones.filter((zone) => zone.kind !== "icono"),
    // Zonas de gráfico sin datos dibujados: svg grandes sin marcas y
    // contenedores de gráfico vacíos (los canvas en blanco los cuenta el
    // nivel 2).
    emptyZones: emptySvgs + emptyContainers.length,
    frame: {
      width: view.innerWidth,
      height: view.innerHeight,
      scrollX: view.scrollX,
      scrollY: view.scrollY,
      dpr: view.devicePixelRatio || 1
    },
    visited: state.visited,
    truncated: state.truncated
  };
}

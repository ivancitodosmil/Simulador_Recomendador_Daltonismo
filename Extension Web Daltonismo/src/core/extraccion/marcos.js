// ------------------------------------------------------------------
// Composición de los marcos (RF01): sitúa en las coordenadas del marco
// superior las zonas de gráficos que informa cada frame, identifica los
// iframes en los que no se pudo inyectar el content script y decide qué
// recortes debe capturar el nivel 3. Funciones puras sin chrome.* ni DOM:
// las usa el service worker y las ejercitan las pruebas unitarias.
// Versión 1.0.0.
// ------------------------------------------------------------------

// Lado mínimo de un recorte para que merezca una captura.
const MIN_REGION_SIDE = 8;

/** Desplaza un rectángulo por el origen de su marco. */
function shift(rect, offset) {
  return { x: rect.x + offset.x, y: rect.y + offset.y, width: rect.width, height: rect.height };
}

/** Busca, entre los marcos aún sin situar, el único cuya URL coincide con src. */
function matchByUrl(src, frames, offsets) {
  if (!src) return null;
  const matches = [];
  for (const [frameId, response] of frames) {
    if (offsets.has(frameId)) continue;
    if (response.url === src) matches.push(frameId);
  }
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Compone las respuestas de RUN_EVALUATION de cada marco:
 *   frameResults: [{ frameId, response }], donde response trae ok, url,
 *   frame {width, height}, zones [{kind, rect, childFrameId, src}] y
 *   failedCanvasRects.
 * Devuelve los marcos válidos, el origen de cada uno respecto al marco
 * superior, las zonas de gráficos y los iframes en coordenadas del marco
 * superior (con injected: si su marco respondió) y los canvas ilegibles.
 */
export function composeFrames(frameResults) {
  const frames = new Map();
  for (const result of frameResults || []) {
    if (result && result.response && result.response.ok) frames.set(result.frameId, result.response);
  }
  const offsets = new Map([[0, { x: 0, y: 0 }]]);
  const iframeZones = [];
  const queue = [0];
  while (queue.length) {
    const frameId = queue.shift();
    const response = frames.get(frameId);
    const offset = offsets.get(frameId);
    if (!response || !offset) continue;
    for (const zone of response.zones || []) {
      if (zone.kind !== "iframe") continue;
      const child =
        typeof zone.childFrameId === "number" && zone.childFrameId >= 0
          ? zone.childFrameId
          : matchByUrl(zone.src, frames, offsets);
      const rect = shift(zone.rect, offset);
      const injected = child !== null && frames.has(child);
      iframeZones.push({ parentFrameId: frameId, childFrameId: child, rect, injected });
      if (injected && !offsets.has(child)) {
        offsets.set(child, { x: rect.x, y: rect.y });
        queue.push(child);
      }
    }
  }

  const chartZones = [];
  const imageZones = [];
  const failedCanvasRects = [];
  for (const [frameId, response] of frames) {
    const offset = offsets.get(frameId);
    if (!offset) continue; // marco sin posición conocida: sus colores se fusionan igual
    for (const zone of response.zones || []) {
      if (zone.kind === "iframe") continue;
      if (zone.kind === "imagen") imageZones.push({ frameId, rect: shift(zone.rect, offset) });
      else chartZones.push({ frameId, kind: zone.kind, rect: shift(zone.rect, offset) });
    }
    for (const rect of response.failedCanvasRects || []) failedCanvasRects.push(shift(rect, offset));
  }

  const top = frames.get(0);
  return {
    frames,
    offsets,
    chartZones,
    imageZones,
    iframeZones,
    failedCanvasRects,
    viewport: top && top.frame ? { width: top.frame.width, height: top.frame.height } : null,
    unplacedFrames: [...frames.keys()].filter((frameId) => !offsets.has(frameId))
  };
}

/** Acota un rectángulo al área visible. */
function clipToViewport(rect, viewport) {
  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  return { x, y, width: Math.min(viewport.width, rect.x + rect.width) - x, height: Math.min(viewport.height, rect.y + rect.height) - y };
}

/**
 * Recortes que debe capturar el nivel 3, en CSS px del marco superior:
 * los iframes sin inyectar, los canvas ilegibles y, si los niveles 1 y 2
 * no encontraron ningún color cromático de datos, todas las zonas de
 * gráficos y las imágenes grandes (un dashboard en imagen solo se lee
 * así). Toda el área visible solo si el nivel 1 no leyó ningún color
 * (paletteEmpty): sin zonas de gráficos no hay nada que capturar, y
 * capturar la página entera convertiría en «series» los colores de la
 * marca en textos y botones. Los recortes fuera del área visible no
 * pueden capturarse y se descartan.
 */
export function captureRegions(composition, { hasChromaticData = false, paletteEmpty = false } = {}) {
  const regions = [];
  for (const zone of composition.iframeZones) if (!zone.injected) regions.push(zone.rect);
  for (const rect of composition.failedCanvasRects) regions.push(rect);
  if (!hasChromaticData) {
    for (const zone of composition.chartZones) regions.push(zone.rect);
    for (const zone of composition.imageZones || []) regions.push(zone.rect);
  }

  const viewport = composition.viewport;
  const visible = (viewport ? regions.map((rect) => clipToViewport(rect, viewport)) : regions)
    .filter((rect) => rect.width >= MIN_REGION_SIDE && rect.height >= MIN_REGION_SIDE);
  // Dos recortes iguales (zona informada dos veces) se capturan una sola vez.
  const unique = [];
  for (const rect of visible) {
    if (!unique.some((other) => other.x === rect.x && other.y === rect.y && other.width === rect.width && other.height === rect.height)) {
      unique.push(rect);
    }
  }
  if (unique.length) return unique;
  return paletteEmpty && viewport ? [{ x: 0, y: 0, width: viewport.width, height: viewport.height }] : [];
}

// ------------------------------------------------------------------
// Plantilla del reporte (RF08): reproduce la maqueta
// Pruebas/Docs/maqueta-reporte.html con los datos reales de la
// evaluación. Concepto de la maqueta: informe de laboratorio, portada
// con la paleta del dashboard como protagonista y cuerpo sobrio.
// Sprint 5; rediseñada en la versión 0.6.5.
//
// Exporta las piezas que usa la página propia del reporte
// (src/ui/reporte/):
//   REPORT_STYLES        hoja de estilos (pantalla + impresión A4)
//   renderReportBody     HTML del artículo <article class="hoja">
//   reportTitle          «Reporte cromático · nombre o dominio · fecha»
// y renderReportHtml, el documento completo autocontenido, que la
// extensión no usa y conservan los arneses de prueba.
//
// El bloque :root es una copia literal del tema claro de
// src/ui/estilos/tokens.css (el reporte siempre va en claro); la
// auditoría de tokens verifica que no diverja. Sin iconos ni glifos,
// sin barras laterales de color, sin sombras, sin mayúsculas espaciadas;
// los veredictos son pastillas con la palabra (con borde al imprimir) y
// los avisos, párrafos que empiezan por «Aviso». Sin referencias
// externas: ni imágenes, ni fuentes, ni enlaces (RNF02).
// ------------------------------------------------------------------

const SIMULATION_LABELS = {
  none: "sin simulación",
  protanopia: "protanopía",
  deuteranopia: "deuteranopía",
  tritanopia: "tritanopía"
};

const LEVEL_LABELS = {
  "dom-svg": "Nivel 1 · DOM y SVG",
  "canvas": "Nivel 2 · Muestreo de canvas",
  "capture": "Nivel 3 · Captura de pestaña"
};

const ROLE_LABELS = {
  background: "fondo",
  text: "texto",
  series: "serie",
  border: "borde"
};

// Escala de los pares conflictivos (ΔE00 de 0 a 50) y de contraste
// (logarítmica de 1:1 a 21:1, el rango posible de la fórmula WCAG).
const SCALE_MAX = 50;
const CONTRAST_MAX = 21;
const CONTRAST_AXIS = [1, 3, 4.5, 7, 21];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function num(value, decimals = 2) {
  return Number(value).toFixed(decimals).replace(".", ",");
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Posición porcentual en la escala logarítmica de contraste. */
function contrastPosition(ratio) {
  const clamped = Math.min(Math.max(ratio, 1), CONTRAST_MAX);
  return (Math.log(clamped) / Math.log(CONTRAST_MAX)) * 100;
}

/** Posición porcentual en la escala lineal ΔE00 0–50. */
function deltaPosition(value) {
  return (Math.min(Math.max(value, 0), SCALE_MAX) / SCALE_MAX) * 100;
}

/** Nombre corto del dashboard: título de la pestaña o dominio de la dirección. */
function dashboardName(meta) {
  const title = (meta.title || "").trim();
  if (title) return title.length > 70 ? title.slice(0, 67) + "…" : title;
  try {
    const url = new URL(meta.url);
    return url.hostname || meta.url;
  } catch (error) {
    return meta.url || "dashboard";
  }
}

function dateParts(timestamp) {
  const date = new Date(timestamp);
  return {
    day: date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }),
    time: date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })
  };
}

/** Título del documento: es el nombre de archivo que propone Chrome. */
export function reportTitle(data) {
  const { day } = dateParts(data.meta.evaluatedAt);
  return "Reporte cromático · " + dashboardName(data.meta) + " · " + day;
}

function chip(hex) {
  return '<span class="m" style="background:' + escapeHtml(hex) + '"></span>';
}

function band(hexes) {
  return '<div class="banda" aria-hidden="true">' +
    hexes.map((hex) => '<i style="background:' + escapeHtml(hex) + '"></i>').join("") + "</div>";
}

function pill(kind, word) {
  return '<span class="p ' + kind + '">' + escapeHtml(word) + "</span>";
}

/** Escala de contraste 1–21 (logarítmica) con umbral y punto. */
function contrastScale(ratio, threshold, passes) {
  const axis = CONTRAST_AXIS.map((v) =>
    '<span style="left:' + contrastPosition(v) + '%">' + String(v).replace(".", ",") + "</span>").join("");
  return '<div class="escala-c" aria-hidden="true"><div class="pista"></div>' +
    '<div class="zona" style="width:' + contrastPosition(threshold) + '%"></div>' +
    '<div class="umb" style="left:' + contrastPosition(threshold) + '%"></div>' +
    '<div class="pt ' + (passes ? "ok" : "ko") + '" style="left:' + contrastPosition(ratio) + '%"></div></div>' +
    '<div class="eje-c" aria-hidden="true">' + axis + "</div>";
}

/** Fila de las tablas de contraste (1.4.3 con «Aa», 1.4.11 con barra). */
function contrastRow(row, kind) {
  const sample = kind === "text"
    ? '<div class="aa" aria-hidden="true" style="color:' + escapeHtml(row.foregroundHex) + ";background:" + escapeHtml(row.backgroundHex) + '">Aa</div>'
    : '<div class="obj" aria-hidden="true" style="background:' + escapeHtml(row.backgroundHex) + '"><i style="background:' +
      escapeHtml(row.foregroundHex) + (row.ratio < 1.3 ? ";outline:1px dashed var(--borde)" : "") + '"></i></div>';
  const parts = [row.count + (row.count === 1 ? " elemento" : " elementos")];
  if (row.largeText) parts.push("texto grande, umbral " + num(row.threshold, 1) + ":1");
  if (row.examples && row.examples.length) parts.push(row.examples.slice(0, 3).join(", "));
  return "<tr><td>" + sample + "</td>" +
    '<td><span class="mono">' + escapeHtml(row.foregroundHex) + '</span> <span class="sec">sobre</span> <span class="mono">' +
    escapeHtml(row.backgroundHex) + '</span><br><span class="sec detalle">' + escapeHtml(parts.join(" · ")) + "</span></td>" +
    '<td class="num">' + num(row.ratio) + ":1</td>" +
    '<td class="col-escala">' + contrastScale(row.ratio, row.threshold, row.passes) + "</td>" +
    "<td>" + (row.passes ? pill("ok", "Cumple") : pill("ko", "Incumple")) + "</td></tr>";
}

function contrastTable(rows, kind, emptyText) {
  if (!rows.length) return '<p class="sin-datos">' + escapeHtml(emptyText) + "</p>";
  return '<div class="env"><table class="tabla"><thead><tr><th>Muestra</th><th>Colores y elementos</th><th>Relación</th>' +
    "<th>Escala</th><th>Veredicto</th></tr></thead><tbody>" + rows.map((row) => contrastRow(row, kind)).join("") + "</tbody></table></div>";
}

/** Matriz ΔE00: triángulo inferior, número de serie en filas y columnas. */
function matrixTable(series, matrix, threshold) {
  const n = series.length;
  if (n < 2 || !matrix) return '<p class="sin-datos">Se necesitan al menos dos series para la matriz.</p>';
  let html = '<div class="env"><table class="matriz"><caption class="solo-lector">Diferencias ΔE00 entre series simuladas; solo se muestra el triángulo inferior.</caption><thead><tr><th></th>';
  for (let j = 0; j < n - 1; j += 1) {
    html += '<th scope="col">' + chip(series[j].hex) + "<small>" + (j + 1) + "</small></th>";
  }
  html += "</tr></thead><tbody>";
  for (let i = 1; i < n; i += 1) {
    html += '<tr><th scope="row" class="fila">' + chip(series[i].hex) + " " + (i + 1) + "</th>";
    for (let j = 0; j < n - 1; j += 1) {
      if (j < i) {
        const value = matrix[i][j];
        const conflict = value < threshold;
        html += '<td class="' + (conflict ? "x" : "") + '">' + num(value, 1) + (conflict ? '<span class="solo-lector"> confundible</span>' : "") + "</td>";
      } else {
        html += '<td class="n"></td>';
      }
    }
    html += "</tr>";
  }
  return html + "</tbody></table></div>";
}

/** Tarjeta de un par confundible con muestras y escala 0–50. */
function conflictCard(pair, threshold, simulationLabel, hasSimulation) {
  const typical = pair.deltaOriginal === null ? null : pair.deltaOriginal;
  const chips = '<div class="chips-f"><span>Típica</span><div class="chips" aria-hidden="true"><i style="background:' + escapeHtml(pair.aHex) +
    '"></i><i style="background:' + escapeHtml(pair.bHex) + '"></i></div>' +
    (hasSimulation
      ? "<span>" + escapeHtml(simulationLabel) + '</span><div class="chips" aria-hidden="true"><i style="background:' + escapeHtml(pair.aSimulatedHex) +
        '"></i><i style="background:' + escapeHtml(pair.bSimulatedHex) + '"></i></div>'
      : "") + "</div>";
  const scale = '<div class="escala" aria-hidden="true"><div class="pista"></div>' +
    '<div class="zona" style="width:' + deltaPosition(threshold) + '%"></div>' +
    '<div class="umbral" style="left:' + deltaPosition(threshold) + '%"></div>' +
    (hasSimulation && typical !== null ? '<div class="tip" style="left:' + deltaPosition(typical) + '%"></div>' : "") +
    '<div class="sim" style="left:' + deltaPosition(pair.deltaSimulated) + '%"></div></div>';
  const figures = hasSimulation
    ? "<span>Simulado <b>" + num(pair.deltaSimulated) + "</b>" + (typical === null ? "" : " · típico <b>" + num(typical) + "</b>") + "</span>" +
      "<span>" + (typical === null ? "" : typical >= threshold ? "Solo bajo simulación" : "También en visión típica") + "</span>"
    : "<span>ΔE00 en visión típica <b>" + num(pair.deltaSimulated) + "</b></span><span>Por debajo del umbral " + num(threshold, 1) + "</span>";
  return '<div class="parc"><div class="top">' + chip(pair.aHex) + escapeHtml(pair.aHex) + chip(pair.bHex) + escapeHtml(pair.bHex) +
    pill("ko", "Confundible") + "</div>" + chips + scale + '<div class="cifras">' + figures + "</div></div>";
}

/** Sección 5 según el desenlace. */
function recommendationSection(data, considered, simulationLabel) {
  const rec = data.recommendation;
  const meta = data.meta;
  const familyLabel = meta.family === "sequential" ? "secuencial" : "categórica";
  const total = data.consideredSeries.length;
  const summaryLine = '<div class="fila-et"><span>Familia indicada: ' + familyLabel + "</span><span>" + considered.length + " de " + total +
    " series consideradas</span></div>";

  if (meta.simulationType === "none") {
    const rows = (data.overview || []).map((item) => {
      let word = "Sin datos";
      let kind = "neutra";
      let detail = "se necesitan al menos dos series consideradas";
      if (item.outcome === "compliant") { word = "Cumple"; kind = "ok"; detail = "ΔE00 mínimo " + num(item.minDelta) + " sin reemplazo"; }
      else if (item.outcome === "proposal") { word = "Propuesta"; kind = "neutra"; detail = "esquema " + item.schemeName; }
      else if (item.outcome === "redesign") {
        word = "Rediseño"; kind = "aviso";
        detail = item.exhausted ? "ningún esquema superó la revalidación" : item.seriesCount + " series frente a " + item.maxAvailable + " disponibles";
      }
      return '<div class="ov"><span>' + escapeHtml(capitalize(SIMULATION_LABELS[item.type])) + '</span><span class="sec">' + escapeHtml(detail) + "</span>" + pill(kind, word) + "</div>";
    }).join("");
    return '<div class="rec-cab"><div><div class="esq">Sin simulación en la evaluación</div><p class="por">Desenlace de la recomendación bajo cada deficiencia a severidad máxima, con las series consideradas.</p></div></div>' +
      '<div class="ovs">' + (rows || '<p class="sin-datos">Sin resumen disponible.</p>') + "</div>" + summaryLine;
  }
  if (!rec || rec.outcome === "no-deficiency") {
    return '<p class="sin-datos">No se generó recomendación.</p>' + summaryLine;
  }
  if (rec.outcome === "insufficient-series") {
    return '<div class="rec-cab"><div><div class="esq">Series insuficientes</div><p class="por">Se necesitan al menos dos series consideradas para recomendar una paleta.</p></div></div>' + summaryLine;
  }
  if (rec.outcome === "compliant") {
    return '<div class="rec-cab"><div><div class="esq">Cumple sin reemplazo</div><p class="por">La paleta de series considerada supera el contraste evaluado y la distinguibilidad bajo ' +
      escapeHtml(simulationLabel) + " a severidad máxima: ΔE00 mínimo " + num(rec.minDelta) + " con umbral " + num(rec.threshold, 1) + ".</p></div>" +
      '<div class="kpis"><div><b class="mono">' + num(rec.minDelta) + "</b>ΔE00 mínimo</div></div></div>" + summaryLine;
  }
  if (rec.outcome === "redesign") {
    const reason = rec.exhausted
      ? "Ningún esquema acreditado superó la revalidación con " + rec.seriesCount + " series (se probaron " + (rec.attempts || []).length + ")."
      : "El dashboard tiene " + rec.seriesCount + " series y el mayor esquema acreditado para " + simulationLabel + " dispone de " + rec.maxAvailable + " colores.";
    return '<div class="rec-cab"><div><div class="esq">Rediseño recomendado</div><p class="por">' + escapeHtml(reason) + "</p></div></div>" +
      '<p class="aviso"><b>Aviso</b> Se recomienda reducir series, agrupar categorías o reforzar con etiquetas y formas.</p>' + summaryLine;
  }
  const mapping = rec.mapping;
  const columns = mapping.map((entry) =>
    '<div class="col"><i style="background:' + escapeHtml(entry.originalHex) + '"></i><i style="background:' + escapeHtml(entry.proposedHex) + '"></i>' +
    "<span><b>" + escapeHtml(entry.originalHex) + "</b><em>" + escapeHtml(entry.proposedHex) + "</em></span></div>").join("");
  return '<div class="rec-cab"><div><div class="esq">' + escapeHtml(rec.scheme.name) + '</div><p class="por">Primer esquema del catálogo acreditado para ' +
    escapeHtml(simulationLabel) + " con capacidad para las " + mapping.length + " series consideradas que superó la revalidación a severidad máxima. Familia indicada: " +
    familyLabel + ".</p></div>" +
    '<div class="kpis"><div><b>' + rec.revalidation.iterations + "</b>esquemas probados</div><div><b>" + rec.revalidation.swaps +
    '</b>sustituciones</div><div><b class="mono">' + num(rec.revalidation.minDelta) + "</b>ΔE00 mínimo</div></div></div>" +
    '<div class="antes-despues">' + columns + "</div>" +
    '<div class="fila-et"><span>Arriba: color original · Abajo: color propuesto</span><span>' + considered.length + " de " + total + " series consideradas</span></div>";
}

/** Párrafo de resumen de la sección 1, redactado con reglas a partir de los resultados. */
function summaryParagraph(data, failingText, failingGraphics, conflicts, hasSimulation, simulationLabel) {
  const failing = failingText + failingGraphics;
  const sentences = [];
  sentences.push(failing > 0 || conflicts > 0
    ? "La paleta necesita ajustes."
    : "La paleta no presenta incumplimientos con la configuración evaluada.");
  if (failing > 0) {
    const parts = [];
    if (failingText > 0) parts.push(failingText + (failingText === 1 ? " de texto (criterio 1.4.3)" : " de texto (criterio 1.4.3)"));
    if (failingGraphics > 0) parts.push(failingGraphics + (failingGraphics === 1 ? " de objetos gráficos (criterio 1.4.11)" : " de objetos gráficos (criterio 1.4.11)"));
    sentences.push((failing === 1 ? "Un par no alcanza" : failing + " pares no alcanzan") + " el contraste exigido: " + parts.join(" y ") + ".");
  } else {
    sentences.push("Todos los pares evaluados alcanzan el contraste exigido.");
  }
  if (conflicts > 0) {
    sentences.push((conflicts === 1 ? "Un par de series se confunde" : conflicts + " pares de series se confunden") +
      (hasSimulation ? " bajo " + simulationLabel + "." : " ya en visión típica."));
  } else {
    sentences.push("Ningún par de series queda por debajo del umbral" + (hasSimulation ? " bajo " + simulationLabel + "." : " en visión típica."));
  }
  const rec = data.recommendation;
  if (!hasSimulation) {
    sentences.push("El apartado 5 resume el desenlace de la recomendación bajo las tres deficiencias.");
  } else if (rec && rec.outcome === "proposal") {
    sentences.push("La propuesta del apartado 5 (" + rec.scheme.name + ") sustituye las " + rec.mapping.length +
      " series consideradas con ΔE00 mínimo " + num(rec.revalidation.minDelta) + ".");
  } else if (rec && rec.outcome === "compliant") {
    sentences.push("La paleta de series considerada cumple; el apartado 5 no propone reemplazo.");
  } else if (rec && rec.outcome === "redesign") {
    sentences.push("El apartado 5 recomienda rediseñar: " + (rec.exhausted
      ? "ningún esquema acreditado superó la revalidación."
      : "hay " + rec.seriesCount + " series y el mayor esquema acreditado dispone de " + rec.maxAvailable + " colores."));
  } else {
    sentences.push("El apartado 5 no pudo generar recomendación con las series consideradas.");
  }
  return sentences.join(" ");
}

/** HTML del artículo completo (sin <html>/<head>). */
export function renderReportBody(data) {
  const meta = data.meta;
  const { day, time } = dateParts(meta.evaluatedAt);
  const hasSimulation = meta.simulationType !== "none";
  const simulationLabel = SIMULATION_LABELS[meta.simulationType] || meta.simulationType;
  const simulationTitle = capitalize(simulationLabel);
  const severityText = meta.simulationType === "tritanopia" ? "dicromatopsia completa" : "severidad " + num(meta.simulationSeverity, 1);
  const deficiencyText = hasSimulation ? simulationTitle + ", " + severityText : "Sin simulación (vista original)";
  const levels = meta.levels.map((level) => LEVEL_LABELS[level] || level);
  const version = escapeHtml(meta.extensionVersion);

  const textRows = data.contrast.text;
  const graphicRows = data.contrast.graphics;
  const failingText = textRows.filter((r) => !r.passes).length;
  const failingGraphics = graphicRows.filter((r) => !r.passes).length;
  const failing = failingText + failingGraphics;
  const totalPairs = textRows.length + graphicRows.length;
  const series = data.consideredSeries;
  const considered = series.filter((s) => s.selected);
  const n = series.length;
  const combinations = n * (n - 1) / 2;
  const conflicts = data.conflicts.length;
  const rec = data.recommendation;

  // Tarjeta de recomendación del veredicto.
  let recCard;
  if (!hasSimulation) {
    recCard = '<span class="esq">Tres deficiencias</span><span class="t">resumen en el apartado 5</span>';
  } else if (rec && rec.outcome === "proposal") {
    recCard = '<span class="esq">' + escapeHtml(rec.scheme.name) + '</span><span class="t">propuesta validada, ΔE00 mínimo ' + num(rec.revalidation.minDelta) + "</span>";
  } else if (rec && rec.outcome === "compliant") {
    recCard = '<span class="esq">Cumple</span><span class="t">sin reemplazo, ΔE00 mínimo ' + num(rec.minDelta) + "</span>";
  } else if (rec && rec.outcome === "redesign") {
    recCard = '<span class="esq">Rediseño</span><span class="t">' + (rec.exhausted ? "ningún esquema superó la revalidación" : rec.seriesCount + " series frente a " + rec.maxAvailable + " disponibles") + "</span>";
  } else {
    recCard = '<span class="esq">Sin recomendación</span><span class="t">series consideradas insuficientes</span>';
  }

  const bandsBox = '<div class="bfila"><span><b>Visión típica</b>' + considered.length + (considered.length === 1 ? " serie" : " series") + "</span>" + band(considered.map((s) => s.hex)) + "</div>" +
    (hasSimulation
      ? '<div class="bfila"><span><b>' + escapeHtml(simulationTitle) + "</b>" + escapeHtml(severityText) + "</span>" + band(considered.map((s) => s.simulatedHex)) + "</div>"
      : "") +
    '<p class="nota-banda">' + (hasSimulation
      ? considered.length + " series consideradas de " + n + " detectadas, en visión típica y bajo " + escapeHtml(simulationLabel) + "; el detalle está en las secciones 3 y 4."
      : "Evaluación sin simulación: solo se muestra la visión típica de las " + considered.length + " series consideradas de " + n + " detectadas.") + "</p>";

  const paletteCards = data.palette.map((color) =>
    '<div class="ficha"><div class="dos" aria-hidden="true"><i style="background:' + escapeHtml(color.hex) + '"></i><i style="background:' + escapeHtml(color.simulatedHex || color.hex) + '"></i></div>' +
    '<div class="dat"><span class="hx">' + escapeHtml(color.hex) + '</span><span class="sim">' + (hasSimulation ? "simulado " + escapeHtml(color.simulatedHex || color.hex) : "sin simulación") + "</span>" +
    '<span class="rol">' + escapeHtml(color.roles.map((r) => ROLE_LABELS[r] || r).join(" · ")) + " · " + num(color.share * 100, 1) + " %</span></div></div>").join("");

  const conflictCards = data.conflicts.length
    ? '<div class="pares">' + data.conflicts.map((pair) => conflictCard(pair, meta.threshold, simulationTitle, hasSimulation)).join("") + "</div>"
    : '<p class="sin-datos">Ningún par de series por debajo del umbral ' + num(meta.threshold, 1) + (hasSimulation ? " bajo " + escapeHtml(simulationLabel) : "") + ".</p>";

  // Avisos de la sección 6: solo los que aplican.
  const notices = [];
  if (data.warnings.approximate) {
    notices.push("Evaluación aproximada: parte de la paleta proviene de la captura de pantalla (nivel 3) y perdió la relación color-elemento; el contraste solo cubre los colores con elemento identificado.");
  }
  if (data.warnings.selectedWithoutElements > 0) {
    const k = data.warnings.selectedWithoutElements;
    notices.push(k + (k === 1 ? " color considerado proviene" : " colores considerados provienen") + " del muestreo de canvas y la previsualización no puede recolorearlos.");
  }
  if (data.warnings.variantsGrouped > 0) {
    const k = data.warnings.variantsGrouped;
    notices.push(k + (k === 1 ? " color se agrupó" : " colores se agruparon") + " como variante de suavizado de una serie declarada y quedó fuera de las series consideradas por defecto.");
  }

  return '<header class="portada">' +
    '<div class="marca"><div class="logo" aria-hidden="true"><i></i><i></i><i></i><i></i></div>Evaluador cromático · reporte generado en el navegador</div>' +
    "<h1>Reporte de accesibilidad cromática</h1>" +
    '<p class="sub">' + escapeHtml(dashboardName(meta)) + "</p>" +
    '<dl class="meta">' +
    "<div><dt>Fecha</dt><dd>" + escapeHtml(day + " · " + time) + "</dd></div>" +
    "<div><dt>Deficiencia evaluada</dt><dd>" + escapeHtml(deficiencyText) + "</dd></div>" +
    "<div><dt>Extracción</dt><dd>" + escapeHtml(levels.join(" + ") || "ninguna") + "</dd></div>" +
    "<div><dt>Versión</dt><dd>" + version + "</dd></div>" +
    '<div class="ancha"><dt>Dirección evaluada</dt><dd class="mono direccion">' + escapeHtml(meta.url) + "</dd></div>" +
    "</dl></header>" +
    '<div class="bandas"><div class="caja" role="img" aria-label="Series consideradas del dashboard en visión típica' + (hasSimulation ? " y bajo " + escapeHtml(simulationLabel) : "") + '">' + bandsBox + "</div></div>" +
    '<div class="cuerpo">' +

    "<section><h2>1. Resultado</h2>" +
    '<div class="veredicto">' +
    '<div class="ver"><span class="d">Contraste WCAG 2.1</span><span class="v ' + (failing > 0 ? "mal" : "ok") + '">' + failing + " <small>de " + totalPairs + "</small></span>" +
    '<span class="t">' + (failing === 1 ? "par incumple" : "pares incumplen") + " el umbral</span></div>" +
    '<div class="ver"><span class="d">Distinguibilidad' + (hasSimulation ? " bajo " + escapeHtml(simulationLabel) : " en visión típica") + '</span><span class="v ' + (conflicts > 0 ? "mal" : "ok") + '">' +
    conflicts + " <small>de " + combinations + '</small></span><span class="t">' + (conflicts === 1 ? "par" : "pares") + " por debajo de ΔE00 " + num(meta.threshold, 1) + "</span></div>" +
    '<div class="ver"><span class="d">Recomendación</span>' + recCard + "</div>" +
    "</div>" +
    '<p class="resumen-texto">' + escapeHtml(summaryParagraph(data, failingText, failingGraphics, conflicts, hasSimulation, simulationLabel)) + "</p>" +
    "</section>" +

    "<section><h2>2. Paleta detectada <small>" + data.palette.length + (data.palette.length === 1 ? " color" : " colores") + "</small></h2>" +
    '<p class="intro">Cada ficha muestra el color declarado en la página a la izquierda y su versión ' + (hasSimulation ? "simulada" : "sin simular") + " a la derecha, con su papel y su peso en la página.</p>" +
    '<div class="rejilla">' + paletteCards + "</div></section>" +

    "<section><h2>3. Contraste <small>" + (failing === 0 ? "todo cumple" : failing + (failing === 1 ? " incumple" : " incumplen")) + "</small></h2>" +
    '<p class="intro">Relación de contraste según las WCAG 2.1, calculada sobre los colores declarados. La escala es logarítmica de 1:1 a 21:1; la línea marca el umbral.</p>' +
    "<h3>1.4.3 Texto sobre fondo <span>· umbral 4,5:1 · texto grande 3:1</span></h3>" + contrastTable(textRows, "text", "No se encontraron pares de texto evaluables.") +
    "<h3>1.4.11 Objetos gráficos <span>· umbral 3:1</span></h3>" + contrastTable(graphicRows, "graphic", "No se encontraron objetos gráficos evaluables.") +
    "</section>" +

    "<section><h2>4. Distinguibilidad <small>" + conflicts + " de " + combinations + " pares</small></h2>" +
    '<p class="intro">Diferencia CIEDE2000 entre cada par de series' + (hasSimulation ? " ya simuladas" : " en visión típica") +
    ". La matriz es simétrica, por lo que solo se muestra la mitad inferior. En negrita sobre fondo rojizo, los pares por debajo del umbral " + num(meta.threshold, 1) + ".</p>" +
    matrixTable(series, data.matrix, meta.threshold) + conflictCards + "</section>" +

    "<section><h2>5. Recomendación</h2>" + recommendationSection(data, considered, simulationLabel) + "</section>" +

    "<section><h2>6. Método y declaraciones</h2>" +
    '<dl class="metodo">' +
    "<div><dt>Contraste</dt><dd>Fórmula literal de las WCAG 2.1, criterios 1.4.3 y 1.4.11</dd></div>" +
    "<div><dt>Diferencia de color</dt><dd>CIEDE2000 (Sharma, Wu y Dalal, 2005)</dd></div>" +
    "<div><dt>Simulación protan y deutan</dt><dd>Machado, Oliveira y Fernandes (2009)</dd></div>" +
    "<div><dt>Simulación tritan</dt><dd>Brettel, Viénot y Mollon (1997)</dd></div>" +
    "<div><dt>Umbral de confusión</dt><dd>ΔE00 &lt; " + num(meta.threshold, 1) + " entre series" + (hasSimulation ? " simuladas" : "") + "</dd></div>" +
    "<div><dt>Evaluación</dt><dd>" + (data.warnings.approximate ? "Aproximada: parte de la paleta sin elemento asociado" : "Exacta: todos los colores con elemento asociado") + "</dd></div>" +
    "</dl>" +
    notices.map((text) => '<p class="aviso"><b>Aviso</b> ' + escapeHtml(text) + "</p>").join("") +
    "</section>" +

    '<footer class="pie"><span>Generado localmente por Evaluador cromático ' + version + ". Ningún dato de la página salió del navegador.</span><span>Preparado para imprimir en A4</span></footer>" +
    "</div>";
}

/** Hoja de estilos del reporte (pantalla e impresión A4). */
export const REPORT_STYLES =
"/* Copia literal del tema claro de src/ui/estilos/tokens.css (auditada). */\n" +
":root {\n" +
"  color-scheme: light;\n" +
"  --fondo-pagina: #F2F5F9;\n" +
"  --superficie: #FFFFFF;\n" +
"  --superficie-2: #E8EDF4;\n" +
"  --borde: #64707F;\n" +
"  --borde-suave: #C9D2DE;\n" +
"  --texto: #16202C;\n" +
"  --texto-secundario: #465362;\n" +
"  --acento: #155EA2;\n" +
"  --acento-texto: #FFFFFF;\n" +
"  --correcto: #00563F;\n" +
"  --correcto-suave: #DCF2E8;\n" +
"  --aviso: #8A6100;\n" +
"  --aviso-suave: #F5EAC9;\n" +
"  --error: #7F2B00;\n" +
"  --error-suave: #FBE3D6;\n" +
"  --fuente-ui: system-ui, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif;\n" +
"  --fuente-mono: ui-monospace, Consolas, \"Cascadia Mono\", \"Courier New\", monospace;\n" +
"}\n" +
"* { box-sizing: border-box; }\n" +
"html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n" +
"body { margin: 0; background: var(--fondo-pagina); color: var(--texto); font-family: var(--fuente-ui); font-size: 0.9375rem; line-height: 1.55; }\n" +
".hoja { max-width: 880px; margin: 24px auto; background: var(--superficie); border: 1px solid var(--borde-suave); border-radius: 8px; overflow: hidden; }\n" +
".mono { font-family: var(--fuente-mono); font-variant-numeric: tabular-nums; }\n" +
".sec { color: var(--texto-secundario); }\n" +
".solo-lector { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }\n" +
"/* portada */\n" +
".portada { background: var(--acento); color: var(--acento-texto); padding: 28px 36px 24px; }\n" +
".portada .marca { display: flex; align-items: center; gap: 10px; font-size: 0.8125rem; font-weight: 600; }\n" +
".logo { width: 22px; height: 22px; border-radius: 5px; display: grid; grid-template-columns: 1fr 1fr; overflow: hidden; border: 1.5px solid var(--acento-texto); flex: none; }\n" +
".logo i:nth-child(1) { background: #E69F00; } .logo i:nth-child(2) { background: #56B4E9; } .logo i:nth-child(3) { background: #009E73; } .logo i:nth-child(4) { background: #CC79A7; }\n" +
".portada h1 { font-size: 2rem; line-height: 1.15; margin: 18px 0 6px; font-weight: 700; text-wrap: balance; letter-spacing: -0.01em; }\n" +
".portada .sub { font-size: 1rem; margin: 0; overflow-wrap: anywhere; }\n" +
".meta { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 20px; margin: 22px 0 0; padding-top: 16px; border-top: 1px solid rgba(255, 255, 255, 0.45); }\n" +
".meta div { min-width: 0; }\n" +
".meta .ancha { grid-column: 1 / -1; }\n" +
".meta dt { font-size: 0.75rem; }\n" +
".meta dd { margin: 2px 0 0; font-size: 0.875rem; font-weight: 600; overflow-wrap: anywhere; }\n" +
".meta dd.direccion { font-weight: 500; }\n" +
"/* bandas */\n" +
".bandas { padding: 0 36px; margin-top: -1px; background: var(--acento); }\n" +
".bandas .caja { background: var(--superficie); border-radius: 8px 8px 0 0; padding: 18px 20px 16px; display: flex; flex-direction: column; gap: 8px; }\n" +
".bfila { display: grid; grid-template-columns: 118px minmax(0, 1fr); gap: 12px; align-items: center; }\n" +
".bfila > span { font-size: 0.8125rem; color: var(--texto-secundario); }\n" +
".bfila b { display: block; font-size: 0.8125rem; color: var(--texto); font-weight: 600; }\n" +
".banda { display: flex; height: 44px; border: 1px solid var(--borde); border-radius: 4px; overflow: hidden; background: var(--superficie-2); }\n" +
".banda i { flex: 1; }\n" +
".nota-banda { font-size: 0.8125rem; color: var(--texto-secundario); margin: 4px 0 0; }\n" +
"/* cuerpo */\n" +
".cuerpo { padding: 8px 36px 36px; }\n" +
"section { padding-top: 28px; }\n" +
"h2 { font-size: 1.25rem; margin: 0 0 4px; font-weight: 700; }\n" +
"h2 small { font-size: 0.8125rem; font-weight: 500; color: var(--texto-secundario); margin-left: 8px; }\n" +
".intro { margin: 0 0 14px; color: var(--texto-secundario); max-width: 66ch; }\n" +
"h3 { font-size: 0.9375rem; margin: 18px 0 6px; font-weight: 600; }\n" +
"h3 span { font-weight: 400; color: var(--texto-secundario); }\n" +
".sin-datos { margin: 6px 0; font-size: 0.875rem; color: var(--texto-secundario); }\n" +
"/* veredicto */\n" +
".veredicto { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--borde-suave); border-radius: 8px; overflow: hidden; }\n" +
".ver { padding: 16px 18px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }\n" +
".ver + .ver { border-left: 1px solid var(--borde-suave); }\n" +
".ver .d { font-size: 0.8125rem; color: var(--texto-secundario); }\n" +
".ver .v { font-size: 2.25rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }\n" +
".ver .v small { font-size: 0.9375rem; font-weight: 500; color: var(--texto-secundario); margin-left: 2px; }\n" +
".ver .v.mal { color: var(--error); }\n" +
".ver .v.ok { color: var(--correcto); }\n" +
".ver .t { font-size: 0.875rem; }\n" +
".ver .esq { font-size: 1.125rem; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }\n" +
".resumen-texto { margin: 14px 0 0; max-width: 70ch; }\n" +
"/* pastillas */\n" +
".p { font-size: 0.75rem; font-weight: 600; padding: 2px 9px; border-radius: 999px; white-space: nowrap; display: inline-block; }\n" +
".p.ok { background: var(--correcto-suave); color: var(--correcto); }\n" +
".p.ko { background: var(--error-suave); color: var(--error); }\n" +
".p.aviso { background: var(--aviso-suave); color: var(--aviso); }\n" +
".p.neutra { background: var(--superficie-2); color: var(--texto-secundario); }\n" +
"/* paleta */\n" +
".rejilla { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }\n" +
".ficha { border: 1px solid var(--borde-suave); border-radius: 6px; overflow: hidden; display: flex; flex-direction: column; }\n" +
".ficha .dos { display: grid; grid-template-columns: 1fr 1fr; height: 46px; border-bottom: 1px solid var(--borde-suave); }\n" +
".ficha .dos i { display: block; }\n" +
".ficha .dat { padding: 8px 10px; display: flex; flex-direction: column; gap: 1px; font-size: 0.8125rem; }\n" +
".ficha .dat .hx { font-family: var(--fuente-mono); font-size: 0.8125rem; font-weight: 600; }\n" +
".ficha .dat .sim { font-family: var(--fuente-mono); font-size: 0.75rem; color: var(--texto-secundario); }\n" +
".ficha .dat .rol { font-size: 0.75rem; color: var(--texto-secundario); overflow-wrap: anywhere; }\n" +
"/* contraste */\n" +
"/* Posicionado: los textos solo para lectores (absolutos) de las celdas quedan contenidos aquí. */\n" +
".env { overflow-x: auto; position: relative; }\n" +
".tabla { width: 100%; border-collapse: collapse; font-size: 0.875rem; }\n" +
".tabla th { text-align: left; font-size: 0.75rem; font-weight: 600; color: var(--texto-secundario); padding: 6px 8px; border-bottom: 1px solid var(--borde); }\n" +
".tabla td { padding: 8px; border-bottom: 1px solid var(--borde-suave); vertical-align: middle; }\n" +
".tabla td.num { font-family: var(--fuente-mono); font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }\n" +
".tabla td.col-escala { width: 34%; min-width: 150px; }\n" +
".tabla .detalle { font-size: 0.8125rem; }\n" +
".aa { width: 46px; min-height: 30px; border: 1px solid var(--borde-suave); border-radius: 4px; display: grid; place-items: center; font-weight: 700; font-size: 0.9375rem; }\n" +
".obj { width: 46px; height: 30px; border: 1px solid var(--borde-suave); border-radius: 4px; display: grid; place-items: center; }\n" +
".obj i { width: 26px; height: 13px; border-radius: 2px; }\n" +
".escala-c { position: relative; height: 16px; min-width: 140px; }\n" +
".escala-c .pista { position: absolute; left: 0; right: 0; top: 7px; height: 2px; background: var(--borde-suave); }\n" +
".escala-c .zona { position: absolute; left: 0; top: 5px; height: 6px; background: var(--error-suave); border-radius: 2px; }\n" +
".escala-c .umb { position: absolute; top: 1px; width: 1.5px; height: 14px; background: var(--texto-secundario); }\n" +
".escala-c .pt { position: absolute; top: 3px; width: 10px; height: 10px; border-radius: 50%; margin-left: -5px; }\n" +
".escala-c .pt.ko { background: var(--error); }\n" +
".escala-c .pt.ok { background: var(--correcto); }\n" +
".eje-c { display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--texto-secundario); font-family: var(--fuente-mono); position: relative; height: 16px; }\n" +
".eje-c span { position: absolute; transform: translateX(-50%); }\n" +
"/* matriz */\n" +
"table.matriz { border-collapse: separate; border-spacing: 2px; font-family: var(--fuente-mono); font-size: 0.75rem; font-variant-numeric: tabular-nums; }\n" +
"table.matriz th { font-weight: 500; color: var(--texto-secundario); padding: 0; }\n" +
"table.matriz thead th { text-align: center; vertical-align: bottom; height: 34px; }\n" +
"table.matriz thead th small { display: block; font-size: 0.75rem; }\n" +
"table.matriz th.fila { text-align: left; padding-right: 6px; white-space: nowrap; }\n" +
".m { display: inline-block; width: 14px; height: 14px; border-radius: 3px; border: 1px solid var(--borde); vertical-align: middle; margin-right: 4px; }\n" +
"table.matriz td { width: 42px; height: 26px; text-align: center; border-radius: 3px; background: var(--superficie-2); }\n" +
"table.matriz td.x { background: var(--error-suave); color: var(--error); font-weight: 700; }\n" +
"table.matriz td.n { background: transparent; }\n" +
".pares { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }\n" +
".parc { border: 1px solid var(--borde-suave); border-radius: 6px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }\n" +
".parc .top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-family: var(--fuente-mono); font-size: 0.8125rem; }\n" +
".parc .top .p { margin-left: auto; font-family: var(--fuente-ui); }\n" +
".chips { display: flex; height: 26px; border: 1px solid var(--borde); border-radius: 4px; overflow: hidden; }\n" +
".chips i { flex: 1; }\n" +
".chips-f { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 10px; align-items: center; font-size: 0.75rem; color: var(--texto-secundario); }\n" +
".escala { position: relative; height: 18px; }\n" +
".escala .pista { position: absolute; left: 0; right: 0; top: 8px; height: 2px; background: var(--borde-suave); }\n" +
".escala .zona { position: absolute; left: 0; top: 6px; height: 6px; background: var(--error-suave); border-radius: 2px; }\n" +
".escala .umbral { position: absolute; top: 2px; width: 1.5px; height: 14px; background: var(--texto-secundario); }\n" +
".escala .sim { position: absolute; top: 4px; width: 10px; height: 10px; border-radius: 50%; background: var(--error); margin-left: -5px; }\n" +
".escala .tip { position: absolute; top: 4px; width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--texto); background: var(--superficie); margin-left: -5px; }\n" +
".cifras { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 0.75rem; color: var(--texto-secundario); }\n" +
".cifras b { color: var(--texto); font-family: var(--fuente-mono); }\n" +
"/* recomendacion */\n" +
".rec-cab { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }\n" +
".rec-cab .esq { font-size: 1.375rem; font-weight: 700; line-height: 1.2; }\n" +
".rec-cab .por { font-size: 0.875rem; color: var(--texto-secundario); max-width: 52ch; margin: 4px 0 0; }\n" +
".kpis { display: flex; gap: 24px; }\n" +
".kpis div { font-size: 0.75rem; color: var(--texto-secundario); }\n" +
".kpis b { display: block; font-size: 1.375rem; color: var(--texto); font-variant-numeric: tabular-nums; }\n" +
".antes-despues { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }\n" +
".col { display: flex; flex-direction: column; border: 1px solid var(--borde-suave); border-radius: 6px; overflow: hidden; min-width: 0; }\n" +
".col i { display: block; height: 34px; }\n" +
".col i + i { border-top: 2px solid var(--superficie); }\n" +
".col span { font-family: var(--fuente-mono); font-size: 0.75rem; text-align: center; padding: 4px 2px; line-height: 1.3; overflow-wrap: anywhere; }\n" +
".col span b { display: block; font-weight: 600; color: var(--texto); }\n" +
".col span em { font-style: normal; color: var(--texto-secundario); }\n" +
".fila-et { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-size: 0.75rem; color: var(--texto-secundario); margin-top: 6px; }\n" +
".ovs { display: flex; flex-direction: column; }\n" +
".ov { display: flex; align-items: center; gap: 4px 10px; flex-wrap: wrap; padding: 8px 0; border-bottom: 1px solid var(--borde-suave); font-size: 0.875rem; }\n" +
".ov:last-child { border-bottom: 0; }\n" +
".ov .p { margin-left: auto; }\n" +
"/* metodo */\n" +
".metodo { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; border: 1px solid var(--borde-suave); border-radius: 8px; overflow: hidden; font-size: 0.875rem; margin: 0; }\n" +
".metodo div { padding: 10px 14px; border-bottom: 1px solid var(--borde-suave); }\n" +
".metodo div:nth-child(odd) { border-right: 1px solid var(--borde-suave); }\n" +
".metodo div:nth-last-child(-n + 2) { border-bottom: 0; }\n" +
".metodo dt { font-size: 0.75rem; color: var(--texto-secundario); }\n" +
".metodo dd { margin: 1px 0 0; }\n" +
".aviso { margin: 14px 0 0; font-size: 0.875rem; }\n" +
".aviso b { color: var(--aviso); }\n" +
".pie { margin-top: 32px; padding-top: 14px; border-top: 1px solid var(--borde-suave); display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 0.75rem; color: var(--texto-secundario); }\n" +
"/* pantalla estrecha */\n" +
"@media (max-width: 640px) {\n" +
"  .hoja { margin: 0; border-radius: 0; border-left: 0; border-right: 0; }\n" +
"  .portada, .cuerpo { padding-left: 18px; padding-right: 18px; }\n" +
"  .bandas { padding: 0 18px; }\n" +
"  .meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }\n" +
"  .veredicto { grid-template-columns: 1fr; }\n" +
"  .ver + .ver { border-left: 0; border-top: 1px solid var(--borde-suave); }\n" +
"  .pares { grid-template-columns: 1fr; }\n" +
"  .metodo { grid-template-columns: 1fr; }\n" +
"  .metodo div:nth-child(odd) { border-right: 0; }\n" +
"  .metodo div:nth-last-child(2) { border-bottom: 1px solid var(--borde-suave); }\n" +
"  .bfila { grid-template-columns: 1fr; }\n" +
"  .antes-despues { grid-template-columns: repeat(4, minmax(0, 1fr)); }\n" +
"}\n" +
"/* impresion A4 */\n" +
"@page { size: A4; margin: 14mm; }\n" +
"@media print {\n" +
"  body { background: #FFFFFF; font-size: 10.5pt; }\n" +
"  .hoja { margin: 0; border: 0; border-radius: 0; max-width: none; }\n" +
"  section { break-inside: auto; }\n" +
"  .veredicto, .parc, .ficha, .col, .metodo, .caja, .rec-cab, .antes-despues, .ov, tr, h2, h3 { break-inside: avoid; }\n" +
"  h2, h3, .intro { break-after: avoid; }\n" +
"  .p.ok, .p.ko, .p.aviso, .p.neutra { border: 1px solid currentColor; }\n" +
"  .env { overflow: visible; }\n" +
"  .pie { break-inside: avoid; }\n" +
"}\n";

/** Documento HTML completo y autocontenido; lo usan los arneses de prueba, no la extensión. */
export function renderReportHtml(data) {
  return "<!DOCTYPE html>\n<html lang=\"es\">\n<head>\n<meta charset=\"utf-8\">\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n" +
    "<title>" + escapeHtml(reportTitle(data)) + "</title>\n<style>\n" + REPORT_STYLES + "</style>\n</head>\n<body>\n" +
    '<article class="hoja">' + renderReportBody(data) + "</article>\n</body>\n</html>\n";
}

// Graficos del Panel Cumple dibujados a mano como SVG (sin librerias):
// barras agrupadas por trimestre, lineas mensuales y dona por region, con
// las mismas cuatro series. Colores de serie en atributos fill/stroke;
// ejes, marcas y cuadricula en #767676; textos en #1F2933 y #4B5563.
(function () {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const TINTA = "#1F2933";
  const TINTA_SUAVE = "#4B5563";
  const EJE = "#767676";

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function crearSvg(ancho, alto, etiqueta) {
    // fill="none" en la raíz: el fill computado por defecto del <svg> es negro.
    const svg = svgEl("svg", { viewBox: "0 0 " + ancho + " " + alto, role: "img", "aria-label": etiqueta, fill: "none" });
    return svg;
  }

  // Eje Y con marcas y cuadricula; devuelve la funcion de escala.
  function ejeY(svg, x0, x1, y0, y1, maximo, paso, unidad) {
    const escala = (v) => y1 - ((y1 - y0) * v) / maximo;
    // fill="none" explícito: el fill computado por defecto de <line> es
    // negro aunque no se pinte, y la extracción lo leería como un color.
    for (let v = 0; v <= maximo; v += paso) {
      const y = escala(v);
      svg.append(svgEl("line", { x1: x0, x2: x1, y1: y, y2: y, stroke: EJE, "stroke-width": 1, fill: "none" }));
      svg.append(svgEl("text", { x: x0 - 8, y: y + 4, "text-anchor": "end", "font-size": 12, fill: TINTA_SUAVE }, v + (unidad || "")));
    }
    svg.append(svgEl("line", { x1: x0, x2: x0, y1: y0, y2: y1, stroke: EJE, "stroke-width": 1, fill: "none" }));
    return escala;
  }

  function leyenda(svg, x, y) {
    REGIONES.forEach((region, i) => {
      const dx = x + i * 112;
      svg.append(svgEl("rect", { x: dx, y: y - 10, width: 12, height: 12, rx: 2, fill: PALETA[i] }));
      svg.append(svgEl("text", { x: dx + 18, y: y, "font-size": 12, fill: TINTA }, region));
    });
  }

  // ---- Barras agrupadas por trimestre ----
  function barras() {
    const W = 680, H = 350;
    const ml = 46, mr = 12, mt = 14, mb = 66;
    const svg = crearSvg(W, H, "Ventas trimestrales de 2025 por región, en miles de euros, barras agrupadas");
    const x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;
    const escala = ejeY(svg, x0, x1, y0, y1, 600, 150);
    const grupo = (x1 - x0) / TRIMESTRES.length;
    const relleno = 14;
    const hueco = 3;
    const anchoBarra = (grupo - 2 * relleno - hueco * (REGIONES.length - 1)) / REGIONES.length;
    TRIMESTRES.forEach((trimestre, t) => {
      const gx = x0 + t * grupo;
      svg.append(svgEl("text", { x: gx + grupo / 2, y: y1 + 18, "text-anchor": "middle", "font-size": 12, fill: TINTA_SUAVE }, trimestre));
      REGIONES.forEach((region, r) => {
        const valor = VENTAS_TRIMESTRE[region][t];
        const bx = gx + relleno + r * (anchoBarra + hueco);
        const by = escala(valor);
        svg.append(svgEl("rect", { x: bx, y: by, width: anchoBarra, height: y1 - by, fill: PALETA[r] }));
        svg.append(svgEl("text", { x: bx + anchoBarra / 2, y: by - 4, "text-anchor": "middle", "font-size": 11, fill: TINTA }, valor));
      });
    });
    svg.append(svgEl("line", { x1: x0, x2: x1, y1: y1, y2: y1, stroke: EJE, "stroke-width": 1, fill: "none" }));
    leyenda(svg, x0, H - 14);
    document.getElementById("grafico-barras").append(svg);
  }

  // ---- Lineas mensuales con marcadores ----
  function lineas() {
    const W = 680, H = 350;
    const ml = 46, mr = 92, mt = 14, mb = 66;
    const svg = crearSvg(W, H, "Ventas mensuales de 2025 por región, en miles de euros, líneas con marcadores");
    const x0 = ml, x1 = W - mr, y0 = mt, y1 = H - mb;
    const escala = ejeY(svg, x0, x1, y0, y1, 200, 50);
    const paso = (x1 - x0) / (MESES.length - 1);
    MESES.forEach((mes, i) => {
      svg.append(svgEl("text", { x: x0 + i * paso, y: y1 + 18, "text-anchor": "middle", "font-size": 12, fill: TINTA_SUAVE }, mes));
    });
    svg.append(svgEl("line", { x1: x0, x2: x1, y1: y1, y2: y1, stroke: EJE, "stroke-width": 1, fill: "none" }));
    REGIONES.forEach((region, r) => {
      const puntos = VENTAS_MES[region].map((v, i) => [x0 + i * paso, escala(v)]);
      svg.append(svgEl("polyline", {
        points: puntos.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" "),
        fill: "none", stroke: PALETA[r], "stroke-width": 2.5, "stroke-linejoin": "round", "stroke-linecap": "round"
      }));
      puntos.forEach((p) => svg.append(svgEl("circle", { cx: p[0], cy: p[1], r: 4, fill: PALETA[r] })));
      const ultimo = puntos[puntos.length - 1];
      const valorFinal = VENTAS_MES[region][VENTAS_MES[region].length - 1];
      svg.append(svgEl("text", { x: ultimo[0] + 10, y: ultimo[1] + 4, "font-size": 12, fill: TINTA }, region + " " + valorFinal));
    });
    leyenda(svg, x0, H - 14);
    document.getElementById("grafico-lineas").append(svg);
  }

  // ---- Dona con separacion angular (padAngle), sin bordes ----
  function arco(cx, cy, rExt, rInt, a0, a1) {
    const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [xa, ya] = p(rExt, a0);
    const [xb, yb] = p(rExt, a1);
    const [xc, yc] = p(rInt, a1);
    const [xd, yd] = p(rInt, a0);
    const grande = a1 - a0 > Math.PI ? 1 : 0;
    return "M" + xa.toFixed(2) + "," + ya.toFixed(2) +
      " A" + rExt + "," + rExt + " 0 " + grande + " 1 " + xb.toFixed(2) + "," + yb.toFixed(2) +
      " L" + xc.toFixed(2) + "," + yc.toFixed(2) +
      " A" + rInt + "," + rInt + " 0 " + grande + " 0 " + xd.toFixed(2) + "," + yd.toFixed(2) + " Z";
  }

  function dona() {
    const W = 460, H = 300;
    const svg = crearSvg(W, H, "Cuota anual de 2025 por región, dona con cuatro porciones");
    const cx = 150, cy = 150, rExt = 104, rInt = 64;
    const padAngle = 0.035;
    let angulo = -Math.PI / 2;
    REGIONES.forEach((region, r) => {
      const cuota = TOTAL_REGION[r] / TOTAL_ANUAL;
      const a0 = angulo + padAngle / 2;
      const a1 = angulo + cuota * 2 * Math.PI - padAngle / 2;
      svg.append(svgEl("path", { d: arco(cx, cy, rExt, rInt, a0, a1), fill: PALETA[r] }));
      angulo += cuota * 2 * Math.PI;
      const fy = 72 + r * 44;
      svg.append(svgEl("rect", { x: 300, y: fy - 11, width: 14, height: 14, rx: 2, fill: PALETA[r] }));
      svg.append(svgEl("text", { x: 322, y: fy, "font-size": 13, fill: TINTA }, region));
      svg.append(svgEl("text", { x: 322, y: fy + 16, "font-size": 12, fill: TINTA_SUAVE },
        TOTAL_REGION[r].toLocaleString("es-ES") + " k€ · " + (cuota * 100).toFixed(1).replace(".", ",") + " %"));
    });
    svg.append(svgEl("text", { x: cx, y: cy - 2, "text-anchor": "middle", "font-size": 22, "font-weight": 700, fill: TINTA }, TOTAL_ANUAL.toLocaleString("es-ES")));
    svg.append(svgEl("text", { x: cx, y: cy + 18, "text-anchor": "middle", "font-size": 12, fill: TINTA_SUAVE }, "k€ en 2025"));
    document.getElementById("grafico-dona").append(svg);
  }

  // ---- Tabla con los datos mensuales ----
  function tabla() {
    const cabecera = document.getElementById("tabla-cabecera");
    const fila = document.createElement("tr");
    fila.append(Object.assign(document.createElement("th"), { textContent: "Región", scope: "col" }));
    for (const mes of MESES) fila.append(Object.assign(document.createElement("th"), { textContent: mes, scope: "col" }));
    fila.append(Object.assign(document.createElement("th"), { textContent: "Total", scope: "col" }));
    cabecera.append(fila);
    const cuerpo = document.getElementById("tabla-cuerpo");
    REGIONES.forEach((region, r) => {
      const tr = document.createElement("tr");
      tr.append(Object.assign(document.createElement("th"), { textContent: region, scope: "row" }));
      for (const v of VENTAS_MES[region]) tr.append(Object.assign(document.createElement("td"), { textContent: String(v) }));
      tr.append(Object.assign(document.createElement("td"), { textContent: TOTAL_REGION[r].toLocaleString("es-ES") }));
      cuerpo.append(tr);
    });
  }

  // ---- Indicadores del encabezado ----
  function indicadores() {
    const contenedor = document.getElementById("indicadores");
    for (const kpi of INDICADORES) {
      const div = document.createElement("div");
      div.className = "kpi";
      const valor = document.createElement("span");
      valor.className = "valor";
      valor.textContent = kpi.valor;
      const etiqueta = document.createElement("span");
      etiqueta.className = "etiqueta";
      etiqueta.textContent = kpi.etiqueta;
      div.append(valor, etiqueta);
      contenedor.append(div);
    }
  }

  indicadores();
  barras();
  lineas();
  dona();
  tabla();
})();

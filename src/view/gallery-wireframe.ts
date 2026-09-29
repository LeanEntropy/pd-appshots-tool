/**
 * Draws an image's two layout wireframes (screenshot layer, marketing layer) in the (i) popover
 * from the checked data the server sends (src/layout/wireframe-svg.ts), with DOM calls only:
 * element and attribute names are fixed here, numbers are re-checked, colours must be #rrggbb,
 * and text goes in as textContent. The labels come from the model's reading of store
 * screenshots, so nothing of it is ever parsed as markup.
 */
export const WIREFRAME_SCRIPT = `
const WF_NS = "http://www.w3.org/2000/svg";
const wfNum = (v, lo, hi) => String(Math.round(Math.min(hi, Math.max(lo, typeof v === "number" && Number.isFinite(v) ? v : lo)) * 100) / 100);
const wfN = (v, lo, hi) => Number(wfNum(v, lo, hi));
const wfColour = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : "#b0bec5");
const wfText = (s) => (typeof s === "string" ? s.slice(0, 300) : "");
const wfList = (xs, n) => (Array.isArray(xs) ? xs.slice(0, n).filter((x) => x && typeof x === "object") : []);

function wfEl(tag, attrs, text) {
  const el = document.createElementNS(WF_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  if (text) el.textContent = text;
  return el;
}

function wfHtml(tag, cls, text) {
  const el = document.createElement(tag);
  el.className = cls;
  if (text) el.textContent = text;
  return el;
}

function wfShape(s, stroke) {
  const outline = s.outline === true;
  const c = wfColour(s.fill);
  const paint = { fill: outline ? "none" : c, stroke: outline ? c : wfColour(stroke), "stroke-width": outline ? "4" : "1.2" };
  if (s.dashed === true) paint["stroke-dasharray"] = "5 3";
  const pts = Array.isArray(s.pts) ? s.pts.slice(0, 16).map((v) => wfNum(v, -2000, 4000)) : [];
  let el;
  if (pts.length >= 6 && pts.length % 2 === 0) el = wfEl("polygon", { points: pts.join(" "), ...paint });
  else {
    const x = wfN(s.x, -2000, 4000), y = wfN(s.y, -2000, 4000), w = wfN(s.w, 0, 4000), h = wfN(s.h, 0, 4000);
    const rot = wfN(s.rot, -45, 45);
    const a = { x: String(x), y: String(y), width: String(w), height: String(h), rx: wfNum(s.rx, 0, 200), ...paint };
    if (rot) a.transform = "rotate(" + rot + " " + wfNum(x + w / 2, -4000, 8000) + " " + wfNum(y + h / 2, -4000, 8000) + ")";
    el = wfEl("rect", a);
  }
  el.appendChild(wfEl("title", {}, wfText(s.title)));
  return el;
}

function wfLabel(l) {
  const x = wfN(l.x, -100, 4000), y = wfN(l.y, -100, 4000), w = wfN(l.w, 0, 4000), h = wfN(l.h, 0, 400);
  const rot = wfN(l.rot, -45, 45);
  const g = wfEl("g", rot ? { transform: "rotate(" + rot + " " + wfNum(x + w / 2, -4000, 8000) + " " + wfNum(y + h / 2, -4000, 8000) + ")" } : {});
  if (l.chip === true) g.appendChild(wfEl("rect", { x: String(x), y: String(y), width: String(w), height: String(h), rx: "3", fill: "#ffffff", "fill-opacity": "0.9", stroke: "#999999", "stroke-width": "0.6" }));
  (Array.isArray(l.lines) ? l.lines.slice(0, 3) : []).forEach((t, i) => {
    g.appendChild(wfEl("text", { x: wfNum(x + 3, -100, 4000), y: wfNum(y + 12 + i * 13, -100, 4000), "font-size": "11", fill: "#1d1d1d" }, wfText(t)));
  });
  return g;
}

function wfPanel(p) {
  const w = wfN(p.w, 60, 800), h = wfN(p.h, 1, 4000), strip = wfN(p.strip, 0, 400);
  const box = wfHtml("div", "wf-panel");
  box.style.width = w + "px";
  box.appendChild(wfHtml("div", "wf-title", wfText(p.title)));
  const svg = wfEl("svg", { class: "wireframe", viewBox: "0 0 " + w + " " + (h + strip), width: String(w), height: String(h + strip), role: "img", "aria-label": /^(Screenshot|Marketing) layer$/.test(p.title) ? p.title : "Layout wireframe" });
  const pic = wfEl("svg", { x: "0", y: "0", width: String(w), height: String(h), viewBox: "0 0 " + w + " " + h });
  pic.appendChild(wfEl("rect", { width: String(w), height: String(h), fill: wfColour(p.bg) }));
  for (const s of wfList(p.shapes, 24)) pic.appendChild(wfShape(s, p.stroke));
  const f = p.focal && typeof p.focal === "object" ? p.focal : null;
  if (f) pic.appendChild(wfEl("circle", { cx: wfNum(f.x, 0, 4000), cy: wfNum(f.y, 0, 4000), r: "6", fill: "none", stroke: "#1d1d1d", "stroke-width": "2" })).appendChild(wfEl("title", {}, "Focal point"));
  svg.appendChild(pic);
  svg.appendChild(wfEl("rect", { width: String(w), height: String(h), fill: "none", stroke: "#8a8a8a", "stroke-width": "1" }));
  const labels = wfList(p.labels, 24);
  for (const l of labels) {
    const d = Array.isArray(l.lead) ? l.lead.slice(0, 4) : [];
    if (d.length === 4) svg.appendChild(wfEl("line", { x1: wfNum(d[0], -100, 4000), y1: wfNum(d[1], -100, 4000), x2: wfNum(d[2], -100, 4000), y2: wfNum(d[3], -100, 4000), stroke: "#333333", "stroke-width": "1" }));
  }
  for (const l of labels) svg.appendChild(wfLabel(l));
  box.appendChild(svg);
  const legend = wfHtml("ul", "wf-legend", "");
  for (const k of wfList(p.legend, 12)) {
    const li = wfHtml("li", "", "");
    const sw = wfEl("svg", { width: "12", height: "12", viewBox: "0 0 12 12" });
    const c = wfColour(k.fill);
    sw.appendChild(wfEl("rect", { x: "1", y: "1", width: "10", height: "10", rx: "2", fill: k.outline === true ? "none" : c, stroke: k.outline === true ? c : wfColour(p.stroke), "stroke-width": k.outline === true ? "2" : "1" }));
    li.appendChild(sw);
    li.appendChild(wfHtml("span", "", wfText(k.text)));
    legend.appendChild(li);
  }
  box.appendChild(legend);
  box.appendChild(wfHtml("p", "wf-sum", wfText(p.summary)));
  const parts = wfList(p.parts, 12);
  if (parts.length) {
    const ul = wfHtml("ul", "wf-parts", "");
    for (const x of parts) {
      const li = wfHtml("li", "", "");
      li.appendChild(wfHtml("span", "wf-part", wfText(x.label)));
      li.appendChild(wfHtml("span", "", " - " + wfText(x.about)));
      ul.appendChild(li);
    }
    box.appendChild(ul);
  }
  if (p.details) box.appendChild(wfHtml("p", "meta wf-details", wfText(p.details)));
  return box;
}

function wireframeNode(wf) {
  const root = wfHtml("div", "wf-panels", "");
  for (const p of wfList(wf && wf.panels, 2)) root.appendChild(wfPanel(p));
  const wrap = wfHtml("div", "wf-wrap", "");
  wrap.appendChild(root);
  if (wf && wf.note) wrap.appendChild(wfHtml("p", "meta wf-note", wfText(wf.note)));
  return wrap;
}
`;

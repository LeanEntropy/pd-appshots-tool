/**
 * Draws an image's layout wireframe in the (i) popover from the checked data the server sends
 * (src/layout/wireframe-svg.ts), with DOM calls only: element and attribute names are fixed
 * here, numbers are re-checked, colours must be #rrggbb, and text goes in as textContent. The
 * layout's labels come from the model's reading of store screenshots, so nothing of it is ever
 * parsed as markup.
 */
export const WIREFRAME_SCRIPT = `
const WF_NS = "http://www.w3.org/2000/svg";
const wfNum = (v, lo, hi) => String(Math.round(Math.min(hi, Math.max(lo, typeof v === "number" && Number.isFinite(v) ? v : lo)) * 100) / 100);
const wfColour = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : "#b0bec5");
const wfText = (s) => (typeof s === "string" ? s.slice(0, 300) : "");

function wfEl(tag, attrs, text) {
  const el = document.createElementNS(WF_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  if (text) el.textContent = text;
  return el;
}

function wireframeNode(wf) {
  const viewH = wfNum(wf.viewH, 1, 1000);
  const svg = wfEl("svg", { class: "wireframe", viewBox: "0 0 100 " + viewH, width: wfNum(wf.width, 16, 2000), height: wfNum(wf.height, 1, 20000), role: "img", "aria-label": "Layout wireframe" });
  svg.appendChild(wfEl("rect", { width: "100", height: viewH, fill: "#f4f4f4", stroke: "#999", "stroke-width": "0.3" }));
  for (const s of Array.isArray(wf.shapes) ? wf.shapes.slice(0, 40) : []) {
    if (!s || typeof s !== "object") continue;
    const x = Number(wfNum(s.x, -100, 200)), y = Number(wfNum(s.y, -1000, 2000));
    const w = Number(wfNum(s.w, 0, 200)), h = Number(wfNum(s.h, 0, 2000));
    const rot = Number(wfNum(s.rot, -90, 90));
    const c = wfColour(s.colour);
    const g = wfEl("g", rot ? { transform: "rotate(" + rot + " " + wfNum(x + w / 2, -1000, 3000) + " " + wfNum(y + h / 2, -1000, 3000) + ")" } : {});
    g.appendChild(wfEl("title", {}, wfText(s.title)));
    const box = { x: String(x), y: String(y), width: String(w), height: String(h), fill: c, "fill-opacity": wfNum(s.fillOpacity, 0, 1), stroke: c, "stroke-width": "0.4" };
    if (s.dashed === true) box["stroke-dasharray"] = "1.2 0.8";
    g.appendChild(wfEl("rect", box));
    const label = wfText(s.label);
    if (label) g.appendChild(wfEl("text", { x: wfNum(x + 1, -100, 300), y: wfNum(y + Math.min(h - 0.6, 3.2), -1000, 3000), "font-size": "2.6", fill: "#1b1b1b" }, label));
    svg.appendChild(g);
  }
  const f = wf.focal || {};
  svg.appendChild(wfEl("circle", { cx: wfNum(f.x, 0, 100), cy: wfNum(f.y, 0, 1000), r: "1.6", fill: "none", stroke: "#111", "stroke-width": "0.5" }, "")).appendChild(wfEl("title", {}, "Focal point"));
  return svg;
}
`;

import type { LayoutMeasure } from "./measure/index.ts";
import type { Layout } from "./schema.ts";
import { type Wireframe, type WirePanel, wireframe } from "./wireframe-svg.ts";

/**
 * The two wireframe panels side by side as one SVG string, for pages built on the server
 * (benchmark pages). The gallery draws the same data with DOM calls (src/view/gallery-wireframe.ts).
 * Every value comes from wireframe(), already checked; text is escaped.
 */
const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const r = (v: number) => Math.round(v * 100) / 100;
const TOP = 20;

function panelSvg(p: WirePanel, dx: number): string {
  const out: string[] = [
    `<text x="${dx}" y="14" font-size="13" font-weight="bold" fill="#1d1d1d">${esc(p.title)}</text>`,
    `<svg x="${dx}" y="${TOP}" width="${p.w}" height="${p.h}" viewBox="0 0 ${p.w} ${p.h}">`,
    `<rect width="${p.w}" height="${p.h}" fill="${p.bg}"/>`,
  ];
  for (const s of p.shapes) {
    const paint = `fill="${s.outline ? "none" : s.fill}" stroke="${s.outline ? s.fill : s.stroke}" stroke-width="${s.outline ? 4 : 1.2}"${s.dashed ? ' stroke-dasharray="5 3"' : ""}`;
    const title = `<title>${esc(s.title)}</title>`;
    if (s.pts.length)
      out.push(`<polygon points="${s.pts.map(r).join(" ")}" ${paint}>${title}</polygon>`);
    else {
      const rot = s.rot
        ? ` transform="rotate(${s.rot} ${r(s.x + s.w / 2)} ${r(s.y + s.h / 2)})"`
        : "";
      out.push(
        `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx}"${rot} ${paint}>${title}</rect>`,
      );
    }
  }
  if (p.focal)
    out.push(
      `<circle cx="${p.focal.x}" cy="${p.focal.y}" r="6" fill="none" stroke="#1d1d1d" stroke-width="2"><title>Focal point</title></circle>`,
    );
  out.push("</svg>");
  out.push(
    `<rect x="${dx}" y="${TOP}" width="${p.w}" height="${p.h}" fill="none" stroke="#8a8a8a" stroke-width="1"/>`,
  );
  for (const l of p.labels) {
    const x = r(l.x + dx);
    const y = r(l.y + TOP);
    if (l.lead)
      out.push(
        `<line x1="${r(l.lead[0] ?? 0) + dx}" y1="${r((l.lead[1] ?? 0) + TOP)}" x2="${r((l.lead[2] ?? 0) + dx)}" y2="${r((l.lead[3] ?? 0) + TOP)}" stroke="#333333" stroke-width="1"/>`,
      );
    const rot = l.rot ? ` transform="rotate(${l.rot} ${r(x + l.w / 2)} ${r(y + l.h / 2)})"` : "";
    const chip = l.chip
      ? `<rect x="${x}" y="${y}" width="${r(l.w)}" height="${r(l.h)}" rx="3" fill="#ffffff" fill-opacity="0.9" stroke="#999999" stroke-width="0.6"/>`
      : "";
    const lines = l.lines.map(
      (t, i) =>
        `<text x="${r(x + 3)}" y="${r(y + 12 + i * 13)}" font-size="11" fill="#1d1d1d">${esc(t)}</text>`,
    );
    out.push(`<g${rot}>${chip}${lines.join("")}</g>`);
  }
  return out.join("");
}

export function renderWireframeSvg(wf: Wireframe): string {
  let dx = 0;
  const parts: string[] = [];
  let h = 0;
  for (const p of wf.panels) {
    parts.push(panelSvg(p, dx));
    dx += p.w + 16;
    h = Math.max(h, p.h + p.strip + TOP);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="wireframe" viewBox="0 0 ${r(dx - 16)} ${r(h)}" width="${r(dx - 16)}" height="${r(h)}" font-family="Arial, Helvetica, sans-serif" role="img" aria-label="Layout wireframes">${parts.join("")}</svg>`;
}

export function wireframeSvg(
  layout: Layout,
  size: { width: number; height: number },
  measure: LayoutMeasure | null = null,
  px?: number,
): string {
  return renderWireframeSvg(wireframe(layout, size, measure, px));
}

import type { MainDim } from "./group-dims.ts";

/**
 * Wireframe sketches for a finding (plan-cross-country 3.9, the free "schematic" brief): drawn by
 * code from the coarse facts only (orientation, title art, screenshot in art, layer size, logo),
 * labelled "schematic, not measured". No pixel measurement, no AI. Inline SVG in currentColor, so
 * it reads in light and dark pages and in print.
 */
type Box = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: "art" | "shot" | "band" | "logo" | "text";
};

const FILL: Record<Box["kind"], string> = {
  art: 'fill="currentColor" fill-opacity=".16"',
  shot: 'fill="currentColor" fill-opacity=".05" stroke="currentColor" stroke-dasharray="3 2"',
  band: 'fill="currentColor" fill-opacity=".32"',
  logo: 'fill="none" stroke="currentColor" stroke-width="1.5"',
  text: 'fill="currentColor" fill-opacity=".55"',
};

function frame(w: number, h: number, boxes: Box[], caption: string): string {
  const body = boxes
    .map(
      (b) =>
        `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="2" ${FILL[b.kind]}/>` +
        (b.label
          ? `<text x="${b.x + b.w / 2}" y="${b.y + b.h / 2 + 3}" font-size="8" text-anchor="middle" fill="currentColor">${b.label}</text>`
          : ""),
    )
    .join("");
  // One caption line per part ("image 1: title art", "schematic, not measured"), so it fits.
  const lines = caption.split(" · ");
  const H = h + 6 + lines.length * 9;
  const text = lines
    .map(
      (l, i) =>
        `<text x="${(w + 2) / 2}" y="${h + 11 + i * 9}" font-size="7" text-anchor="middle" fill="currentColor" fill-opacity=".75">${l}</text>`,
    )
    .join("");
  return `<svg class="sketch" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + 2} ${H}" width="${w + 2}" height="${H}" role="img" aria-label="${lines.join(", ")}"><rect x="1" y="1" width="${w}" height="${h}" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>${body}${text}</svg>`;
}

const P = { w: 90, h: 160 };

/** The layout the finding points to, as a labelled schematic. */
export function sketchSvg(
  dim: MainDim | "deckLength",
  caption = "schematic, not measured",
): string {
  const { w, h } = P;
  switch (dim) {
    case "titleArt":
      return frame(
        w,
        h,
        [
          { x: 4, y: 4, w: w - 6, h: h - 6, label: "", kind: "art" },
          { x: 20, y: 14, w: 52, h: 18, label: "logo", kind: "logo" },
          { x: 12, y: 38, w: 68, h: 8, label: "", kind: "text" },
          { x: 18, y: 80, w: 56, h: 40, label: "key art", kind: "art" },
        ],
        `image 1: title art · ${caption}`,
      );
    case "logo":
      return frame(
        w,
        h,
        [
          { x: 4, y: 4, w: w - 6, h: h - 6, label: "screenshot", kind: "shot" },
          { x: 8, y: 8, w: 36, h: 14, label: "logo", kind: "logo" },
          { x: 4, y: h - 34, w: w - 6, h: 32, label: "headline", kind: "band" },
        ],
        `logo in images 1-3 · ${caption}`,
      );
    case "inset":
      return frame(
        w,
        h,
        [
          { x: 4, y: 4, w: w - 6, h: h - 6, label: "", kind: "art" },
          { x: 10, y: 10, w: 70, h: 12, label: "headline", kind: "text" },
          { x: 16, y: 32, w: 58, h: 104, label: "screenshot", kind: "shot" },
        ],
        `screenshot inside art · ${caption}`,
      );
    case "largeLayer":
      return frame(
        w,
        h,
        [
          { x: 4, y: 4, w: w - 6, h: 108, label: "screenshot", kind: "shot" },
          { x: 4, y: 112, w: w - 6, h: 46, label: "layer 20%+", kind: "band" },
        ],
        `large marketing layer · ${caption}`,
      );
    case "landscape":
      return frame(
        160,
        90,
        [
          { x: 4, y: 4, w: 154, h: 84, label: "", kind: "art" },
          { x: 12, y: 10, w: 60, h: 12, label: "headline", kind: "text" },
          { x: 86, y: 8, w: 30, h: 76, label: "shot", kind: "shot" },
          { x: 122, y: 8, w: 30, h: 76, label: "shot", kind: "shot" },
        ],
        `landscape image · ${caption}`,
      );
    default: {
      const cells: Box[] = Array.from({ length: 7 }, (_, i) => ({
        x: 6 + (i % 4) * 20,
        y: 8 + Math.floor(i / 4) * 40,
        w: 16,
        h: 32,
        label: String(i + 1),
        kind: "shot" as const,
      }));
      return frame(w, 90, cells, `each screen once · ${caption}`);
    }
  }
}

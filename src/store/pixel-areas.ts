import type { Box } from "./pixel-diff.ts";

/** Grid cell (px at 320) for the changed areas; a cell counts with at least this many pixels. */
const CELL = 8;
const CELL_MIN = 3;
const MAX_AREAS = 16;
/** Changed areas: hot grid cells joined when touching (8 neighbours), as percent boxes. */
export function areasOf(diff: Uint8Array, w: number, h: number): Box[] {
  const cw = Math.ceil(w / CELL);
  const ch = Math.ceil(h / CELL);
  const count = new Uint16Array(cw * ch);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (diff[y * w + x]) {
        const c = Math.floor(y / CELL) * cw + Math.floor(x / CELL);
        count[c] = (count[c] ?? 0) + 1;
      }
  const seen = new Uint8Array(cw * ch);
  const out: (Box & { n: number })[] = [];
  for (let i = 0; i < count.length; i++) {
    if (seen[i] || (count[i] ?? 0) < CELL_MIN) continue;
    let x0 = cw;
    let y0 = ch;
    let x1 = -1;
    let y1 = -1;
    let n = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const c = stack.pop() as number;
      const cx = c % cw;
      const cy = Math.floor(c / cw);
      x0 = Math.min(x0, cx);
      y0 = Math.min(y0, cy);
      x1 = Math.max(x1, cx);
      y1 = Math.max(y1, cy);
      n += count[c] ?? 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const k = ny * cw + nx;
          if (!seen[k] && (count[k] ?? 0) >= CELL_MIN) {
            seen[k] = 1;
            stack.push(k);
          }
        }
    }
    const px = (v: number, total: number) => Math.round((1000 * v) / total) / 10;
    const bx = px(x0 * CELL, w);
    const by = px(y0 * CELL, h);
    out.push({
      x: bx,
      y: by,
      w: Math.min(100 - bx, px((x1 - x0 + 1) * CELL, w)),
      h: Math.min(100 - by, px((y1 - y0 + 1) * CELL, h)),
      n,
    });
  }
  return out
    .sort((a, b) => b.n - a.n)
    .slice(0, MAX_AREAS)
    .map(({ n: _n, ...b }) => b);
}

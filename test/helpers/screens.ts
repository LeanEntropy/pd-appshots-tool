import sharp from "sharp";

/**
 * Synthetic store screenshots for the "same screen uploaded twice" tests. Every screen shares one
 * background (a soft gradient) and one dark band at the bottom; the seed sets the game area
 * (coloured cards) and the headline (bright blocks on the band). 108x192 is a 1080x1920 screen at
 * a tenth of its size.
 */
function paint(seed: number, w: number, h: number, band: number): Buffer {
  const raw = Buffer.alloc(w * h * 3);
  const set = (x: number, y: number, v: number[]) => {
    const i = (y * w + x) * 3;
    raw[i] = v[0] ?? 0;
    raw[i + 1] = v[1] ?? 0;
    raw[i + 2] = v[2] ?? 0;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) set(x, y, [40 + (y * 120) / h, 60 + (x * 60) / w, 140]);
  // The game area: a 3 x 4 grid of cards, their shades set by the seed, from the top.
  const cw = Math.floor(w / 3);
  const ch = Math.floor(w / 3.2);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 3; c++) {
      const v = (seed * 67 + (r * 3 + c) * 41) % 200;
      for (let y = 8 + r * ch + 2; y < 8 + (r + 1) * ch - 2; y++)
        for (let x = c * cw + 2; x < (c + 1) * cw - 2; x++) {
          const edge = y % 7 < 2 || x % 9 < 2 ? 40 : 0;
          set(x, y, [(v + edge) % 255, (v * 3 + 90) % 255, (255 - v + edge) % 255]);
        }
    }
  // The band and its headline blocks.
  const top = h - band;
  for (let y = top; y < h; y++)
    for (let x = 0; x < w; x++) {
      const letter = Math.floor(x / 9);
      const on = y > top + 6 && y < h - 8 && x % 9 < 6 && (seed * 5 + letter * 3) % 4 !== 0;
      set(x, y, on ? [250, 230, 60] : [20, 20, 30]);
    }
  return raw;
}

/** A 1080x1920-shaped screen (108x192). */
export function screen(seed: number): Promise<Buffer> {
  return sharp(paint(seed, 108, 192, 40), { raw: { width: 108, height: 192, channels: 3 } })
    .png()
    .toBuffer();
}

/**
 * The same screen for a taller phone (1242x2688-shaped, 124x269): the same content at the new
 * width, with more of the game showing above the band (the band stays at the bottom).
 */
export async function tallScreen(seed: number): Promise<Buffer> {
  const w = 124;
  const h = 269;
  const base = await sharp(paint(seed, 108, 192, 40), {
    raw: { width: 108, height: 192, channels: 3 },
  })
    .resize(w, Math.round((192 * w) / 108))
    .raw()
    .toBuffer();
  const bh = Math.round((192 * w) / 108);
  const band = Math.round((40 * w) / 108);
  const extra = paint(seed + 1000, w, h, band);
  // Game area of the original at the top, then more of the game, then the band at the bottom.
  const out = Buffer.from(extra);
  base.copy(out, 0, 0, (bh - band) * w * 3);
  base.copy(out, (h - band) * w * 3, (bh - band) * w * 3, bh * w * 3);
  return sharp(out, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toBuffer();
}

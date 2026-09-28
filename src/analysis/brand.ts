import { normaliseText } from "./compare.ts";

/**
 * Store titles (user, 2026-09-28): a two-part title "[game name] - [ASO words]" or
 * "[game name]: [ASO words]" (also " – ", " — ", "|", full-width "：" and "｜") means the second
 * part is ASO keywords, very likely not in the in-game logo. The brand is the first part only;
 * logo and title matching use the brand, and the second part is keyword data.
 */
const SEPARATORS = /\s+[-–—]\s+|\s*[|｜：]\s*|:\s+/u;

export interface StoreTitle {
  brand: string;
  /** The ASO words after the separator, or null for a one-part title. */
  keywords: string | null;
}

export function splitStoreTitle(title: string): StoreTitle {
  const t = title.trim();
  const m = SEPARATORS.exec(t);
  if (!m || m.index === 0) return { brand: t, keywords: null };
  const brand = t.slice(0, m.index).trim();
  const keywords = t.slice(m.index + m[0].length).trim();
  if (!brand || !keywords) return { brand: brand || t, keywords: null };
  return { brand, keywords };
}

export const brandOf = (title: string) => splitStoreTitle(title).brand;

/**
 * True when a text names the game (brand only). Short brands (under 3 letters once normalised)
 * never match, so "io" or "2" cannot match everything.
 */
export function namesBrand(text: string, title: string): boolean {
  const b = normaliseText(brandOf(title));
  return b.length >= 3 && normaliseText(text).includes(b);
}

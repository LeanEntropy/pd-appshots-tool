import he from "he";
import { z } from "zod";

/**
 * The official store text and category of one store page, as Google Play shows it in one
 * country and language. Google Play has no keyword field: keywords are derived from this text
 * (src/analysis/keywords.ts) and always labelled as derived.
 */
export interface StoreOfficial {
  title: string | null;
  /** The short description under the title ("summary" in the scraper). */
  shortDescription: string | null;
  description: string | null;
  /** "What's new". Kept, but not used for keywords. */
  recentChanges: string | null;
  /** The official category (genre), e.g. { id: "GAME_ROLE_PLAYING", name: "Role Playing" }. */
  genre: { id: string | null; name: string | null };
  /**
   * The tag chips on the page, as returned. The first is usually a category (with an id; it can
   * differ from the genre), the rest are tags with a localised name and no id.
   */
  chips: { id: string | null; name: string }[];
  /** Differs by country (e.g. "Everyone 10+" in the US, "Rated for 7+" in the Philippines). */
  contentRating: string | null;
}

const text = z.string().nullish().catch(null);
// External boundary: every field optional, anything unexpected becomes "not available".
const Raw = z.object({
  title: text,
  summary: text,
  description: text,
  recentChanges: text,
  genre: text,
  genreId: text,
  contentRating: text,
  categories: z
    .array(z.object({ name: text, id: text }).catch({ name: null, id: null }))
    .nullish()
    .catch(null),
});

/** Plain text: HTML entities decoded, line breaks kept, other tags removed, blank = null. */
export function cleanText(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = he
    .decode(
      s
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/?(?:p|div|li|ul|ol|h[1-6]|tr|table|blockquote)\b[^>]*>/gi, "\n")
        .replace(/<[^>]*>/g, ""),
    )
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t || null;
}

/** The official fields of a google-play-scraper app() answer; null when it is not an object. */
export function officialFromApp(raw: unknown): StoreOfficial | null {
  const r = Raw.safeParse(raw);
  if (!r.success) return null;
  const d = r.data;
  const chips: StoreOfficial["chips"] = [];
  for (const c of d.categories ?? []) {
    const name = cleanText(c.name);
    if (name) chips.push({ id: c.id ?? null, name });
  }
  return {
    title: cleanText(d.title),
    shortDescription: cleanText(d.summary),
    description: cleanText(d.description),
    recentChanges: cleanText(d.recentChanges),
    genre: { id: d.genreId ?? null, name: cleanText(d.genre) },
    chips,
    contentRating: cleanText(d.contentRating),
  };
}

import {
  categoryOf,
  categoryOfType,
  type Definition,
  definitionOf,
  FULL_SCREEN_ART,
  HOW_WE_SORT,
} from "./categories.ts";
import { type ArtMessage, artMessage, showsLogo } from "./image-tags.ts";
import type { Labeler } from "./labels.ts";
import type { ImageAnalysis } from "./schema.ts";
import type { Recommendations } from "./synthesis-schema.ts";

/**
 * "How we sort images" (user rule, 2026-09-28): every screen category and tag the report uses,
 * with a one-line definition, what sets it apart, and one example thumbnail. By code.
 */
export interface SortedRow {
  position: number;
  imageId: string | null;
  thumb: string | null;
  file: string | null;
  category?: string | null;
  logo?: boolean | null;
  message?: ArtMessage | null;
}

export interface Example {
  name: string;
  position: number;
  imageId: string;
  thumb: string | null;
}

export interface SortingItem extends Definition {
  kind: "screen type" | "tag";
  example: (Example & { file: string | null }) | null;
}

export interface SortingPart {
  intro: string[];
  items: SortingItem[];
}

/** The row's screen, its category and tags, from one analysis. */
export function rowTags(
  f: ImageAnalysis | null,
  game: string,
  label: Labeler,
): { screen: string; category: string | null; logo: boolean | null; message: ArtMessage | null } {
  if (!f) return { screen: "", category: null, logo: null, message: null };
  const category = categoryOf(f);
  const art = category === FULL_SCREEN_ART;
  const logo = showsLogo(f, game);
  const message = art ? artMessage(f, game) : null;
  const sub = f.screenshot.subtype && !art ? ` / ${label(f.screenshot.subtype)}` : "";
  const tags = [art && message ? label(message).toLowerCase() : "", logo && !art ? "game logo" : ""]
    .filter(Boolean)
    .join(", ");
  return {
    screen: `${label(category)}${sub}${tags ? ` (${tags})` : ""}`,
    category,
    logo,
    message,
  };
}

interface Game {
  name: string;
  ours: boolean;
  rows: SortedRow[];
}

/** Competitor examples per recommended position: same category, nearest position first. */
export function recExamples(
  recs: Recommendations | null,
  games: readonly Game[],
): Record<string, Example[]> {
  const out: Record<string, Example[]> = {};
  if (!recs) return out;
  const theirs = games.filter((g) => !g.ours);
  for (const p of recs.positions) {
    const want = categoryOfType(p.screenType);
    const all = theirs.flatMap((g) =>
      g.rows
        .filter((r) => r.category === want && r.imageId)
        .map((r) => ({
          name: g.name,
          position: r.position,
          imageId: r.imageId as string,
          thumb: r.thumb,
        })),
    );
    all.sort((a, b) => Math.abs(a.position - p.position) - Math.abs(b.position - p.position));
    out[String(p.position)] = all.slice(0, 3);
  }
  return out;
}

/** Every defined category and tag seen in the report, each with its first competitor example. */
export function sortingPart(games: readonly Game[], recs: Recommendations | null): SortingPart {
  // Competitors first (then ours), in store order, so the example is a competitor's when it can.
  const ordered = [...games.filter((g) => !g.ours), ...games.filter((g) => g.ours)];
  const rows = ordered.flatMap((g) =>
    [...g.rows].sort((a, b) => a.position - b.position).map((r) => ({ g, r })),
  );
  const example = (hit: (r: SortedRow) => boolean): SortingItem["example"] => {
    const x = rows.find(({ r }) => r.imageId && hit(r));
    return x
      ? {
          name: x.g.name,
          position: x.r.position,
          imageId: x.r.imageId as string,
          thumb: x.r.thumb,
          file: x.r.file,
        }
      : null;
  };
  const cats = new Set<string>();
  for (const { r } of rows) if (r.category) cats.add(r.category);
  for (const p of recs?.positions ?? []) cats.add(categoryOfType(p.screenType));
  const items: SortingItem[] = [];
  for (const k of cats) {
    const d = definitionOf(k);
    if (d) items.push({ ...d, kind: "screen type", example: example((r) => r.category === k) });
  }
  const tag = (key: string, hit: (r: SortedRow) => boolean) => {
    const d = definitionOf(key);
    if (d && rows.some(({ r }) => hit(r))) items.push({ ...d, kind: "tag", example: example(hit) });
  };
  // The logo tag is always explained once images are analysed: a "no logo" finding uses it too.
  const logo = definitionOf("logo");
  if (logo && rows.some(({ r }) => r.logo !== null && r.logo !== undefined))
    items.push({ ...logo, kind: "tag", example: example((r) => r.logo === true) });
  const messages: ArtMessage[] = [
    "logo_only",
    "headline",
    "event_offer",
    "showcase",
    "picture_only",
  ];
  for (const m of messages) tag(m, (r) => r.message === m);
  const undefinedCats = [...cats].filter((k) => !definitionOf(k));
  const intro = [
    ...HOW_WE_SORT,
    ...(undefinedCats.length
      ? [
          `${undefinedCats.length} screen type${undefinedCats.length === 1 ? " has" : "s have"} no definition yet, so ${undefinedCats.length === 1 ? "it is" : "they are"} shown but never used for a finding.`,
        ]
      : []),
  ];
  return { intro, items };
}

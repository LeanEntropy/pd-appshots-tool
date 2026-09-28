import { z } from "zod";

/**
 * What Google Play answers, as the tool uses it: the shapes, the plain-language problem, and
 * the checked parsing of the scraper's answers (an external boundary, plan 3.2).
 */

/** A game's store details, as the wizard shows them on the confirmation card. */
export interface PlayDetails {
  appId: string;
  title: string;
  developer: string;
  genre: string;
  genreId: string;
  icon: string;
  installs: string;
  score: number | null;
  url: string;
  /** In a game category (charts need one). */
  isGame: boolean;
}

/** A country (and its language) used to read a game that is not on Google Play in the US. */
export interface Reference {
  gl: string;
  hl: string;
  label: string;
}

/** One search result: only what Google Play's search returns. */
export interface PlayHit {
  appId: string;
  title: string;
  developer: string;
  icon: string;
  score: number | null;
}

/** A failure the user can read (plan 3.5). */
export class PlayProblem extends Error {
  constructor(
    message: string,
    readonly kind: "unavailable" | "no-answer" | "unexpected" | "no-hits",
  ) {
    super(message);
  }
}

/** The scraper calls we use; tests inject a fake. */
export interface Scraper {
  app(o: { appId: string; lang: string; country: string }): Promise<unknown>;
  search(o: { term: string; num: number; lang: string; country: string }): Promise<unknown>;
}

// External boundary: only the fields we use, checked (plan 3.2).
const score = z.number().nullish().catch(null);
const DetailsRaw = z.object({
  appId: z.string().min(1),
  title: z.string().min(1),
  developer: z.string().default(""),
  genre: z.string().default(""),
  genreId: z.string().default(""),
  icon: z.string().default(""),
  installs: z.string().default(""),
  score,
  url: z.string().default(""),
});
const HitRaw = z.object({
  appId: z.string().min(1),
  title: z.string().min(1),
  developer: z.string().default(""),
  icon: z.string().default(""),
  score,
});
export const Cached = z.object({ fetchedAt: z.string(), value: z.unknown() });

/** A package ID as one storage key segment (package IDs use only letters, digits, "." and "_"). */
export const appSegment = (appId: string) => appId.replace(/_/g, "@");

export const DETAILS_HOURS = 24;
export const SEARCH_HOURS = 6;
export const NO_ANSWER = "Google Play did not answer. Try again in a minute.";
const UNEXPECTED = "Google Play answered in an unexpected way. Paste the game's link instead.";

/** Google Play shows the page but marks the game as not sold in the requested country. */
export function notSoldThere(raw: unknown): boolean {
  return !!raw && typeof raw === "object" && "available" in raw && raw.available === false;
}

export function status(e: unknown): number | undefined {
  return e && typeof e === "object" && "status" in e && typeof e.status === "number"
    ? e.status
    : undefined;
}

/** Logs what Google Play sent when it does not match (for the terminal, never the page). */
function unexpected(what: string, raw: unknown, issues: z.core.$ZodIssue[]): PlayProblem {
  const shape = Array.isArray(raw)
    ? `array of ${raw.length}, first item keys: ${Object.keys(raw[0] ?? {}).join(", ")}`
    : raw && typeof raw === "object"
      ? `keys: ${Object.keys(raw).slice(0, 40).join(", ")}`
      : typeof raw;
  const where = issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".")}: ${i.message}`)
    .join("; ");
  console.warn(`Google Play ${what} answer did not match (${where}). Shape: ${shape}`);
  return new PlayProblem(UNEXPECTED, "unexpected");
}

export function toDetails(raw: unknown): PlayDetails {
  const r = DetailsRaw.safeParse(raw);
  if (!r.success) throw unexpected("details", raw, r.error.issues);
  const d = r.data;
  return {
    appId: d.appId,
    title: d.title,
    developer: d.developer,
    genre: d.genre,
    genreId: d.genreId,
    icon: d.icon,
    installs: d.installs,
    score: d.score ?? null,
    url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(d.appId)}`,
    isGame: d.genreId.startsWith("GAME"),
  };
}

export function toHits(raw: unknown): PlayHit[] {
  const r = z.array(HitRaw).safeParse(raw);
  if (!r.success) throw unexpected("search", raw, r.error.issues);
  return r.data.map((h) => ({ ...h, score: h.score ?? null }));
}

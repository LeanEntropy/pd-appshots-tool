import type { LayoutBox, LayoutElement } from "./schema.ts";
import type { LayoutRole } from "./vocab.ts";

/** Plain words per role for the two wireframe panels (never the S1/M1 codes). */
export const WIRE_WORD: Record<LayoutRole, string> = {
  hud: "HUD",
  "nav-bar": "Tab bar",
  "main-scene": "Main scene",
  character: "Character",
  panel: "Panel",
  dialog: "Dialog",
  "game-text": "Game text",
  other: "Other",
  band: "Band",
  headline: "Headline",
  subline: "Subline",
  logo: "Logo",
  badge: "Badge",
  "cut-out": "Character cut-out",
  frame: "Frame / card",
  callout: "Callout",
  backdrop: "Backdrop",
};

const QUOTED: ReadonlySet<LayoutRole> = new Set([
  "headline",
  "subline",
  "logo",
  "badge",
  "callout",
  "game-text",
  "dialog",
]);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plain = (v: unknown, n: number) =>
  typeof v === "string" ? clip(v.replace(/\s+/g, " ").trim(), n) : "";

/** The text of an element as drawn (English meaning first), or "". */
export function textOf(e: LayoutElement): string {
  return plain(e.textEn, 60) || plain(e.text, 60);
}

/** Label of one box: "Headline: “BATTLE ON!”", "Band (tilted 5°)", "Cut-out: knight hero". */
export function labelOf(e: LayoutElement, role: LayoutRole, tilt: number, who = ""): string {
  if (role === "other") {
    const note = plain(e.note, 36);
    return note ? note.charAt(0).toUpperCase() + note.slice(1) : "Other";
  }
  const word = WIRE_WORD[role];
  const text = QUOTED.has(role) ? textOf(e) : "";
  if (text) return `${word}: “${text}”`;
  if (who) return `${role === "cut-out" ? "Cut-out" : word}: ${who}`;
  const t = Math.round(Math.abs(tilt));
  if (t >= 1 && (role === "band" || role === "cut-out" || role === "character"))
    return role === "band" ? `${word} (tilted ${t}°)` : `${word} (leaning ${t}°)`;
  return word;
}

/** What the analysis read about the image: the words for what the boxes leave out. */
export interface Reading {
  description?: unknown;
  elements?: unknown;
}
interface ReadElement {
  kind: string;
  what: string;
  region: LayoutBox;
}

function readElements(r: Reading | undefined): ReadElement[] {
  const xs: unknown[] = Array.isArray(r?.elements) ? r.elements : [];
  return xs.filter((x): x is ReadElement => {
    const o = x as Partial<ReadElement> | null;
    return (
      !!o &&
      typeof o === "object" &&
      typeof o.kind === "string" &&
      typeof o.what === "string" &&
      !!o.region &&
      typeof o.region === "object"
    );
  });
}

function overlap(a: LayoutBox, b: LayoutBox): number {
  const f = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const w = Math.min(f(a.x) + f(a.w), f(b.x) + f(b.w)) - Math.max(f(a.x), f(b.x));
  const h = Math.min(f(a.y) + f(a.h), f(b.y) + f(b.h)) - Math.max(f(a.y), f(b.y));
  const inter = Math.max(0, w) * Math.max(0, h);
  const union = f(a.w) * f(a.h) + f(b.w) * f(b.h) - inter;
  return union > 0 ? inter / union : 0;
}

const WHO_KINDS = new Set(["character", "creature", "item"]);

/** The analysis' character, creature or item element over the same place as a cut-out. */
function matchOf(e: LayoutElement, role: LayoutRole, reading?: Reading): ReadElement | null {
  if (role !== "cut-out" || !e.box) return null;
  let best: ReadElement | null = null;
  let score = 0.2;
  for (const x of readElements(reading)) {
    const o = WHO_KINDS.has(x.kind) ? overlap(e.box, x.region) : 0;
    if (o > score) {
      best = x;
      score = o;
    }
  }
  return best;
}

/** "the red chibi dragon monster with open jaws" -> "red chibi dragon monster". */
const short = (s: string) =>
  s
    .replace(/^(the|a|an) /i, "")
    .split(/[,;:(]| - | with | holding | in | on | over | and /i)[0]
    ?.trim() ?? "";

/** What a box is in a few words ("hero", "gear card"): its note, or the analysis' element there. */
export function whoOf(e: LayoutElement, role: LayoutRole, reading?: Reading): string {
  if (role === "other") return "";
  const note = plain(e.note, 200);
  if (note) return plain(short(note), 30);
  const m = matchOf(e, role, reading);
  return m ? plain(short(m.what), 30) : "";
}

/**
 * The words that go with one box (who it is, colours, expression, costume, pose): kept in text
 * next to the wireframe, never drawn. From its note and, for a cut-out, the analysis' element.
 */
export function aboutOf(e: LayoutElement, role: LayoutRole, reading?: Reading): string {
  const parts = [plain(e.note, 200)];
  const m = matchOf(e, role, reading) as
    | (ReadElement & { pose?: unknown; colours?: unknown })
    | null;
  if (m) {
    parts.push(plain(m.what, 120));
    const pose = plain(m.pose, 80);
    if (pose && pose !== "n/a") parts.push(`pose: ${pose}`);
    const colours = plain(m.colours, 80);
    if (colours) parts.push(`colours: ${colours}`);
  }
  const text = QUOTED.has(role) ? "" : textOf(e);
  if (text) parts.push(`text “${text}”`);
  const s = [...new Set(parts.filter(Boolean))].join("; ");
  // Nothing to add when it only repeats the label.
  return s && s !== whoOf(e, role, reading) ? clip(s, 260) : "";
}

/** Words for one layer's details: what the analysis read, plus what is not drawn as a box. */
export function detailsOf(
  kind: "screenshot" | "marketing",
  left: LayoutElement[],
  reading?: Reading,
): string {
  const parts: string[] = [];
  const desc = kind === "screenshot" ? plain(reading?.description, 240) : "";
  if (kind === "marketing")
    for (const x of readElements(reading))
      if (x.kind === "effect" || x.kind === "ui_element" || x.kind === "other")
        parts.push(plain(x.what, 60));
  for (const e of left) {
    const t = e.role === "game-text" ? textOf(e) : "";
    const n = t ? `text “${t}”` : plain(e.note, 60);
    if (n) parts.push(n);
  }
  const also = [...new Set(parts.filter(Boolean))].join("; ");
  return [desc, also ? `Not drawn: ${clip(also, 240)}.` : ""].filter(Boolean).join(" ");
}

const FRACTIONS: [number, string][] = [
  [20, "fifth"],
  [25, "quarter"],
  [33.3, "third"],
  [50, "half"],
  [66.7, "two thirds"],
  [75, "three quarters"],
];

function share(p: number): string {
  const best = FRACTIONS.reduce((a, b) => (Math.abs(b[0] - p) < Math.abs(a[0] - p) ? b : a));
  return Math.abs(best[0] - p) <= 4 ? best[1] : `${Math.round(p)}%`;
}

/** Where a box sits, in words: "across the bottom fifth", "at the top right". */
export function whereOf(b: LayoutBox): string {
  const y0 = Math.max(0, b.y);
  const y1 = Math.min(100, b.y + b.h);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  if (b.w >= 85) {
    if (y1 - y0 >= 90) return "over the whole image";
    if (y0 <= 6) return `across the top ${share(y1)}`;
    if (y1 >= 94) return `across the bottom ${share(100 - y0)}`;
    if (cy < 40) return "across the upper part";
    return cy > 60 ? "across the lower part" : "across the middle";
  }
  const v = cy < 36 ? "top" : cy > 64 ? "bottom" : "";
  const h = cx < 36 ? "left" : cx > 64 ? "right" : "";
  if (!v && !h) return "in the centre";
  if (!v) return `on the ${h}`;
  return `at the ${v}${h ? ` ${h}` : ""}`;
}

const area = (b: LayoutBox) => Math.max(0, b.w) * Math.max(0, b.h);
const lower = (s: string) => (s === "HUD" ? s : s.charAt(0).toLowerCase() + s.slice(1));

/** One plain sentence per layer, biggest parts first (at most five). */
export function layerSummary(
  kind: "screenshot" | "marketing",
  items: { e: LayoutElement; role: LayoutRole; tilt: number; who: string }[],
  coverage: { percent: number; measured: boolean } | null,
): string {
  if (!items.length)
    return kind === "screenshot" ? "No screen regions saved." : "No marketing layer.";
  const parts = [...items]
    .sort((a, b) => area(b.e.box) - area(a.e.box))
    .slice(0, 4)
    .map(({ e, role, tilt, who }) => {
      const t = Math.round(Math.abs(tilt));
      const text = role === "headline" ? textOf(e) : "";
      const what =
        role === "band" && t >= 1
          ? `tilted band (${t}°)`
          : text
            ? `headline “${text}”`
            : lower(role === "other" ? labelOf(e, role, 0) : WIRE_WORD[role]) +
              (who ? ` (${who})` : "");
      return `${what} ${whereOf(e.box)}`;
    });
  let s = parts.join("; ");
  s = `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
  if (kind === "marketing" && coverage && coverage.percent > 0)
    s += ` Covers ${coverage.measured ? "up to" : "about"} ${Math.round(coverage.percent)}% of the image.`;
  return s;
}

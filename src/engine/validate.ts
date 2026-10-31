import { categoryOfType, isArtCategory, PROMO_BANNER } from "../analysis/categories.ts";
import type { Recommendations } from "../analysis/synthesis-schema.ts";
import { isFirm } from "./directives.ts";
import type { EngineResult } from "./engine.ts";
import { type Kind, kindOfType } from "./kinds.ts";
import { chars, LIMITS } from "./rules-meta.ts";

/**
 * Validators after the AI (plan 5.6): the recommendations must follow the skeleton, keep no
 * dropped image, give every COPY its spec's orientation and logo, and quote only counts the code
 * computed. A/B tests may not move away from a directive. Store text lengths are counted here.
 * Failures go to the existing single repair retry, then the code's own text is shown.
 */
export interface Claim {
  n: number;
  M: number;
  position?: number;
  kind?: Kind;
  /** An orientation count: it backs a sentence about orientation only. */
  canvas?: boolean;
}

/** A claim backs a sentence when the counts match and so do the image and the kind it names. */
function backs(c: Claim, n: number, M: number, pos?: number, kind?: Kind, canvas = false): boolean {
  if (c.n !== n || c.M !== M) return false;
  if (c.canvas && !canvas) return false;
  if (
    pos !== undefined &&
    c.position !== pos &&
    !(c.position === undefined && kind && c.kind === kind)
  )
    return false;
  if (kind !== undefined && c.kind !== kind && !(c.canvas && canvas)) return false;
  return true;
}

/** The kind of a recommended slot, from its taxonomy type, subtype and orientation. */
export function recKind(p: Recommendations["positions"][number], ourCanvas: string): Kind {
  const cat = categoryOfType(p.screenType);
  const art = isArtCategory(cat) || p.screenType === "promo" || p.screenType === "feature_image";
  if (art && p.screenshot.orientation !== ourCanvas) return kindOfType(PROMO_BANNER, p.subtype);
  return kindOfType(art ? "full_screen_art" : cat, p.subtype);
}

const KEEP = /keep our current position (\d+)/i;
const RECAP = /recapture our position (\d+)/i;

export function skeletonProblems(r: Recommendations, e: EngineResult, ourCanvas: string): string[] {
  const out: string[] = [];
  const sk = e.skeleton;
  const pos = r.positions.map((p) => p.position).sort((a, b) => a - b);
  if (pos.join(",") !== sk.map((s) => s.position).join(","))
    out.push(
      `the target deck has ${sk.length} images, positions ${sk.map((s) => s.position).join(", ")} (got ${pos.join(", ") || "none"}); a screen not captured yet is a capture to make, never a reason to drop a slot`,
    );
  const dropped = new Set(
    e.directives.filter((d) => isFirm(d) && d.kind === "DROP").flatMap((d) => d.positions),
  );
  for (const p of r.positions) {
    const kept = Number(KEEP.exec(p.source)?.[1] ?? RECAP.exec(p.source)?.[1] ?? 0);
    if (kept && dropped.has(kept))
      out.push(`position ${p.position}: it keeps our image ${kept}, which the directives drop`);
    const s = sk.find((x) => x.position === p.position);
    if (!s) continue;
    const k = recKind(p, ourCanvas);
    const flexible = s.kind === "content_showcase" || s.kind === "lifestyle";
    if (k !== s.kind && !flexible)
      out.push(
        `position ${p.position}: the skeleton asks for ${s.kindLabel.toLowerCase()} (got ${k.replace(/_/g, " ")})`,
      );
    if (p.screenshot.orientation !== s.canvas)
      out.push(
        `position ${p.position}: the skeleton asks for a ${s.canvas} image (got ${p.screenshot.orientation})`,
      );
    const reuses = KEEP.test(p.source) || RECAP.test(p.source);
    if (s.action === "new marketing art" && reuses)
      out.push(
        `position ${p.position}: new marketing art built from our assets, never a recapture or a kept screen`,
      );
    if (s.action === "new capture" && reuses)
      out.push(
        `position ${p.position}: the skeleton asks for a new capture, not our current image`,
      );
    if ((s.action === "keep" || s.action === "recapture") && kept !== s.from)
      out.push(
        `position ${p.position}: the skeleton ${s.action === "keep" ? "keeps" : "recaptures"} our image ${s.from} ("${s.action === "keep" ? "keep our current" : "recapture our"} position ${s.from}")`,
      );
    const logo = (p as Partial<typeof p>).logo;
    if (logo && logo.show !== s.logo)
      out.push(`position ${p.position}: the skeleton says logo ${s.logo ? "yes" : "no"}`);
  }
  return out;
}

const KIND_WORDS: [RegExp, Kind][] = [
  [/full[- ]screen art|title (?:screen|art|image)|key art/i, "title_art"],
  [/banner/i, "promo_banner"],
  [/victory|defeat|result|reward/i, "result_reward"],
  [/gameplay|board|battle/i, "core_play"],
  [/lifestyle|in[- ]context/i, "lifestyle"],
  [/showcase/i, "content_showcase"],
];

/** Every "N of M" in the AI's text must be one the code computed (in the same context). */
export function claimProblems(texts: readonly string[], claims: readonly Claim[]): string[] {
  const out: string[] = [];
  for (const t of texts)
    for (const s of t.split(/(?<=[.;!?])\s+/)) {
      const pos = Number(/\b(?:image|position|slot)\s+(\d+)/i.exec(s)?.[1] ?? 0) || undefined;
      const kind = KIND_WORDS.find(([re]) => re.test(s))?.[1];
      for (const m of s.matchAll(/\b(\d+)\s+of\s+(\d+)\b/g)) {
        const n = Number(m[1]);
        const M = Number(m[2]);
        const canvas = /portrait|landscape|orientation/i.test(s);
        const ok = claims.some((c) => backs(c, n, M, pos, kind, canvas));
        if (!ok) out.push(`"${m[0]}" in "${s.slice(0, 120)}" matches no computed count`);
      }
    }
  return out;
}

/** The AI recommendation's own free text, for the claim check. */
export const recTexts = (r: Recommendations) => [
  r.rationale,
  ...r.positions.flatMap((p) => [p.why, (p as Partial<typeof p>).logo?.why ?? ""]),
];

export interface AbSlot {
  position: number;
  fromOurPosition: number;
  orientation: string;
  changes: readonly string[];
}

/** A test variant may not move away from a directive (C12: opening on gameplay is rejected). */
export function abDirectionProblems(slots: readonly AbSlot[], e: EngineResult): string[] {
  const out: string[] = [];
  const firm = e.directives.filter(isFirm);
  const dropped = new Set(firm.filter((d) => d.kind === "DROP").flatMap((d) => d.positions));
  for (const s of slots) {
    const changed = s.changes.length > 0 || s.fromOurPosition !== s.position;
    if (!changed) continue;
    const d = firm.find(
      (x) => (x.kind === "COPY" || x.kind === "ORIENT") && x.positions[0] === s.position,
    );
    const want = d?.spec?.canvas;
    if (want && s.orientation !== want)
      out.push(
        `image ${s.position}: ${d?.id} asks for a ${want} image here; this variant moves away from it`,
      );
    // A changed or moved slot built on an image the directives drop goes the wrong way.
    if (dropped.has(s.fromOurPosition) && !s.changes.includes("screen"))
      out.push(
        `image ${s.position}: it builds on our image ${s.fromOurPosition}, which the directives drop`,
      );
    // Marketing art is a new image: a variant that only re-dresses our current one is not it.
    if (
      d?.spec?.source === "marketing_art" &&
      s.fromOurPosition > 0 &&
      !s.changes.includes("screen")
    )
      out.push(
        `image ${s.position}: ${d.id} asks for new marketing art here, not a re-dressed current image`,
      );
  }
  return out;
}

const SPAM = /#\s?1\b|\bnumber one\b|\bbest\b|\btop[- ]?\d+\b|% off|\bsale\b|\bdiscount\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;

/** Store text checks by code (plan 5.6-7): length in characters, no ranking claims or emoji. */
export function metaTextProblems(field: keyof typeof LIMITS, text: string): string[] {
  const out: string[] = [];
  const n = chars(text);
  if (n > LIMITS[field]) out.push(`${field}: ${n} characters, the limit is ${LIMITS[field]}`);
  if (SPAM.test(text)) out.push(`${field}: no ranking, price or promotion claims`);
  if (field !== "description" && EMOJI.test(text)) out.push(`${field}: no emoji`);
  if (/\b[A-Z]{4,}\b.*\b[A-Z]{4,}\b.*\b[A-Z]{4,}\b/.test(text))
    out.push(`${field}: no capital-letter spam`);
  return out;
}

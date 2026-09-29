import type { ImageAnalysis } from "../analysis/schema.ts";
import type { Layout, LayoutElement } from "./schema.ts";
import { FOCUS_MATCH, type LayoutRole } from "./vocab.ts";
import { list, roleOf } from "./wireframe-items.ts";
import { WIRE_WORD, whoOf } from "./wireframe-words.ts";

/** What the screenshot highlights, what the marketing layer hides, and whether they agree. */
export interface FocusView {
  focus: string;
  covers: string;
  /** match / partial / mismatch / no marketing layer, or "" when the saved layout predates it. */
  verdict: string;
  match: string;
}

const str = (v: unknown, n: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "";
const words = (s: string) => s.replace(/_/g, " ");

function name(e: LayoutElement): string {
  const role: LayoutRole = roleOf(e.role);
  const who = whoOf(e, role);
  const word = role === "hud" ? "HUD" : WIRE_WORD[role].toLowerCase();
  return who ? `${word} (${who})` : word;
}

/** Hidden vs visible, from the saved `covers` ids (code only, for layouts that do not say it). */
function coversFromIds(l: { inGame: LayoutElement[]; marketing: LayoutElement[] }): string {
  const hidden = new Set(l.marketing.flatMap((e) => (Array.isArray(e.covers) ? e.covers : [])));
  if (!l.marketing.length) return "";
  const named = (xs: LayoutElement[]) => [...new Set(xs.map(name))].join(", ");
  const inGame = l.inGame.filter(
    (e) => roleOf(e.role) !== "other" && roleOf(e.role) !== "game-text",
  );
  const hid = named(inGame.filter((e) => hidden.has(e.id)));
  const kept = named(inGame.filter((e) => !hidden.has(e.id)));
  if (!hid) return "Hides no screen region the layout names.";
  return `Hides part of: ${hid}.${kept ? ` Leaves visible: ${kept}.` : ""}`;
}

/**
 * The focus lines of an image's layout. A layout.v3 answer says them itself; an older saved
 * layout gets the analysis' screen type and the covered regions worked out from its `covers`
 * ids, and says that the focus match was not judged.
 */
export function focusView(saved: Layout, final: ImageAnalysis | null): FocusView {
  const l = { ...saved, inGame: list(saved.inGame), marketing: list(saved.marketing) };
  const c: Partial<Layout["composition"]> = l.composition ?? {};
  const f = c.focus;
  const m = c.focusMatch;
  const verdict = m && (FOCUS_MATCH as readonly string[]).includes(m.verdict) ? m.verdict : "";
  const s = final?.screenshot;
  const screen = s ? words([s.screenType, s.subtype].filter(Boolean).join(" / ")) : "";
  const head = final?.marketingLayer.texts.find((t) => t.role === "headline")?.text ?? "";
  return {
    focus:
      f && str(f.kind, 40)
        ? `${str(f.kind, 40)}${str(f.words, 80) ? `: ${str(f.words, 80)}` : ""}`
        : screen
          ? `Screen type ${screen} (from the analysis; this layout was saved before focus was asked)`
          : "",
    covers: str(c.marketingCovers, 120) || coversFromIds(l),
    verdict,
    match: verdict
      ? `${verdict}${str(m?.reason, 120) ? `: ${str(m?.reason, 120)}` : ""}`
      : l.marketing.length
        ? `Not judged for this saved layout.${head ? ` Headline “${str(head, 80)}” on a ${screen || "screen"} screen.` : ""}`
        : "No marketing layer.",
  };
}

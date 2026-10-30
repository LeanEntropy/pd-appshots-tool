import { lines } from "../analysis/image-tags.ts";
import type { DeckEntry } from "../analysis/patterns.ts";
import { dominantBy, type EngineCtx, kindKey, MIN_GAMES, perGame } from "./context.ts";
import { byRank, type Directive, isFirm, type SlotSpec } from "./directives.ts";
import { KIND_LABEL, type Kind, kindOf, SOURCE_LABEL, sourceOf } from "./kinds.ts";
import { specFrom } from "./spec.ts";
import { mechanicOnly, type Theme, themeLabel } from "./themes.ts";

/**
 * The deck builder (plan 5.4): applies the directives to our deck and gives the target skeleton,
 * slot by slot. Conflicts are resolved in rank order. Every dropped image and every new slot is
 * filled from the competitors' own images at that position (kind, orientation, source, logo),
 * so each replacement is position-compatible and has a full spec; the missing benefit themes
 * are spread over the new and replaced slots, one each, so no two replacements are the same.
 */
export type SlotAction = "keep" | "copy" | "recapture" | "new capture" | "new marketing art";

export interface Slot {
  position: number;
  kind: Kind;
  kindLabel: string;
  canvas: string;
  size: string;
  source: string;
  logo: boolean;
  themes: string[];
  action: SlotAction;
  /** Our current image it keeps or rebuilds, if any. */
  from: number | null;
  directiveIds: string[];
  spec: SlotSpec | null;
  why: string;
}

/** Kinds the competitors show only as their first image (never placed later). */
function openerOnly(ctx: EngineCtx): Set<Kind> {
  const at = new Map<Kind, Set<number>>();
  for (const e of ctx.theirs) {
    const k = kindKey(e);
    at.set(k, (at.get(k) ?? new Set()).add(e.position));
  }
  return new Set([...at].filter(([, ps]) => ps.size === 1 && ps.has(1)).map(([k]) => k));
}

/** The competitors' pattern at a new or replaced slot: their most common kind there. */
function fillAt(ctx: EngineCtx, p: number, taken: Set<string>, opener: Set<Kind>): SlotSpec | null {
  let at = perGame(ctx.theirs, p);
  if (at.length < MIN_GAMES) at = [...ctx.theirs];
  const usable = at.filter((e) => p === 1 || !opener.has(kindKey(e)));
  const kind = dominantBy(usable, kindKey, ctx.leaders);
  if (!kind) return null;
  const canvas = dominantBy(kind.doers, (e) => e.canvas, ctx.leaders);
  const doers = canvas ? canvas.doers : kind.doers;
  const spec = specFrom(doers, { kind: kind.key });
  // A second identical replacement takes the next pattern instead (unique replacements).
  const key = `${spec.kind}|${spec.canvas}|${p}`;
  if (taken.has(key)) return null;
  taken.add(key);
  return spec;
}

const slotOf = (
  p: number,
  spec: SlotSpec,
  action: SlotAction,
  from: number | null,
  ids: string[],
  why: string,
): Slot => ({
  position: p,
  kind: spec.kind,
  kindLabel: spec.kindLabel,
  canvas: spec.canvas,
  size: spec.size,
  source: SOURCE_LABEL[spec.source],
  logo: spec.logo,
  themes: [...spec.themes],
  action,
  from,
  directiveIds: ids,
  spec,
  why,
});

function ourSlot(o: DeckEntry, ids: string[]): Slot {
  const k = kindOf(o).kind;
  const src = sourceOf(o, k);
  return {
    position: o.position,
    kind: k,
    kindLabel: KIND_LABEL[k],
    canvas: o.canvas,
    size: o.size ?? "",
    source: SOURCE_LABEL[src],
    logo: false,
    themes: [],
    action: "keep",
    from: o.position,
    directiveIds: ids,
    spec: null,
    why: lines(o.final, o.name)[0]
      ? `our image ${o.position} ("${lines(o.final, o.name)[0]}")`
      : `our image ${o.position}`,
  };
}

export function buildSkeleton(ctx: EngineCtx, directives: Directive[], target: number): Slot[] {
  const firm = directives.filter(isFirm).sort(byRank);
  const at = (p: number, kind: Directive["kind"]) =>
    firm.find((d) => d.kind === kind && d.positions[0] === p);
  const dropped = new Set(firm.filter((d) => d.kind === "DROP").flatMap((d) => d.positions));
  const taken = new Set<string>();
  const opener = openerOnly(ctx);
  const slots: Slot[] = [];
  for (let p = 1; p <= target; p++) {
    const copy = at(p, "COPY");
    const o = ctx.ours.find((e) => e.position === p);
    const drop = at(p, "DROP");
    if (copy?.spec) {
      const art = copy.spec.source === "marketing_art";
      taken.add(`${copy.spec.kind}|${copy.spec.canvas}|${p}`);
      slots.push(
        slotOf(
          p,
          copy.spec,
          art ? "new marketing art" : "new capture",
          null,
          [copy.id, ...(drop ? [drop.id] : [])],
          `copies ${copy.id}`,
        ),
      );
      continue;
    }
    if (o && !dropped.has(p)) {
      const mods = firm.filter((d) => d.positions[0] === p && d.kind !== "DROP");
      const s = ourSlot(
        o,
        mods.map((d) => d.id),
      );
      const orient = mods.find((d) => d.kind === "ORIENT");
      if (orient?.spec) {
        s.canvas = orient.spec.canvas;
        s.size = orient.spec.size;
      }
      if (mods.some((d) => d.kind === "ORIENT" || d.kind === "RECAPTURE" || d.kind === "RELAYER"))
        s.action = s.source === SOURCE_LABEL.marketing_art ? "new marketing art" : "recapture";
      if (lines(o.final, o.name).some(mechanicOnly) || mods.some((d) => d.kind === "MESSAGE"))
        s.themes = ["(benefit to assign)"];
      slots.push(s);
      continue;
    }
    const spec = fillAt(ctx, p, taken, opener);
    const orient = at(p, "ORIENT");
    if (!spec) continue;
    if (orient?.spec && orient.spec.canvas !== spec.canvas) {
      spec.canvas = orient.spec.canvas;
      spec.size = orient.spec.size;
    }
    const art = spec.source === "marketing_art";
    const ids = [drop?.id, orient?.id].filter((x): x is string => !!x);
    slots.push(
      slotOf(
        p,
        spec,
        art ? "new marketing art" : "new capture",
        null,
        ids,
        drop ? `replaces dropped image ${p}` : `new image ${p}`,
      ),
    );
  }
  assignThemes(slots, directives);
  for (const d of firm.filter((x) => x.kind === "DROP")) {
    const s = slots.find((x) => x.position === d.positions[0] && x.action !== "keep");
    if (s?.spec) d.replacement = s.spec;
  }
  // A DROP left without a replacement is not a valid directive: it becomes a test.
  for (const d of firm.filter((x) => x.kind === "DROP" && !x.replacement)) {
    d.level = "test";
    d.notes.push("no position-compatible replacement: test it first");
  }
  return slots;
}

/** The missing benefit themes, one per new, replaced or mechanic-line slot, in rank order. */
function assignThemes(slots: Slot[], directives: Directive[]): void {
  const missing = directives
    .filter((d) => d.kind === "MESSAGE" && d.themes?.length && d.level !== "consider")
    .sort(byRank)
    .flatMap((d) => (d.themes ?? []).map((t) => ({ t: t as Theme, id: d.id })));
  const open = slots.filter((s) => s.action !== "keep" || s.themes[0] === "(benefit to assign)");
  const used = new Set<string>();
  const own = new Map(open.map((s) => [s, s.themes.filter((t) => t !== "(benefit to assign)")]));
  // First a slot whose exemplars already carry a missing theme keeps it.
  for (const s of open) {
    const hit = missing.find((m) => !used.has(m.t) && s.themes.includes(m.t));
    s.themes = hit ? [hit.t] : [];
    if (hit) {
      used.add(hit.t);
      s.directiveIds.push(hit.id);
    }
  }
  for (const s of open.filter((x) => !x.themes.length)) {
    const next = missing.find((m) => !used.has(m.t));
    // No missing benefit left: the slot keeps its exemplars' own theme.
    if (!next) {
      s.themes = (own.get(s) ?? []).slice(0, 1);
      continue;
    }
    used.add(next.t);
    s.themes = [next.t];
    s.directiveIds.push(next.id);
  }
  for (const s of slots) s.themes = s.themes.filter((t) => t !== "(benefit to assign)");
  for (const s of open)
    if (s.spec) {
      const f = s.spec.fields.find((x) => x.label === "Headline theme");
      if (f)
        f.value = s.themes.length
          ? s.themes.map((t) => themeLabel(t as Theme) ?? t).join("; ")
          : f.value;
      s.spec = { ...s.spec, themes: [...s.themes] };
    }
}

/**
 * Directives that pull one slot two ways (plan 8-I): a REORDER into a slot that a higher-ranked
 * COPY, DROP or ORIENT already sets is overruled and becomes a test, with a note.
 */
export function resolveConflicts(directives: Directive[]): void {
  const firm = directives.filter(isFirm).sort(byRank);
  for (const r of firm.filter((d) => d.kind === "REORDER")) {
    const to = r.positions[1];
    const win = firm.find(
      (d) =>
        d !== r &&
        ["COPY", "DROP", "ORIENT"].includes(d.kind) &&
        d.positions[0] === to &&
        d.rank >= r.rank,
    );
    if (!win) continue;
    r.level = "test";
    r.notes.push(`overruled by ${win.id} (higher rank) at image ${to}`);
  }
}

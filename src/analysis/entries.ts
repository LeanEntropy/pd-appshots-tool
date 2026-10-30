import type { ProjectPaths } from "../config/load.ts";
import type { ImageAttributes } from "../engine/attributes.ts";
import type { ImageDb } from "../store/imagedb.ts";
import { stableHash } from "../util/hash.ts";
import { type DeckRepeats, repeatsOfItems, sameCheck, theirRepeatNote } from "./deck-repeats.ts";
import { orientationOf, ratioLabel } from "./image-facts.ts";
import type { DeckEntry } from "./patterns.ts";
import type { AnalysisPlan } from "./plan.ts";
import { type AnalysisRecord, isUsable } from "./records.ts";

export interface BatchEntries {
  ours: DeckEntry[];
  competitors: DeckEntry[];
  /** deckLength counts each screen once; images and a note when the deck repeats screens. */
  decks: { appId: string; name: string; deckLength: number; images?: number; repeats?: string }[];
  ourDeckLength: number;
  /** Plan positions without a usable analysis, e.g. "Archero 2 #3". */
  missing: string[];
}

/**
 * Every analysed screenshot of the batch's games in store order, ours separated (by code). A
 * screen a deck shows twice (`repeats`) is counted once: its repeat is left out.
 */
export function batchEntries(
  plan: AnalysisPlan,
  records: ReadonlyMap<string, AnalysisRecord>,
  db: Pick<ImageDb, "get">,
  ourAppId: string,
  repeats: ReadonlyMap<string, DeckRepeats> = new Map(),
  /** What each image highlights (its saved layout's focus kind), when known. */
  focusOf?: (imageId: string) => string | null,
  /** Engine attributes per image (engine/attributes.ts), when known. */
  attrsOf?: (imageId: string) => ImageAttributes | null,
): BatchEntries {
  const out: BatchEntries = { ours: [], competitors: [], decks: [], ourDeckLength: 0, missing: [] };
  for (const g of plan.games) {
    const r = repeats.get(g.appId);
    const copies = new Set(r?.pairs.map((p) => p.position));
    for (const position of g.positions) {
      if (copies.has(position)) continue;
      const item = plan.items.find((i) => i.appId === g.appId && i.position === position);
      const r = item ? records.get(item.imageId) : undefined;
      if (!item || !isUsable(r)) {
        out.missing.push(`${g.name} #${position}`);
        continue;
      }
      const rec = db.get(item.imageId);
      const entry: DeckEntry = {
        appId: g.appId,
        name: g.name,
        position,
        gl: item.gl,
        hl: item.hl,
        imageId: item.imageId,
        canvas: orientationOf(rec?.width ?? 0, rec?.height ?? 0),
        ...(rec?.width && rec.height
          ? { ratio: ratioLabel(rec.width, rec.height), size: `${rec.width}x${rec.height}` }
          : {}),
        ...(focusOf ? { focus: focusOf(item.imageId) } : {}),
        ...(attrsOf ? { attrs: attrsOf(item.imageId) } : {}),
        imageColours: (r.identity?.image?.dominantColours ?? [])
          .slice(0, 3)
          .map((c) => c.family)
          .filter((c): c is string => !!c),
        final: r.final,
      };
      (g.appId === ourAppId ? out.ours : out.competitors).push(entry);
    }
    const length = g.positions.filter((p) => !copies.has(p)).length;
    if (g.appId === ourAppId) out.ourDeckLength = length;
    else
      out.decks.push({
        appId: g.appId,
        name: g.name,
        deckLength: length,
        ...(r ? { images: g.positions.length, repeats: theirRepeatNote(g.name, r) } : {}),
      });
  }
  return out;
}

/** The screens each game of a plan (one country) shows twice, from the cached checks (no compute). */
export function planRepeats(
  paths: Pick<ProjectPaths, "projectId" | "library" | "workspace">,
  db: Pick<ImageDb, "get">,
  plan: Pick<AnalysisPlan, "items">,
  records: ReadonlyMap<string, AnalysisRecord>,
): Map<string, DeckRepeats> {
  return repeatsOfItems(plan.items, (id) => db.get(id), sameCheck(paths, records));
}

/** Fingerprint of the analyses a batch's patterns and recommendations are built from. */
export function batchDataHash(
  plan: Pick<AnalysisPlan, "games" | "items" | "versions">,
  records: ReadonlyMap<string, AnalysisRecord>,
): string {
  const rows = plan.games.flatMap((g) =>
    g.positions.map((p) => {
      const it = plan.items.find((i) => i.appId === g.appId && i.position === p);
      const r = it ? records.get(it.imageId) : undefined;
      // Deterministic refreshes (image facts, taxonomy mapping) keep updatedAt, so they are listed too.
      return [
        g.appId,
        p,
        it?.imageId ?? null,
        isUsable(r) ? r.updatedAt : null,
        isUsable(r) ? r.final.screenshot.screenType : null,
        r?.mapping ?? null,
        r?.identity?.image?.version ?? null,
      ];
    }),
  );
  return stableHash({ versions: plan.versions, rows });
}

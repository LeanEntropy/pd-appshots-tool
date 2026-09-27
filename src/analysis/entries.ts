import type { ImageDb } from "../store/imagedb.ts";
import { stableHash } from "../util/hash.ts";
import { orientationOf } from "./image-facts.ts";
import type { DeckEntry } from "./patterns.ts";
import type { AnalysisPlan } from "./plan.ts";
import { type AnalysisRecord, isUsable } from "./records.ts";

export interface BatchEntries {
  ours: DeckEntry[];
  competitors: DeckEntry[];
  decks: { appId: string; name: string; deckLength: number }[];
  ourDeckLength: number;
  /** Plan positions without a usable analysis, e.g. "Archero 2 #3". */
  missing: string[];
}

/** Every analysed screenshot of the batch's games in store order, ours separated (by code). */
export function batchEntries(
  plan: AnalysisPlan,
  records: ReadonlyMap<string, AnalysisRecord>,
  db: Pick<ImageDb, "get">,
  ourAppId: string,
): BatchEntries {
  const out: BatchEntries = { ours: [], competitors: [], decks: [], ourDeckLength: 0, missing: [] };
  for (const g of plan.games) {
    for (const position of g.positions) {
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
        imageColours: (r.identity?.image?.dominantColours ?? [])
          .slice(0, 3)
          .map((c) => c.family)
          .filter((c): c is string => !!c),
        final: r.final,
      };
      (g.appId === ourAppId ? out.ours : out.competitors).push(entry);
    }
    if (g.appId === ourAppId) out.ourDeckLength = g.positions.length;
    else out.decks.push({ appId: g.appId, name: g.name, deckLength: g.positions.length });
  }
  return out;
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

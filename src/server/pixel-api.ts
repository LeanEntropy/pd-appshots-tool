import { z } from "zod";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { savePairVerdicts } from "../reports/match-check.ts";
import { openImageDb } from "../store/imagedb.ts";
import { pixelCandidate } from "../store/pixel-diff.ts";
import type { ApiResponse } from "./api.ts";

const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const Body = z.strictObject({
  pairs: z
    .array(z.strictObject({ image: Hash, anchor: Hash, same: z.boolean().nullable() }))
    .min(1)
    .max(500),
});

/**
 * Answers for several picture pairs at once (plan-analysis-speed item 8): "Confirm all" of the
 * pixel check's block (every pair "same"), or one pair opened and marked; same: null removes the
 * answer again (the page's Undo, only for the answers it just saved). Each pair must be two
 * images of the project that the pixel check could compare (same shape, fingerprint within 14
 * bits); nothing is saved when one is not.
 */
export function postPairVerdicts(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const b = Body.safeParse(raw);
  const reload = "The page sent a choice the tool does not know. Reload the page.";
  if (!b.success) return { status: 400, body: { problems: [reload] } };
  const db = openImageDb(projectPaths(loaded));
  for (const p of b.data.pairs) {
    const a = db.get(p.image);
    const c = db.get(p.anchor);
    if (!a || !c || a.id === c.id || !pixelCandidate(a, c))
      return { status: 400, body: { problems: [reload] } };
  }
  savePairVerdicts(loaded, b.data.pairs);
  return { status: 200, body: { saved: b.data.pairs.length } };
}

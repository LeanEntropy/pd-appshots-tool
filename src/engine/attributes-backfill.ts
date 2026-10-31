import { join } from "node:path";
import { ledger } from "../analysis/budget.ts";
import { type CallContext, validatedCall } from "../analysis/call.ts";
import { readSavedPlan } from "../analysis/plan.ts";
import { renderFile } from "../analysis/prompts.ts";
import { type Provider, providerFor } from "../analysis/providers.ts";
import { isUsable, readRecords } from "../analysis/records.ts";
import { modelCopy } from "../analysis/run-chunk.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { answerKey } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import { acquireAll, LOCKS } from "../storage/leases.ts";
import { openImageDb } from "../store/imagedb.ts";
import { stableHash } from "../util/hash.ts";
import { attributesAnswerSchema, attributesFromNotes } from "./attributes.ts";
import { ATTRIBUTES_CONTRACT, readSavedAttributes, saveAttributes } from "./attributes-store.ts";

/**
 * The image-attribute backfill (decision D6, 2026-10-30): board density, HUD, people and device
 * for images analysed before full-analysis.v12 asked for them. Approval-gated: the scope lists
 * the exact images and the cost, its fingerprint is the approval, and the run stops at the top
 * of the range. Nothing runs without that approval (the user approves it later; never run here).
 */
export const ATTRIBUTES_STEP = "attributes";
export const ATTRIBUTES_PROMPT_FILE = "attributes.v1";
/** One image's small call, typical and high (no recorded calls yet: the planned estimate). */
export const ATTRIBUTES_USD_PER_IMAGE: readonly [number, number] = [0.05, 0.1];

export interface AttributesScope {
  items: { imageId: string; game: string; position: number }[];
  usd: [number, number];
  /** The run stops here. */
  limitUsd: number;
  scopeHash: string;
  basis: string;
}

/** Images of the saved Pilot and Full check batches with no attributes yet (free, no AI). */
export function attributesScope(loaded: LoadedConfig): AttributesScope {
  const paths = projectPaths(loaded);
  const records = readRecords(paths);
  const seen = new Set<string>();
  const items: AttributesScope["items"] = [];
  for (const stage of ["pilot", "core"] as const)
    for (const it of readSavedPlan(loaded, stage)?.items ?? []) {
      const r = records.get(it.imageId);
      if (seen.has(it.imageId) || !isUsable(r)) continue;
      seen.add(it.imageId);
      const noted = attributesFromNotes(r.final.notes);
      const complete =
        !!noted &&
        noted.hudVisible !== null &&
        noted.people !== null &&
        noted.deviceInScene !== null;
      if (complete || readSavedAttributes(paths, it.imageId)) continue;
      const game = loaded.config.competitors.find((c) => c.id === it.appId)?.name;
      items.push({
        imageId: it.imageId,
        game: game ?? loaded.config.ourApp.name,
        position: it.position,
      });
    }
  const n = items.length;
  const usd = ATTRIBUTES_USD_PER_IMAGE.map((u) => Math.round(n * u * 100) / 100) as [
    number,
    number,
  ];
  return {
    items,
    usd,
    limitUsd: usd[1],
    scopeHash: stableHash({ items, usd, contract: ATTRIBUTES_CONTRACT }),
    basis: `${n} images x $${ATTRIBUTES_USD_PER_IMAGE[0].toFixed(2)} to $${ATTRIBUTES_USD_PER_IMAGE[1].toFixed(2)} each (planned estimate; no recorded calls yet)`,
  };
}

/** Runs the approved scope only: `approvedHash` must be the fingerprint the user saw. */
export async function runAttributesBackfill(
  loaded: LoadedConfig,
  approvedHash: string,
  log: (s: string) => void,
  make: (ref: string) => Provider = (ref) =>
    providerFor(ref, join(projectPaths(loaded).objects, "schemas")),
): Promise<{ saved: number; failed: number; spentUsd: number }> {
  const scope = attributesScope(loaded);
  if (scope.scopeHash !== approvedHash)
    throw new Error(
      "The list changed since it was shown (or the approval is wrong). Show it again.",
    );
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const { taxonomy, hash } = loadTaxonomy(loaded);
  const provider = make(loaded.config.models.fullAnalysis);
  const db = openImageDb(paths);
  const system = renderFile(loaded.root, paths.objects, ATTRIBUTES_PROMPT_FILE, taxonomy);
  const held = acquireAll(storage, [LOCKS.ai], {
    projectId: paths.projectId,
    kind: "attributes-backfill",
  });
  if ("heldBy" in held)
    throw new Error("Another job is using the AI now. Start this when it finishes.");
  let spent = 0;
  const book = ledger(scope.limitUsd, () => spent, {
    [ATTRIBUTES_STEP]: ATTRIBUTES_USD_PER_IMAGE[1],
  });
  const ctx: CallContext = {
    storage,
    answerKey: (step, key) => answerKey(paths, step, key),
    taxonomy,
    taxonomyHash: hash,
    maxBudgetUsd: ATTRIBUTES_USD_PER_IMAGE[1],
    remainingUsd: book.remaining,
    timeoutMs: 300_000,
    onCost: (u) => {
      spent += u;
    },
  };
  let saved = 0;
  let failed = 0;
  try {
    for (const it of scope.items) {
      if (book.remaining() < ATTRIBUTES_USD_PER_IMAGE[1]) {
        log(`Stopped at the spending limit ($${scope.limitUsd.toFixed(2)}).`);
        break;
      }
      const image = { imageId: it.imageId, image: await modelCopy(paths, db, it.imageId) };
      const r = await validatedCall(
        ATTRIBUTES_STEP,
        provider,
        system,
        "Read these attributes of this store screenshot (img1).",
        [image],
        attributesAnswerSchema,
        () => [],
        ctx,
        { contract: ATTRIBUTES_CONTRACT },
        (v) => v,
        ATTRIBUTES_CONTRACT,
      );
      if (r.value) {
        saveAttributes(paths, it.imageId, r.value, {
          model: provider.model,
          at: new Date().toISOString(),
        });
        saved++;
      } else failed++;
      log(
        `${it.game} #${it.position}: ${r.value ? "saved" : `failed (${r.problems.join("; ")})`}; $${spent.toFixed(2)} spent`,
      );
    }
  } finally {
    held.release();
  }
  return { saved, failed, spentUsd: Math.round(spent * 100) / 100 };
}

/** The approval screen of the backfill, for the terminal. */
export function describeAttributesScope(s: AttributesScope, project: string): string {
  if (!s.items.length)
    return "Every analysed image of the saved batches has its attributes. Nothing to do.";
  return [
    `Image attributes backfill (board density, HUD, people, device in scene): ${s.items.length} images.`,
    ...s.items.map((i) => `  ${i.game} #${i.position}  ${i.imageId.slice(0, 12)}`),
    `Cost: about $${s.usd[0].toFixed(2)} to $${s.usd[1].toFixed(2)}; it stops at $${s.limitUsd.toFixed(2)}. ${s.basis}.`,
    "Nothing has run. To approve exactly this list:",
    `  npm run attributes -- --project ${project} --approve ${s.scopeHash}`,
  ].join("\n");
}

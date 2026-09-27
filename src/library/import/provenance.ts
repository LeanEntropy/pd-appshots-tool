import type { StoredObject } from "../../analysis/call.ts";
import {
  analysisKey,
  MODEL_COPY,
  type PipelineSpec,
  SETTLE_RULES_VERSION,
  unprovenKey,
} from "../../analysis/pipeline.ts";
import type { AnalysisRecord } from "../../analysis/records.ts";
import { type ProjectContext, projectKey, type Storage } from "../../storage/index.ts";

interface RunManifest {
  runId: string;
  versions?: { prompts?: Record<string, string>; schema?: string };
  models?: Record<string, string>;
  records?: { imageId: string; producer: string | null }[];
}

export interface Provenance {
  key: string;
  provenance: "proven" | "unproven";
  pipeline: PipelineSpec | null;
  /** Why a record cannot be shared (plain words), or null when it is proven. */
  reason: string | null;
}

const modelOf = (ref: string | undefined) => ref?.split(":")[1];

/**
 * Decides whether an imported record's settings can be proven from what is on disk: its run
 * manifest (prompt, schema and model versions), the manifest listing this record, and the cached
 * model answers it points to. Only proven records are reusable by other projects; the rest stay
 * usable by their own project exactly as before. The model-copy and settling-rule versions have
 * not changed since the first analysis, so the current ones apply.
 */
export function proveRecord(storage: Storage, ctx: ProjectContext, r: AnalysisRecord): Provenance {
  const no = (reason: string): Provenance => ({
    key: unprovenKey(ctx.projectId),
    provenance: "unproven",
    pipeline: null,
    reason,
  });
  if (!r.producer) return no("no model answer (the analysis failed)");
  if (!r.schema) return no("no schema version");
  const m = storage.getJson(projectKey(ctx, "runs", r.runId, "manifest.json")) as
    | RunManifest
    | undefined;
  if (!m) return no("its run has no manifest (interrupted or still running)");
  const listed = m.records?.find((x) => x.imageId === r.imageId);
  if (!listed || listed.producer !== r.producer.object)
    return no("its run manifest does not list this result");
  if (m.versions?.schema !== r.schema) return no("schema version differs from its run");
  const pf = m.versions?.prompts?.fullAnalysis;
  const pa = m.versions?.prompts?.adjudicate;
  const producer = m.models?.fullAnalysis;
  const settle = m.models?.adjudicate;
  if (!pf || !pa || !producer || !settle) return no("its run manifest is incomplete");
  if (modelOf(producer) !== r.producer.model) return no("producer model differs from its run");
  const answer = (step: string, obj: { model: string; object: string }) => {
    const o = storage.getJson(projectKey(ctx, "objects", step, `${obj.object}.json`)) as
      | StoredObject
      | undefined;
    return !!o && o.model === obj.model && o.imageIds.includes(r.imageId);
  };
  if (!answer("full-analysis", r.producer)) return no("the producer's answer is not cached");
  let reviewer: string;
  if (r.reviewer) {
    const ref = m.models?.imageReview;
    if (!ref || modelOf(ref) !== r.reviewer.model) return no("reviewer differs from its run");
    if (!answer("review", r.reviewer)) return no("the second opinion is not cached");
    reviewer = ref;
  } else if (r.status === "unreviewed" && m.models?.imageReview) {
    reviewer = m.models.imageReview; // required, attempted, unreadable
  } else return no("whether a second opinion was required cannot be proven");
  if (r.adjudication) {
    if (modelOf(settle) !== r.adjudication.model) return no("settling model differs from its run");
    if (!answer("adjudicate", r.adjudication)) return no("the settling answer is not cached");
  }
  const pipeline: PipelineSpec = {
    schema: r.schema,
    prompts: { fullAnalysis: pf, review: pf, adjudicate: pa },
    models: { producer, reviewer, settle },
    modelCopy: MODEL_COPY.version,
    settleRules: SETTLE_RULES_VERSION,
  };
  return { key: analysisKey(pipeline), provenance: "proven", pipeline, reason: null };
}

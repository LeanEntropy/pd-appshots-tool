import type { Taxonomy } from "../config/load.ts";
import { type CallContext, type ChunkImage, type ChunkResult, validatedCall } from "./call.ts";
import type { PlanItem } from "./plan.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";
import type { AnalysisRecord, AnalysisStatus } from "./records.ts";
import { adjudicationSchema, type ImageAnalysis, SCHEMA_VERSION } from "./schema.ts";

export interface Decision {
  chosen: "first" | "second" | "neither";
  screenType: string;
  subtype: string;
  composition: ImageAnalysis["screenshot"]["composition"];
  marketingLayerPresent: boolean;
  headline: string;
  reason: string;
}

/** The chosen reading becomes the base; the decided fields override it. */
export function applyDecision(
  a: ImageAnalysis,
  b: ImageAnalysis | undefined,
  d: Decision,
): ImageAnalysis {
  const base = d.chosen === "second" && b ? b : a;
  const layer = base.marketingLayer;
  const other = base === a ? b : a;
  const empty = {
    ...layer,
    present: false,
    coveragePercent: 0,
    backgroundMasks: [],
    texts: [],
    elements: [],
    mainColours: [],
    relationToScreen: "none" as const,
  };
  const marketingLayer =
    d.marketingLayerPresent === layer.present
      ? layer
      : d.marketingLayerPresent
        ? other?.marketingLayer.present
          ? other.marketingLayer
          : layer
        : empty;
  return {
    ...base,
    screenshot: {
      // The captures follow the decided composition: from the reading that has it, if any.
      ...(base.screenshot.composition !== d.composition &&
      other?.screenshot.composition === d.composition
        ? other.screenshot
        : base.screenshot),
      composition: d.composition,
      screenType: d.screenType,
      subtype: d.subtype,
    },
    marketingLayer,
    headline: d.marketingLayerPresent ? d.headline : "",
  };
}

/** Every sent image decided exactly once, and nothing else. */
export function decisionProblems(
  decisions: readonly { imageRef: string }[],
  refs: readonly string[],
): string[] {
  const got = decisions.map((d) => d.imageRef);
  const problems = refs.filter((r) => !got.includes(r)).map((r) => `missing decision for ${r}`);
  problems.push(
    ...got
      .filter((r) => !refs.includes(r))
      .map((r) => `decision for an image that was not sent: ${r}`),
  );
  if (new Set(got).size !== got.length) problems.push("an image has more than one decision");
  return problems;
}

/** Asks the adjudicator to settle disputed images, with both readings and the images. */
export async function settle(
  adjudicator: Provider,
  prompt: RenderedPrompt,
  taxonomy: Taxonomy,
  disputed: readonly ChunkImage[],
  produced: ChunkResult,
  reviewed: ChunkResult,
  disputes: ReadonlyMap<string, string[]>,
  ctx: CallContext,
): Promise<{ decisions: Map<string, Decision>; key: string }> {
  const listing = disputed
    .map((c, i) =>
      [
        `img${i + 1}`,
        `First reading: ${JSON.stringify(produced.readings.get(c.imageId))}`,
        `Second reading: ${JSON.stringify(reviewed.readings.get(c.imageId))}`,
        `Disagreements: ${(disputes.get(c.imageId) ?? []).join("; ")}`,
      ].join("\n"),
    )
    .join("\n\n");
  const upstream = disputed.map((c) => [
    produced.objects.get(c.imageId),
    reviewed.objects.get(c.imageId),
  ]);
  const r = await validatedCall(
    "adjudicate",
    adjudicator,
    prompt,
    `Settle these disagreements.\n\n${listing}`,
    disputed,
    adjudicationSchema(taxonomy),
    (v, refs) => decisionProblems(v.decisions, refs),
    ctx,
    upstream,
  );
  const decisions = new Map<string, Decision>();
  for (const d of r.value?.decisions ?? []) {
    const im = disputed[Number(d.imageRef.replace("img", "")) - 1];
    if (im) decisions.set(im.imageId, d);
  }
  return { decisions, key: r.key };
}

export interface RecordInput {
  item: PlanItem;
  produced: ChunkResult;
  reviewed: ChunkResult;
  reviewRequired: boolean;
  disputes: ReadonlyMap<string, string[]>;
  notes: ReadonlyMap<string, string[]>;
  decision: Decision | undefined;
  adjudicationKey: string;
  models: { producer: string; reviewer: string | null; adjudicator: string };
  runId: string;
  /** Checks a merged (adjudicated) reading; problems keep the record disputed. */
  check?: (a: ImageAnalysis) => string[];
  /** Answer shape of the readings (the lean one leaves unread fields out). */
  schema?: string;
}

/**
 * Status: failed (no valid reading); unreviewed (a required second opinion could not be read);
 * disputed (disagreement not settled); adjudicated (settled); ok (agreed or not sampled).
 */
export function buildRecord(x: RecordInput): AnalysisRecord {
  const id = x.item.imageId;
  const a = x.produced.readings.get(id) ?? null;
  const reviewedOk = x.reviewed.readings.has(id);
  const d = x.decision;
  let status: AnalysisStatus = "ok";
  if (!a) status = "failed";
  else if (x.reviewRequired && !reviewedOk) status = "unreviewed";
  else if (x.disputes.has(id)) status = d ? "adjudicated" : "disputed";
  const problems = [
    x.produced.failed.get(id),
    x.reviewRequired && a && !reviewedOk
      ? `second opinion could not be read: ${x.reviewed.failed.get(id) ?? "no answer"}`
      : undefined,
  ].filter((p): p is string => !!p);
  const final = a && d ? applyDecision(a, x.reviewed.readings.get(id), d) : a;
  const unsettled =
    d && final && d.marketingLayerPresent && !final.marketingLayer.present
      ? ["the adjudicator saw a marketing layer that neither reading described"]
      : [];
  // The merged reading must still be consistent (e.g. composition vs captures).
  if (d && final && x.check) unsettled.push(...x.check(final).map((p) => `after settling: ${p}`));
  if (unsettled.length) {
    problems.push(...unsettled);
    status = "disputed";
  }
  return {
    imageId: id,
    schema: x.schema ?? SCHEMA_VERSION,
    appId: x.item.appId,
    gl: x.item.gl,
    hl: x.item.hl,
    position: x.item.position,
    status,
    final,
    producer: a ? { model: x.models.producer, object: x.produced.objects.get(id) ?? "" } : null,
    reviewer:
      reviewedOk && x.models.reviewer
        ? { model: x.models.reviewer, object: x.reviewed.objects.get(id) ?? "" }
        : null,
    adjudication: d
      ? { model: x.models.adjudicator, object: x.adjudicationKey, reason: d.reason }
      : null,
    differences: [...(x.notes.get(id) ?? [])],
    problems,
    runId: x.runId,
    updatedAt: new Date().toISOString(),
  };
}

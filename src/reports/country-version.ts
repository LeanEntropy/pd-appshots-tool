import { PATTERN_FIT_VERSION } from "../analysis/pattern-fit.ts";
import { PROMPT_VERSIONS, REPORT_PROMPTS } from "../analysis/prompts.ts";
import { isUsable } from "../analysis/records.ts";
import { SCHEMA_VERSION } from "../analysis/schema.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { newRunId } from "../store/manifest.ts";
import { type BuildResult, scopeDataHash } from "./build.ts";
import { cachedAi, type ReportAi } from "./country-ai.ts";
import { countryMarkdown } from "./country-md.ts";
import { assembleCountryReport } from "./country-report.ts";
import { eligibility } from "./eligibility.ts";
import { mainMarketRef } from "./main-market.ts";
import { buildScopePlan, type PlanContext, planContext, type ScopePlan } from "./scope-plan.ts";
import { addVersion, versionFileKey, writeVersionInputs } from "./store.ts";
import type { ReportDef, VersionInputs } from "./types.ts";

export interface CountryBuildOptions {
  now?: Date;
  /** The AI of the build: cached answers only (the free build, default) or the paid run's. */
  ai?: ReportAi;
  ctx?: PlanContext;
  research?: (plan: ScopePlan) => { lines: string[]; saved: unknown };
  /**
   * A banner for a partial version (stopped, failed or over the limit), with how to finish;
   * a function is asked after the written parts are made (the limit can be reached there).
   */
  partial?: string | null | (() => string | null);
  planHash?: string | null;
  aiRunId?: string | null;
  /** Told when the written parts are made and the report's files are built (the run panel). */
  onBuild?: () => void;
}

/**
 * A new immutable version of a One country or Compare countries report (plan-reports 4.1):
 * everything computed from the saved analyses and text-layer comparisons, plus the text-only AI
 * parts that `ai` provides (the free build never calls a model: missing parts say how to get
 * them). Written once: country-report.json, report.md, version.json and the research list.
 */
export async function buildCountryVersion(
  loaded: LoadedConfig,
  def: ReportDef,
  o: CountryBuildOptions = {},
): Promise<BuildResult & { problems?: string[] }> {
  const now = o.now ?? new Date();
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const ctx = o.ctx ?? planContext(loaded);
  const plan = buildScopePlan(loaded, def.scope, { proposeDrop: false, ctx });
  const ai = o.ai ?? cachedAi(loaded);
  const { report, inputs, problems } = await assembleCountryReport(loaded, def, plan, ctx, ai, now);
  o.onBuild?.();
  const partial = typeof o.partial === "function" ? o.partial() : o.partial;
  if (partial) report.banners.unshift(partial);
  const versionId = newRunId(def.id, now);
  if (s.exists(versionFileKey(paths, versionId, "report.md")))
    return { ok: false, status: 409, problem: "A version was just built. Try again in a moment." };
  s.putJsonOnce(versionFileKey(paths, versionId, "country-report.json"), report);
  const research = o.research?.(plan);
  if (research) s.putJsonOnce(versionFileKey(paths, versionId, "suggestions.json"), research.saved);
  s.putText(
    versionFileKey(paths, versionId, "report.md"),
    countryMarkdown(report, research?.lines),
  );
  const v: VersionInputs = {
    reportId: def.id,
    type: def.type,
    generatedAt: now.toISOString(),
    createdAt: now.toISOString(),
    mainMarket: mainMarketRef(loaded),
    scope: def.scope,
    pick: plan.games.map((g) => ({
      appId: g.appId,
      name: g.name,
      positions: [
        ...new Set(plan.decks.filter((d) => d.appId === g.appId).flatMap((d) => d.positions)),
      ],
    })),
    orderDates: Object.fromEntries(plan.decks.map((d) => [`${d.appId}@${d.gl}`, d.orderDate])),
    records: plan.items
      .filter((i) => !i.anchorAdded)
      .map((i) => {
        const r = inputs.records.get(i.imageId);
        return {
          appId: i.appId,
          gl: i.gl,
          position: i.position,
          imageId: i.imageId,
          updatedAt: isUsable(r) ? r.updatedAt : null,
        };
      }),
    versions: {
      prompts: { ...PROMPT_VERSIONS, ...REPORT_PROMPTS },
      schema: SCHEMA_VERSION,
      taxonomy: inputs.slices[0]?.inputs.plan.versions.taxonomy ?? "",
      fit: PATTERN_FIT_VERSION,
    },
    planHash: o.planHash ?? null,
    dataHash: scopeDataHash(plan, inputs.slices),
    aiRunId: o.aiRunId ?? null,
    base: eligibility(loaded).base,
  };
  writeVersionInputs(s, paths, versionId, v);
  const next = addVersion(s, paths, def.id, { id: versionId, generatedAt: v.generatedAt });
  return { ok: true, versionId, def: next, problems };
}

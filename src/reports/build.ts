import { batchDataHash } from "../analysis/entries.ts";
import { labeler } from "../analysis/labels.ts";
import { PATTERN_FIT_VERSION } from "../analysis/pattern-fit.ts";
import type { AnalysisPlan } from "../analysis/plan.ts";
import { PROMPT_VERSIONS } from "../analysis/prompts.ts";
import { isUsable, readRecords } from "../analysis/records.ts";
import { buildReportData, type ReportData, type ReportInputs } from "../analysis/report-data.ts";
import { reportMarkdown } from "../analysis/report-md.ts";
import { SCHEMA_VERSION } from "../analysis/schema.ts";
import { compareStoreText } from "../analysis/store-compare.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { newRunId, readDeck } from "../store/manifest.ts";
import { stableHash } from "../util/hash.ts";
import { eligibility, eligibilityProblem } from "./eligibility.ts";
import { mainMarketRef } from "./main-market.ts";
import { countryName } from "./names.ts";
import { buildScopePlan, type PlanContext, planContext, type ScopePlan } from "./scope-plan.ts";
import { addVersion, readDef, versionFileKey, writeVersionInputs } from "./store.ts";
import { isPreset, type MarketRef, type ReportDef, type VersionInputs } from "./types.ts";
import { buildPresetVersion } from "./version.ts";

/** One country of a builder report: the inputs the existing report builder reads. */
export interface CountrySlice {
  market: MarketRef;
  inputs: ReportInputs;
}

/**
 * Per country, the report inputs of that country's part of the plan (plan-reports 3: the
 * existing buildReportData is reused per country with its plan slice). Code only.
 */
export function countrySlices(
  loaded: LoadedConfig,
  plan: ScopePlan,
  ctx: PlanContext = planContext(loaded),
): CountrySlice[] {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const { db, records } = ctx;
  const taxonomy = loadTaxonomy(loaded);
  const label = labeler(taxonomy.taxonomy);
  const storage = workspaceStorage(paths.workspace);
  const versions = {
    prompts: PROMPT_VERSIONS,
    schema: SCHEMA_VERSION,
    taxonomy: taxonomy.hash,
    fit: PATTERN_FIT_VERSION,
  };
  return plan.markets.map((m) => {
    const decks = plan.decks.filter((d) => d.gl === m.gl && d.state === "ok");
    const items = plan.items.filter((i) => i.gl === m.gl && !i.anchorAdded);
    const games = decks.map((d) => ({ appId: d.appId, name: d.name, positions: d.positions }));
    const slice = {
      stage: "core",
      createdAt: "",
      planHash: plan.planHash,
      market: m,
      games,
      items,
      excluded: [],
      counts: plan.counts,
      cap: 0,
      coreTotal: 0,
      withinCap: true,
      estimate: plan.images,
      synthesisNeeded: false,
      models: {},
      versions,
      review: null,
      estimates: null,
      budget: null,
    } satisfies AnalysisPlan;
    const missing = plan.decks.filter((d) => d.gl === m.gl && d.state !== "ok");
    const inputs: ReportInputs = {
      plan: slice,
      approved: true,
      ourAppId: config.ourApp.id,
      records,
      decks: new Map(
        decks.map((d) => [d.appId, readDeck(paths.decks, { appId: d.appId, gl: m.gl, hl: m.hl })]),
      ),
      db,
      orderDates: new Map(decks.map((d) => [d.appId, d.orderDate])),
      label,
      dataHash: batchDataHash(slice, records),
      latestAi: null,
      lastSkip: null,
      estimateUsd: plan.text.usd,
      leftOut: missing.filter((d) => d.state === "not-sold").map((d) => d.name),
      storeText: compareStoreText(
        storage,
        config.markets.filter((x) => x.gl === m.gl && x.hl === m.hl),
        { appId: config.ourApp.id, name: config.ourApp.name },
        games.filter((g) => g.appId !== config.ourApp.id),
      ),
    };
    return { market: m, inputs };
  });
}

/** Fingerprint of the data a builder report is made from (the "Newer data" comparison). */
export function scopeDataHash(plan: ScopePlan, slices: readonly CountrySlice[]): string {
  return stableHash({
    scope: plan.decks.map((d) => [d.appId, d.gl, d.state, d.orderDate]),
    countries: slices.map((s) => [s.market.gl, s.inputs.dataHash]),
  });
}

/** The explanation shown where the written advice will go (it needs the next update). */
function adviceNote(d: ReportData, base: "pilot" | "core" | null, n: number): ReportData {
  const basis =
    base === "pilot"
      ? `Built on the Pilot only (${n} ${n === 1 ? "competitor" : "competitors"}): run the Full check for a stronger base. `
      : "";
  return {
    ...d,
    synthesis: {
      state: "missing",
      reason: `${basis}The written advice for this report (recommendations, country advice, words used and A/B tests) is added by the next update of the tool.`,
      howTo:
        "Everything else here is computed from the saved analyses, at no cost. Until then, the recommendations of the Full check (or the Pilot) apply.",
    },
  };
}

export type BuildResult =
  | { ok: true; versionId: string; def: ReportDef }
  | { ok: false; status: number; problem: string };

/**
 * "Build report" (plan-reports 1.2): builds a new immutable version at once, only when the report
 * needs no new analysis. Pilot and Full check are rebuilt from the saved analyses; One country and
 * Compare countries get their per-country content. No AI is ever called here.
 */
export function buildReportVersion(
  loaded: LoadedConfig,
  def: ReportDef,
  o: { now?: Date; research?: (plan: ScopePlan) => { lines: string[]; saved: unknown } } = {},
): BuildResult {
  const now = o.now ?? new Date();
  const e = eligibility(loaded);
  const refused = eligibilityProblem(e, def.type);
  if (refused) return { ok: false, status: 409, problem: refused };
  const plan = buildScopePlan(loaded, def.scope);
  if (!plan.instant)
    return {
      ok: false,
      status: 409,
      problem: `This report needs ${plan.counts.newImages} new ${plan.counts.newImages === 1 ? "image" : "images"} analysed first (about $${plan.usd[0].toFixed(2)} to $${plan.usd[1].toFixed(2)}). Nothing was sent.`,
    };
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  if (isPreset(def.type)) {
    buildPresetVersion(loaded, def, now);
    const next = readDef(s, paths, def.id) ?? def;
    const versionId = next.versions.at(-1)?.id ?? "";
    const research = o.research?.(plan);
    if (research && versionId)
      s.putJsonOnce(versionFileKey(paths, versionId, "suggestions.json"), research.saved);
    return { ok: true, versionId, def: next };
  }
  const slices = countrySlices(loaded, plan);
  const competitors = plan.games.filter((g) => !g.ours).length;
  const countries = slices.map((c) => ({
    gl: c.market.gl,
    label: c.market.label,
    data: adviceNote(buildReportData(c.inputs), e.base, competitors),
  }));
  const versionId = newRunId(def.id, now);
  if (s.exists(versionFileKey(paths, versionId, "report.md")))
    return { ok: false, status: 409, problem: "A version was just built. Try again in a moment." };
  if (def.type === "country" && countries[0])
    s.putJsonOnce(versionFileKey(paths, versionId, "report-data.json"), countries[0].data);
  else s.putJsonOnce(versionFileKey(paths, versionId, "countries.json"), { countries });
  const research = o.research?.(plan);
  if (research) s.putJsonOnce(versionFileKey(paths, versionId, "suggestions.json"), research.saved);
  const label = slices[0]?.inputs.label ?? ((k: string) => k);
  const md = [
    `# ${def.name}`,
    "",
    `Generated ${now.toISOString().slice(0, 16).replace("T", " ")} UTC from the saved analyses, with no AI call. Countries: ${countries.map((c) => countryName(c.label)).join(", ")}.`,
    "",
    ...countries.flatMap((c) =>
      countries.length > 1
        ? [`# ${countryName(c.label)}`, "", ...reportMarkdown(c.data, label), ""]
        : [...reportMarkdown(c.data, label), ""],
    ),
    ...(research?.lines ?? []),
  ];
  s.putText(versionFileKey(paths, versionId, "report.md"), `${md.join("\n")}\n`);
  const records = slices[0]?.inputs.records ?? readRecords(paths);
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
        const r = records.get(i.imageId);
        return {
          appId: i.appId,
          gl: i.gl,
          position: i.position,
          imageId: i.imageId,
          updatedAt: isUsable(r) ? r.updatedAt : null,
        };
      }),
    versions: slices[0]?.inputs.plan.versions ?? {
      prompts: PROMPT_VERSIONS,
      schema: SCHEMA_VERSION,
      taxonomy: "",
      fit: PATTERN_FIT_VERSION,
    },
    planHash: null,
    dataHash: scopeDataHash(plan, slices),
    aiRunId: null,
    base: e.base,
  };
  writeVersionInputs(s, paths, versionId, v);
  const next = addVersion(s, paths, def.id, { id: versionId, generatedAt: v.generatedAt });
  return { ok: true, versionId, def: next };
}

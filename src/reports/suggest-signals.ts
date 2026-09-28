import { latestOrderDate } from "../analysis/orders.ts";
import { buildAnalysisPlan } from "../analysis/plan.ts";
import { isUsable } from "../analysis/records.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { analysedSlots, fitFor } from "../core/selection.ts";
import { settingsOf } from "../settings/access.ts";
import { readDeck } from "../store/manifest.ts";
import { latestRun } from "../view/model.ts";
import { pairKey, samePicture } from "./anchors.ts";
import type { Eligibility } from "./eligibility.ts";
import type { ReportSummary } from "./list.ts";
import { countryName, theCountry } from "./names.ts";
import { buildScopePlan, type PlanContext, planContext, projectMarkets } from "./scope-plan.ts";
import { DEFAULT_COUNTRIES, list, POINTS, type Signal } from "./suggest-points.ts";
import { weakPatterns } from "./suggest-weak.ts";
import type { ReportScope } from "./types.ts";

/** "a" or "an" before a country name. */
const an = (w: string, cap = false) => (/^[AEIOU]/.test(w) ? (cap ? "An" : "an") : cap ? "A" : "a");
const planCost = (loaded: LoadedConfig, scope: ReportScope, ctx: PlanContext) => {
  const p = buildScopePlan(loaded, scope, { proposeDrop: false, ctx });
  return p.counts.newImages || p.usd[1] > 0 ? { images: p.counts.newImages, usd: p.usd } : null;
};

/** Every free signal on disk (plan-reports 5A.2), code only: no AI, nothing is started. */
export function signals(
  loaded: LoadedConfig,
  reports: readonly ReportSummary[],
  e: Eligibility,
  ctx: PlanContext = planContext(loaded),
): Signal[] {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const { db, records } = ctx;
  const opts = settingsOf(config).suggestions;
  const main = settingsOf(config).mainMarket;
  const mainName = theCountry(main.label);
  const mainPlain = countryName(main.label);
  const markets = projectMarkets(loaded);
  const pick = fitFor(loaded).fit.selected;
  const pickIds = pick.map((c) => c.appId);
  const out: Signal[] = [];
  const base = { second: null, older: false, countryIndex: 0, competitorIndex: 0 };
  const core = reports.find((r) => r.type === "core" && !r.archived && r.markets[0] === main.gl);
  const unanalysed = pick.filter((c) => {
    const d = readDeck(paths.decks, { appId: c.appId, gl: main.gl, hl: main.hl });
    const slots = d?.status === "ok" ? analysedSlots(config, d) : [];
    return slots.some((s) => !s.imageId || !isUsable(records.get(s.imageId)));
  });
  const coreScope: ReportScope = { type: "core", markets: [], competitors: [], includeCharts: [] };
  const coreCost = () => {
    const p = buildAnalysisPlan(loaded, "core");
    return p.counts.newImages ? { images: p.counts.newImages, usd: p.estimate.usd } : null;
  };
  const coreStale = !!(e.coreReady && core?.newer);
  if (!e.coreReady) {
    out.push({
      ...base,
      key: "full-check",
      category: "full-check",
      title: "Run the Full check",
      why: `There is no Full check of ${mainName} yet: it strengthens every other report${unanalysed.length ? ` (${unanalysed.length} of your ${pick.length} picked competitors are not analysed yet)` : ""}.`,
      short: "Highly recommended: it strengthens every other report.",
      what: `${mainPlain}: our game and ${pick.length} picked competitors`,
      value: POINTS.noFullCheck + POINTS.pickGapPerDeck * unanalysed.length,
      cost: coreCost(),
      action: { label: "Set up this report", scope: coreScope },
    });
  } else if (coreStale) {
    out.push({
      ...base,
      key: "regenerate-core",
      category: "regenerate",
      title: "Regenerate the Full check first",
      why: `The Full check has newer data (${core?.newer ?? ""}); suggestions built on it may be out of date.`,
      short: "The Full check has newer data; suggestions may be out of date.",
      what: `${mainPlain}: the Full check`,
      value: POINTS.regenerateFirst,
      cost: coreCost(),
      action: { label: "Set up this report", scope: coreScope },
    });
  } else if (unanalysed.length) {
    out.push({
      ...base,
      key: `pick-gap:${unanalysed.map((c) => c.appId).join(",")}`,
      category: "pick-gap",
      title: `Analyse ${list(unanalysed.map((c) => c.name))} in ${mainName}`,
      why: `Analyse ${list(unanalysed.map((c) => `${c.name}'s deck`))} in ${mainName} (your main country): ${unanalysed.length === 1 ? "it is" : "they are"} in your pick but not analysed.`,
      short: `${unanalysed.length} picked ${unanalysed.length === 1 ? "competitor is" : "competitors are"} not analysed yet.`,
      what: `${mainPlain}: ${list(unanalysed.map((c) => c.name))}`,
      value: POINTS.pickGapPerDeck * unanalysed.length,
      cost: coreCost(),
      action: { label: "Set up this report", scope: coreScope },
    });
  }
  // Our chart rank per country (from our decks), and the chart games of each country.
  const ours = readDeck(paths.decks, { appId: config.ourApp.id, gl: main.gl, hl: main.hl });
  const ranks: Record<string, number> = { ...(ours?.chartRanks ?? {}) };
  const charts = (latestRun(paths.runs)?.decks ?? []).filter((d) => d.group === "chart");
  const chartBonus = (gl: string) => {
    const r = ranks[gl];
    return r === undefined ? 0 : r <= 10 ? POINTS.chartTop10 : r <= 50 ? POINTS.chartTop50 : 0;
  };
  const different = ctx.different;
  const staleBefore = Date.now() - opts.staleDays * 86_400_000;
  markets.forEach((m, mi) => {
    if (mi === 0) return;
    let total = 0;
    let identical = 0;
    let newText = 0;
    let stale = false;
    for (const c of pick) {
      const d = readDeck(paths.decks, { appId: c.appId, gl: m.gl, hl: m.hl });
      const home = readDeck(paths.decks, { appId: c.appId, gl: main.gl, hl: main.hl });
      if (d?.status !== "ok" || home?.status !== "ok") continue;
      const ordered = latestOrderDate(paths, c.appId, m.gl, m.hl);
      if (ordered && Date.parse(`${ordered}T00:00:00Z`) < staleBefore) stale = true;
      const homeImgs = analysedSlots(config, home).flatMap((s) => {
        const r = s.imageId ? db.get(s.imageId) : undefined;
        return r ? [r] : [];
      });
      for (const s of analysedSlots(config, d)) {
        const img = s.imageId ? db.get(s.imageId) : undefined;
        if (!img) continue;
        total++;
        if (homeImgs.some((h) => h.id === img.id)) identical++;
        else if (homeImgs.some((h) => !different.has(pairKey(h.id, img.id)) && samePicture(h, img)))
          newText++;
      }
    }
    if (!total) return;
    const scope: ReportScope = {
      type: "country",
      markets: [m],
      competitors: pickIds,
      includeCharts: [],
    };
    const name = countryName(m.label);
    const the = theCountry(m.label);
    const reused = identical / total;
    const changed = 1 - reused;
    const covered = reports.some(
      (r) =>
        (r.type === "country" || r.type === "compare") &&
        !r.archived &&
        r.status.kind === "ready" &&
        !r.newer &&
        r.markets.includes(m.gl) &&
        pick.every((c) => r.competitorNames.includes(c.name)),
    );
    if (covered) return;
    const common = { ...base, countryIndex: mi, older: stale, key: `country:${m.gl}` };
    if (reused >= opts.reuseShare) {
      out.push({
        ...common,
        category: "same",
        title: `Skip ${the}`,
        why: `Skip ${the}: ${identical} of ${total} images are reused from ${mainName}, so a report would repeat the Full check.`,
        short: `${identical} of ${total} images are reused from ${mainName}.`,
        what: `${name}: ${pick.length} picked competitors`,
        value: 0,
        cost: null,
        action: { label: "Show anyway", scope },
      });
      return;
    }
    out.push({
      ...common,
      category: "localise",
      title: `${an(name, true)} ${name} report`,
      why: `Competitors change ${total - identical} of ${total} images in ${the} (${newText} with new text, ${total - identical - newText} new pictures): ${an(name)} ${name} report is worth it.`,
      short: `Competitors change ${total - identical} of ${total} images here.`,
      what: `${name}: our game and ${pick.length} picked competitors`,
      value:
        POINTS.localiseBase +
        POINTS.localiseShare * changed +
        (DEFAULT_COUNTRIES.includes(m.gl) ? POINTS.defaultCountry : 0) +
        chartBonus(m.gl),
      cost: planCost(loaded, scope, ctx),
      action: { label: "Set up this report", scope },
    });
  });
  out.push(...weakPatterns(loaded, reports, e, coreStale, pickIds, mainPlain, ctx));
  // Where our game charts: a free view of the games around it, and a report of them.
  markets.forEach((m, mi) => {
    const r = ranks[m.gl];
    if (r === undefined || r > 50) return;
    const games = charts
      .filter((d) => d.gl === m.gl && d.appId !== config.ourApp.id && !pickIds.includes(d.appId))
      .sort((a, b) => (a.chartRanks[m.gl] ?? 99) - (b.chartRanks[m.gl] ?? 99))
      .slice(0, 5);
    const name = countryName(m.label);
    const the = theCountry(m.label);
    out.push({
      ...base,
      countryIndex: mi,
      key: `charts:${m.gl}`,
      category: "charts",
      title: `See the games around us in ${the}`,
      why: `${config.ourApp.name} is #${r} grossing in ${the}: see the games around it (free view).`,
      short: `We are #${r} grossing here: see the games around us.`,
      what: `${name}: the top-grossing chart`,
      value: chartBonus(m.gl),
      cost: null,
      action: { label: "Open", href: "#screenshots" },
      second: games.length
        ? {
            label: "Set up a report of them",
            scope: {
              type: "country",
              markets: [m],
              competitors: [],
              includeCharts: games.map((g) => g.appId),
            },
          }
        : null,
    });
  });
  return out;
}

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { labeler } from "../analysis/labels.ts";
import { infoViews, summaries } from "../analysis/records.ts";
import { coreOrder, type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { smallSample } from "../core/fit.ts";
import { type FitView, fitFor, resolvePick, savePick } from "../core/selection.ts";
import { overviewFile, writeOverview } from "../overview/overview-report.ts";
import { markdownToHtml } from "../view/md-html.ts";

export {
  getAnalysisStatus,
  getExpansion,
  postAnalysisPlan,
  postAnalysisRun,
  postAnalysisStop,
  postExpansion,
} from "./api-analysis.ts";

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** Body of a selection save from the page. Limits keep a bad request from doing harm. */
export const SelectionBody = z.strictObject({
  coreCompetitors: z.array(z.string().min(1).max(200)).max(100),
});

export function fitSummary(r: FitView): string {
  const extra =
    r.wholeDeckTotal !== r.fit.total ? ` (${r.wholeDeckTotal} including tablet-shaped)` : "";
  return `${r.fit.selected.length} competitor decks plus ours = ${r.fit.total} images${extra}. ${r.fit.ok ? `Ready.${r.fit.few ? ` ${smallSample(r.fit.selected.length, r.minCompetitors)}` : ""}` : r.fit.message}`;
}

function fitBody(r: FitView) {
  return {
    ok: r.fit.ok,
    few: r.fit.few,
    total: r.fit.total,
    wholeDeckTotal: r.wholeDeckTotal,
    slots: r.slots,
    selected: r.fit.selected.map((c) => ({ appId: c.appId, name: c.name, images: c.deckLength })),
    skipped: r.fit.skipped.map((s) => ({
      appId: s.candidate.appId,
      name: s.candidate.name,
      reason: s.reason,
    })),
    summary: fitSummary(r),
  };
}

export function getSelection(loaded: LoadedConfig): ApiResponse {
  const ids = coreOrder(loaded, projectPaths(loaded));
  return { status: 200, body: { coreCompetitors: ids, ...fitBody(fitFor(loaded, ids)) } };
}

/** Validates and saves a pick sent by the page; writes the run config directly. */
export function postSelection(loaded: LoadedConfig, raw: unknown): ApiResponse {
  const parsed = SelectionBody.safeParse(raw);
  if (!parsed.success) {
    return { status: 400, body: { problems: ["The page sent a selection the tool cannot read."] } };
  }
  const { ids, problems } = resolvePick(loaded.config, parsed.data.coreCompetitors);
  if (problems.length) return { status: 400, body: { problems } };
  const r = savePick(loaded, ids, "page");
  return { status: 200, body: { saved: true, coreCompetitors: ids, ...fitBody(r) } };
}

/** Fresh analyses for the (i) popovers and thumbnail captions, without reloading the page. */
export function getAnalyses(loaded: LoadedConfig): ApiResponse {
  const paths = projectPaths(loaded);
  return {
    status: 200,
    body: {
      info: infoViews(paths, labeler(loadTaxonomy(loaded).taxonomy)),
      captions: Object.fromEntries(summaries(paths, labeler(loadTaxonomy(loaded).taxonomy))),
    },
  };
}

/** The free store overview (no AI) as HTML, or null if it was not built yet. */
export function getOverview(loaded: LoadedConfig): ApiResponse {
  const file = overviewFile(loaded);
  if (!existsSync(file)) return { status: 200, body: { overview: null } };
  return {
    status: 200,
    body: { overview: { file, html: markdownToHtml(readFileSync(file, "utf8")) } },
  };
}

let building: Promise<unknown> | null = null;

/** Rebuilds the overview from the downloaded data (no AI; about a minute the first time). */
export async function postOverview(loaded: LoadedConfig): Promise<ApiResponse> {
  if (building)
    return { status: 409, body: { problems: ["The overview is already being built."] } };
  try {
    building = writeOverview(loaded);
    await building;
    return getOverview(loaded);
  } catch (e) {
    return { status: 500, body: { problems: [e instanceof Error ? e.message : String(e)] } };
  } finally {
    building = null;
  }
}

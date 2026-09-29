import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { type ProjectState, SUGGESTION_STAGES, topOf } from "../projects/state.ts";
import { listReports, type ReportSummary } from "../reports/list.ts";
import { ensurePixelChecks } from "../reports/pixel-pairs.ts";
import { type SuggestionsView, suggestionsView } from "../reports/suggest.ts";
import { viewModel } from "../steps/deck-view.ts";
import type { ViewModel } from "../view/model.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext } from "./app-context.ts";
import { getBuilder } from "./reports-builder-api.ts";

/**
 * The heavy parts of a project page, each computed once per data change and shared by every
 * request that needs it (the report list feeds both the Reports tab and the suggestions).
 */
const where = (loaded: LoadedConfig) => {
  const p = projectPaths(loaded);
  return { ws: p.workspace, id: p.projectId };
};

export function reportList(app: AppContext, loaded: LoadedConfig): Promise<ReportSummary[]> {
  const { ws, id } = where(loaded);
  return app.computed.get(ws, `${id}:reports`, () => listReports(loaded));
}

export async function suggestionsFor(
  app: AppContext,
  loaded: LoadedConfig,
): Promise<SuggestionsView> {
  const { ws, id } = where(loaded);
  const reports = await reportList(app, loaded);
  const v = await app.computed.get(ws, `${id}:suggestions`, () =>
    suggestionsView(loaded, { reports }),
  );
  // The home card shows the newest top suggestion without computing it itself.
  app.rememberSuggestion(id, topOf(v, `/p/${id}/views/gallery.html#report`));
  return v;
}

/** The free pixel check of new pairs: run again only after a data change (it writes its results). */
export function pixelChecked(app: AppContext, loaded: LoadedConfig): Promise<number> {
  const { ws, id } = where(loaded);
  return app.computed.get(ws, `${id}:pixel`, () => ensurePixelChecks(loaded));
}

/** The report builder's choices (types, countries, competitors, costs). */
export function builderOptions(app: AppContext, loaded: LoadedConfig): Promise<ApiResponse> {
  const { ws, id } = where(loaded);
  return app.computed.get(ws, `${id}:builder`, () => getBuilder(loaded));
}

export function pageView(app: AppContext, loaded: LoadedConfig): Promise<ViewModel> {
  const { ws, id } = where(loaded);
  return app.computed.get(ws, `${id}:view`, () => viewModel(loaded));
}

/**
 * The home card's "Next" line: the suggestion computed for the current data if there is one,
 * else the last one known. Computed here only when asked (compute) and never known before.
 */
export async function homeSuggestion(
  app: AppContext,
  loaded: LoadedConfig,
  s: ProjectState,
  compute: boolean,
): Promise<ProjectState["suggestion"] | undefined> {
  if (!SUGGESTION_STAGES.includes(s.stage)) return undefined;
  const { ws, id } = where(loaded);
  const href = `/p/${id}/views/gallery.html#report`;
  const fresh = app.computed.peek<SuggestionsView>(ws, `${id}:suggestions`);
  if (fresh) return topOf(fresh, href);
  const known = app.knownSuggestion(id);
  if (known !== undefined || !compute) return known;
  try {
    return topOf(await suggestionsFor(app, loaded), href);
  } catch {
    return null;
  }
}

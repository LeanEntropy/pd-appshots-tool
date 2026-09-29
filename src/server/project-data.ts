import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { listReports, type ReportSummary } from "../reports/list.ts";
import { ensurePixelChecks } from "../reports/pixel-pairs.ts";
import { ensureSameScreens } from "../reports/same-screen-run.ts";
import { type SuggestionsView, suggestionsView } from "../reports/suggest.ts";
import { viewModel } from "../steps/deck-view.ts";
import { flushDataChanges } from "../storage/changes.ts";
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
  return app.computed.get(ws, `${id}:suggestions`, () => suggestionsView(loaded, { reports }));
}

/** The free pixel check of new pairs: run again only after a data change (it writes its results). */
export function pixelChecked(app: AppContext, loaded: LoadedConfig): Promise<number> {
  const { ws, id } = where(loaded);
  return app.computed.get(ws, `${id}:pixel`, () => ensurePixelChecks(loaded));
}

/**
 * The free "same screen uploaded twice" check, once per data change (single flight; the check
 * itself also runs one pass per project at a time). Its first run per project takes minutes, so
 * page reads never wait for it. Never rejects.
 */
export function sameScreens(app: AppContext, loaded: LoadedConfig): Promise<number> {
  const { ws, id } = where(loaded);
  return app.computed
    .get(
      ws,
      `${id}:same-screens`,
      () =>
        // Its many small writes count as one data change, when it ends.
        ensureSameScreens(loaded).finally(flushDataChanges),
      undefined,
      // Done stays done after its own results are counted (else it would start again at once).
      true,
    )
    .catch(() => 0);
}

/** Starts the check if needed; true while it is running (the page shows a note meanwhile). */
export function sameScreensRunning(app: AppContext, loaded: LoadedConfig): boolean {
  const { ws, id } = where(loaded);
  void sameScreens(app, loaded);
  return app.computed.peek(ws, `${id}:same-screens`) === undefined;
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

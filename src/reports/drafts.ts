import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { fitFor } from "../core/selection.ts";
import { readJournal } from "../jobs/journal.ts";
import { projectKey, workspaceStorage } from "../storage/index.ts";
import { mainMarketRef } from "./main-market.ts";
import { suggestName } from "./names.ts";
import { projectMarkets } from "./scope-plan.ts";
import { createReport } from "./store.ts";
import type { ReportDef, ReportScope } from "./types.ts";

const doneKey = (c: { projectId: string }) => projectKey(c, "state", "expansion-drafts.json");

/**
 * Saved expansion choices become draft reports (plan-reports 7), once, code only: the chosen
 * countries a "Compare countries" draft (a "One country" draft for a single country) with the
 * core pick, the chosen competitors a main-country "One country" draft with the pick plus them.
 * The choices themselves stay in the job journal. Returns the drafts made now, for the one-time
 * message "Your saved expansion choice is now a draft report."
 */
export function draftsFromExpansion(loaded: LoadedConfig): ReportDef[] {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const chosen = readJournal(s, paths).increments.filter(
    (i) => i.state === "chosen" && (i.kind === "countries" || i.kind === "competitors"),
  );
  if (!chosen.length) return [];
  let done: string[] = [];
  try {
    const raw = s.getJson(doneKey(paths)) as { done?: unknown } | undefined;
    if (Array.isArray(raw?.done)) done = raw.done.filter((x): x is string => typeof x === "string");
  } catch {
    // An unreadable marker: the drafts are made again (a draft is only a saved choice).
  }
  const todo = chosen.filter((i) => !done.includes(i.id));
  if (!todo.length) return [];
  const main = mainMarketRef(loaded);
  const markets = projectMarkets(loaded);
  const pick = fitFor(loaded).fit.selected.map((c) => c.appId);
  const known = new Set(loaded.config.competitors.map((c) => c.id));
  const made: ReportDef[] = [];
  for (const inc of todo) {
    let scope: ReportScope | null = null;
    if (inc.kind === "countries") {
      const chosenMarkets = markets.filter((m) => inc.choice.includes(m.gl) && m.gl !== main.gl);
      if (chosenMarkets.length)
        scope = {
          type: chosenMarkets.length > 1 ? "compare" : "country",
          markets: chosenMarkets,
          competitors: pick,
          includeCharts: [],
        };
    } else {
      const extra = inc.choice.filter((id) => known.has(id) && !pick.includes(id));
      if (extra.length)
        scope = {
          type: "country",
          markets: [main],
          competitors: [...pick, ...extra],
          includeCharts: [],
        };
    }
    if (scope)
      made.push(
        createReport(s, paths, { name: suggestName(scope, main), type: scope.type, scope }),
      );
    done.push(inc.id);
  }
  s.putJson(doneKey(paths), { done });
  return made;
}

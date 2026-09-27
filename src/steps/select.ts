import { existsSync } from "node:fs";
import { type LoadedConfig, projectPaths, readRunConfig, writeRunConfig } from "../config/load.ts";
import { RunConfigSchema } from "../config/schema.ts";
import { candidate, type FitView, fitFor, resolvePick, savePick } from "../core/selection.ts";
import { ask, confirm } from "../util/cli-io.ts";
import { readJson } from "../util/fsx.ts";

export function describeFit(r: FitView): string {
  const reason = {
    "no-deck": "no English deck",
    "does-not-fit": "does not fit within the cap",
    "max-reached": "the maximum number of decks is reached",
  };
  const extra = (n?: number) => (n ? ` (+${n} tablet-shaped, not analysed)` : "");
  const lines = [`Core check: our deck ${r.fit.ourImages} images${extra(r.ours.leftOut)}.`];
  r.fit.selected.forEach((c, i) => {
    lines.push(`  ${i + 1}. ${c.name}: ${c.deckLength} images${extra(c.leftOut)}`);
  });
  for (const s of r.fit.skipped) {
    lines.push(`  Left out: ${s.candidate.name} (${reason[s.reason]})`);
  }
  lines.push(r.fit.message);
  if (r.wholeDeckTotal !== r.fit.total) {
    lines.push(`Whole decks including tablet-shaped screenshots: ${r.wholeDeckTotal} images.`);
  }
  if (r.fit.ok) lines.push(`Screenshot positions compared in the core check: ${r.slots}.`);
  return lines.join("\n");
}

async function promptPick(loaded: LoadedConfig, log: (s: string) => void): Promise<string[]> {
  const current = readRunConfig(projectPaths(loaded))?.coreCompetitors ?? [];
  loaded.config.competitors.forEach((c, i) => {
    const n = candidate(loaded, c.id, c.name).deckLength || "no English deck";
    const mark = current.includes(c.id) ? "  [picked]" : "";
    log(`  ${String(i + 1).padStart(2)}. ${c.name} (${n})${mark}`);
  });
  const answer = await ask(
    "Type the numbers of the core competitors in priority order, e.g. 1,2,3: ",
  );
  return answer
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((n) => loaded.config.competitors[Number(n) - 1]?.id ?? `#${n}`);
}

/**
 * Saves the core competitor pick into the run config (fallback to the gallery page).
 * Sources: --pick "Name, Name, ..." (names or package ids), --from <file>, or a terminal prompt.
 */
export async function runSelect(
  loaded: LoadedConfig,
  opts: { pick?: string; from?: string; yes: boolean },
  log: (s: string) => void,
): Promise<boolean> {
  const paths = projectPaths(loaded);
  let items: string[];
  let source: "page" | "cli" | "file" = "cli";
  if (opts.pick) items = opts.pick.split(",");
  else if (opts.from && existsSync(opts.from)) {
    items = RunConfigSchema.pick({ coreCompetitors: true }).parse(
      readJson(opts.from),
    ).coreCompetitors;
    source = "file";
  } else items = await promptPick(loaded, log);
  if (items.length === 0) {
    log("Nothing entered. The selection is unchanged.");
    return false;
  }
  const { ids, problems } = resolvePick(loaded.config, items);
  if (problems.length) {
    for (const p of problems) log(p);
    log("Nothing was saved.");
    return false;
  }
  const r = savePick(loaded, ids, source);
  log(`Saved ${ids.length} core competitors.`);
  log(describeFit(r));
  if (!r.fit.ok) {
    log("This pick cannot start the core check yet. Change the pick and save again.");
    return false;
  }
  if (!(await confirm("Confirm this core list and its image count?", opts.yes))) {
    log("Saved, but not confirmed. The analysis approval screen will show it again.");
    return true;
  }
  writeRunConfig(paths, {
    coreCompetitors: ids,
    source,
    updatedAt: new Date().toISOString(),
    confirmed: {
      competitors: r.fit.selected.map((s) => s.appId),
      images: r.fit.total,
      slots: r.slots,
      at: new Date().toISOString(),
    },
  });
  log(`Confirmed: ${r.fit.selected.length} competitor decks plus ours, ${r.fit.total} images.`);
  return true;
}

export { fitFor as currentFit };

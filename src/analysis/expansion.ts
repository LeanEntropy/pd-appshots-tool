import { z } from "zod";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { analysedSlots, coreDeck, fitFor } from "../core/selection.ts";
import { mainMarket } from "../core/targets.ts";
import { type Increment, readJournal, updateJournal } from "../jobs/journal.ts";
import { workspaceStorage } from "../storage/index.ts";
import { readDeck } from "../store/manifest.ts";

/**
 * The expansion question after the core check (plan 5.1): more English competitors and/or other
 * countries, each with its image count. In this stage the choice is only saved; running an
 * expansion is the next stage.
 */
export interface ExpansionOptions {
  competitors: { appId: string; name: string; images: number }[];
  countries: { gl: string; hl: string; label: string; images: number }[];
  saved: { competitors: string[]; countries: string[]; savedAt: string | null };
}

export const ExpansionBody = z.strictObject({
  competitors: z.array(z.string().min(1).max(200)).max(60),
  countries: z.array(z.string().regex(/^[a-z]{2}$/)).max(40),
});

function saved(loaded: LoadedConfig): ExpansionOptions["saved"] {
  const paths = projectPaths(loaded);
  const inc = readJournal(workspaceStorage(paths.workspace), paths).increments;
  const pick = (kind: Increment["kind"]) =>
    inc.find((i) => i.kind === kind && i.state === "chosen");
  const c = pick("competitors");
  const n = pick("countries");
  return {
    competitors: c?.choice ?? [],
    countries: n?.choice ?? [],
    savedAt: [c?.savedAt, n?.savedAt].filter(Boolean).sort().at(-1) ?? null,
  };
}

export function expansionOptions(loaded: LoadedConfig): ExpansionOptions {
  const { config } = loaded;
  const paths = projectPaths(loaded);
  const view = fitFor(loaded);
  const inCore = new Set(view.fit.selected.map((c) => c.appId));
  const competitors = config.competitors
    .filter((c) => !inCore.has(c.id))
    .map((c) => ({
      appId: c.id,
      name: c.name,
      images: analysedSlots(config, coreDeck(loaded, c.id)).length,
    }))
    .filter((c) => c.images > 0);
  const base = mainMarket(config);
  const apps = [config.ourApp.id, ...inCore];
  const countries = config.markets
    .filter((m) => !(m.gl === base.gl && m.hl === base.hl))
    .map((m) => ({
      gl: m.gl,
      hl: m.hl,
      label: m.label,
      images: apps.reduce((n, appId) => {
        const d = readDeck(paths.decks, { appId, gl: m.gl, hl: m.hl });
        return n + (d?.status === "ok" ? analysedSlots(config, d).length : 0);
      }, 0),
    }));
  return { competitors, countries, saved: saved(loaded) };
}

/** Saves the user's expansion choice (replacing an earlier unrun choice). Runs nothing. */
export function saveExpansion(
  loaded: LoadedConfig,
  body: z.infer<typeof ExpansionBody>,
): ExpansionOptions | { problem: string } {
  const opts = expansionOptions(loaded);
  const okApps = new Set(opts.competitors.map((c) => c.appId));
  const okGl = new Set(opts.countries.map((c) => c.gl));
  if (body.competitors.some((a) => !okApps.has(a)) || body.countries.some((g) => !okGl.has(g)))
    return { problem: "The page sent a choice the tool does not know. Reload the page." };
  const paths = projectPaths(loaded);
  const now = new Date().toISOString();
  updateJournal(workspaceStorage(paths.workspace), paths, (j) => {
    j.increments = j.increments.filter((i) => i.state !== "chosen");
    const add = (kind: Increment["kind"], choice: string[]) => {
      if (choice.length)
        j.increments.push({ id: `${kind}-${now}`, kind, choice, state: "chosen", savedAt: now });
    };
    add("competitors", body.competitors);
    add("countries", body.countries);
  });
  return expansionOptions(loaded);
}

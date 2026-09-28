import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { mainMarketRef } from "./main-market.ts";
import { syncPresetReports } from "./migrate.ts";
import { listDefs } from "./store.ts";
import { buildPresetVersion, findReport } from "./version.ts";

/** `npm run report -- <report name or id>`: a new version of that report, no AI. Exit code. */
export function reportCommand(
  loaded: LoadedConfig,
  nameOrId: string,
  log: (s: string) => void,
): number {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  syncPresetReports(s, paths, mainMarketRef(loaded));
  const defs = listDefs(s, paths);
  const def = findReport(defs, nameOrId);
  if (!def) {
    log(`No report called "${nameOrId}". The reports of this project:`);
    for (const d of defs) log(`  ${d.name}   (id ${d.id})`);
    return 1;
  }
  try {
    const file = buildPresetVersion(loaded, def);
    log(`New version of "${def.name}", from the saved analyses (no AI): ${file}`);
    return 0;
  } catch (e) {
    log(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

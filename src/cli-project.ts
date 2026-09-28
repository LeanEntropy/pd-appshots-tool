import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type LoadedConfig, loadConfig } from "./config/load.ts";
import { loadProject, settingsKey, workspaceDir } from "./config/project.ts";
import { listProjects, markOpened, mostRecentProject } from "./config/registry.ts";
import { describeImport } from "./library/import/describe.ts";
import { runImport } from "./library/import/run-import.ts";
import { workspaceStorage } from "./storage/index.ts";
import type { Args } from "./util/cli-io.ts";

/** The repo root (taxonomy, prompts, configs and tools resolve from here). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const storage = () => workspaceStorage(workspaceDir(ROOT));

/**
 * Which project a command works on: --project <id>; else --config <file> (legacy and tests);
 * else the most recently opened project; else the Rogue Legend config (before its import).
 */
export function loadForCommand(args: Args, log: (s: string) => void): LoadedConfig {
  const id = args.flags.get("project");
  if (typeof id === "string") {
    const loaded = loadProject(id, { root: ROOT });
    markOpened(storage(), id);
    return loaded;
  }
  if (!args.flags.has("config")) {
    const recent = mostRecentProject(storage());
    if (recent) return loadProject(recent, { root: ROOT });
  }
  const loaded = loadConfig(args.config);
  const projectId = loaded.config.project;
  if (storage().exists(settingsKey({ projectId })))
    log(
      `Note: ${loaded.config.ourApp.name} was imported; its settings now live in the tool (--project ${projectId}). Using the config file as asked.`,
    );
  return loaded;
}

export function printProjects(log: (s: string) => void): void {
  const list = listProjects(storage());
  if (!list.length) {
    log("No projects yet. An existing project can be imported with: npm run migrate");
    return;
  }
  for (const p of list)
    log(
      `${p.name} (${p.id})${p.archived ? " [archived]" : ""}, last opened ${p.lastOpenedAt.slice(0, 10)}`,
    );
}

/** npm run migrate: a dry run unless --yes is given (the user's explicit action). */
export async function importCommand(args: Args, log: (s: string) => void): Promise<boolean> {
  const report = await runImport({
    root: ROOT,
    configPath: args.config,
    apply: args.yes,
    verifyHashes: !args.flags.has("skip-hash"),
    log,
  });
  log(describeImport(report));
  if (report.status === "dry-run")
    log("\nNothing was changed. To import, run: npm run migrate -- --yes");
  return report.status !== "blocked" && report.gate.length === 0;
}

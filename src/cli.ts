import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { refreshAllRecords } from "./analysis/record-refresh.ts";
import { writeCurrentReport } from "./analysis/report-inputs.ts";
import { importCommand, loadForCommand, printProjects, ROOT } from "./cli-project.ts";
import { type LoadedConfig, projectPaths } from "./config/load.ts";
import { cleanupTrialFiles } from "./library/trial-cleanup.ts";
import { asiaVsUs, writeOverview } from "./overview/overview-report.ts";
import { reportCommand } from "./reports/cli.ts";
import { ensureSameScreens } from "./reports/same-screen-run.ts";
import { openBrowser } from "./server/http-util.ts";
import { startToolServer } from "./server/instance.ts";
import { runAnalyzeStep } from "./steps/analyze.ts";
import { runDeckView } from "./steps/deck-view.ts";
import { type Check, runDoctor } from "./steps/doctor.ts";
import { runDownload } from "./steps/download.ts";
import { runOwnAssets } from "./steps/own-assets.ts";
import { buildPlan, newClient, planProblem, readPlan } from "./steps/preview.ts";
import { describePlan, previewMarkdown } from "./steps/preview-report.ts";
import { currentFit, describeFit, runSelect } from "./steps/select.ts";
import { runStoreTextBackfill } from "./steps/store-text.ts";
import { workspaceStorage } from "./storage/index.ts";
import { type Args, confirm, parseArgs } from "./util/cli-io.ts";

const log = (s: string) => console.log(s);

const HELP = `App Shots Optimizer: setup commands (no AI analysis)

  npm run doctor      Check this computer: Node, Python, PSD reader, disk space, Claude and Codex CLIs
                      (add -- --skip-ai to skip the two tiny AI connectivity prompts)
  npm run preview     Show what would be downloaded: store pages, images, disk space. Downloads nothing.
  npm run download    Download the previewed images after your approval (-- --yes to approve up front)
  npm run own-assets  Match our local files to our live deck; read the PSD if psd-tools is installed
  npm run deck-view   Build the offline raw deck pages and the gallery with the competitor picker
  npm start           Open the tool: all projects, each with its workspace (comparison grid,
                      competitor picker that saves automatically, Start analysis with its
                      approval screen first). -- --project <id> opens that project directly.
  npm run gallery     The same as npm start
  npm run pilot       Approval screen for the core pilot (no AI). Approve in the gallery, with /analyze
                      in Claude Code, or with -- --yes after you have seen the numbers
  npm run core        The same for the full core check
  npm run select      Save the pick from the terminal: -- --pick "Name, Name, ..." (fallback to the page)
  npm run fit         Show which whole decks fit in the core check with the current pick
  npm run overview    Free store overview per country (orientation, ratios, deck length, reuse, colours). No AI
  npm run report      Write the report from the saved analyses, no AI (-- --stage core for the core check)
                      -- "<report name or id>" saves a new version of that report instead (no AI)
  npm run refresh-records  Rebuild each analysis record's identity block and taxonomy mapping (no AI)
  npm run cleanup-trials   Remove the layout trial files (structure-test-v0.json) that equal docs/samples
  npm run store-text  Fill in the category, tags and store text of the pages already downloaded
                      (free, no AI). Shows the count first; -- --yes reads them, one at a time

  npm run projects    List the projects
  npm run migrate     Import an existing project into the shared image and analysis library.
                      Dry run by default (reads only); -- --yes imports. Nothing is downloaded or
                      analysed; the project's approval numbers stay the same.

Options: --project <id> (default: the most recently opened project), or --config <file>
         (default configs/rogue-legend.json, used until the project is imported)`;

function printChecks(checks: Check[]): boolean {
  let ok = true;
  for (const c of checks) {
    const mark = c.ok ? "[V]" : c.optional ? "[ ]" : "[X]";
    if (!c.ok && !c.optional) ok = false;
    log(`${mark} ${c.name}: ${c.detail}`);
  }
  log(ok ? "\nThis computer is ready." : "\nSome required checks failed (marked [X]).");
  return ok;
}

async function download(loaded: LoadedConfig, args: Args): Promise<boolean> {
  const plan = readPlan(projectPaths(loaded));
  if (!plan) {
    log("There is no download preview yet. Run the preview first: npm run preview");
    return false;
  }
  const problem = planProblem(plan, loaded.hash, loaded.config.download.metadataCacheHours);
  if (problem) {
    log(`${problem} Run the preview again: npm run preview`);
    return false;
  }
  log(describePlan(plan, loaded.config));
  log("");
  if (!(await confirm("Download these images now?", args.yes))) {
    log("Download cancelled. Nothing was downloaded.");
    return false;
  }
  const r = await runDownload(loaded, plan, log);
  const s = r.stats;
  const pct = s.nonBaselineSlots
    ? Math.round((100 * s.identicalToBaseline) / s.nonBaselineSlots)
    : 0;
  log(
    `\nDone. ${r.downloaded} new images downloaded, ${r.reused} reused, ${r.failed.length} failed.`,
  );
  log(
    `${s.games} games, ${s.decksAvailable} store pages with screenshots, ${s.decksUnavailable} not available in that country.`,
  );
  log(`${s.uniqueImages} unique images across ${s.slots} screenshot positions.`);
  log(
    `Screenshots identical to the same game's English deck: ${s.identicalToBaseline} of ${s.nonBaselineSlots} (${pct}%).`,
  );
  log(`Run record: ${r.manifestPath}`);
  for (const f of r.failed.slice(0, 10)) log(`  Could not download: ${f}`);
  const complete = r.failed.length === 0 && s.decksFailed === 0 && plan.incomplete.length === 0;
  if (!complete)
    log(
      "The download is incomplete (see above). Run the preview and download again to fill the gaps.",
    );
  return complete;
}

/** One server for all projects; a second start opens the running one instead. */
async function start(args: Args): Promise<number> {
  const p = args.flags.get("port");
  const project = args.flags.get("project");
  const { server, origin } = await startToolServer({
    root: ROOT,
    port: typeof p === "string" ? Number(p) : 4777,
  });
  const url =
    typeof project === "string" ? `${origin}/p/${encodeURIComponent(project)}/` : `${origin}/`;
  if (!args.flags.has("no-open")) openBrowser(url);
  if (!server) {
    log(
      `The tool is already running: ${url}${args.flags.has("no-open") ? "" : " (opened in your browser)"}.`,
    );
    return 0;
  }
  log(`App Shots Optimizer: ${url}
Everything you choose saves automatically. Keep this window open while you use the page; press Ctrl+C to stop.`);
  await new Promise(() => {});
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "help" || args.flags.has("help")) {
    log(HELP);
    return 0;
  }
  if (args.command === "projects") {
    printProjects(log);
    return 0;
  }
  if (args.command === "migrate" || args.command === "import")
    return (await importCommand(args, log)) ? 0 : 1;
  if (args.command === "start" || args.command === "gallery") return start(args);
  const loaded = loadForCommand(args, log);
  switch (args.command) {
    case "doctor":
      return printChecks(await runDoctor(loaded, { skipAi: args.flags.has("skip-ai") })) ? 0 : 1;
    case "preview": {
      const plan = await buildPlan(loaded, log);
      writeFileSync(
        join(projectPaths(loaded).pending, "download-preview.md"),
        previewMarkdown(plan, loaded.config),
      );
      log(`\n${describePlan(plan, loaded.config)}`);
      log("\nNothing has been downloaded. To download, run: npm run download");
      return 0;
    }
    case "download":
      return (await download(loaded, args)) ? 0 : 1;
    case "own-assets":
      await runOwnAssets(loaded, log);
      return 0;
    case "deck-view": {
      const r = runDeckView(loaded);
      log(
        `Built ${r.deckPages} deck pages.\nIndex: ${r.index}\nGallery (open in a browser): ${r.gallery}`,
      );
      return 0;
    }
    case "select": {
      const str = (k: string) => {
        const v = args.flags.get(k);
        return typeof v === "string" ? v : undefined;
      };
      const opts = { pick: str("pick"), from: str("from"), yes: args.yes };
      return (await runSelect(loaded, opts, log)) ? 0 : 1;
    }
    case "fit": {
      const r = currentFit(loaded);
      log(describeFit(r));
      return r.fit.ok ? 0 : 1;
    }
    case "pilot":
    case "core": {
      const opts = { yes: args.yes, dryRun: args.flags.has("dry-run") };
      return (await runAnalyzeStep(loaded, args.command, opts, log)) ? 0 : 1;
    }
    case "report": {
      const name = args.positional.join(" ").trim();
      // "Same screen uploaded twice" (free, cached per pair) before the report is built.
      await ensureSameScreens(loaded);
      if (name) return reportCommand(loaded, name, log);
      const stage = args.flags.get("stage") === "core" ? "core" : "pilot";
      log(`Report from the saved analyses (no AI): ${writeCurrentReport(loaded, stage)}`);
      return 0;
    }
    case "overview": {
      const { file, overview } = await writeOverview(loaded);
      const a = asiaVsUs(overview.markets);
      log(`Store overview (no AI): ${file}
Landscape images: US ${Math.round(a.us * 100)}%, Asian markets ${Math.round(a.asia * 100)}%.`);
      return 0;
    }
    case "refresh-records": {
      const r = await refreshAllRecords(loaded);
      log(`Refreshed ${r.records} analysis records (identity and taxonomy mapping, no AI call).`);
      for (const m of r.mapped) log(`  ${m}`);
      return 0;
    }
    case "cleanup-trials": {
      const dir = join(ROOT, "docs", "samples");
      const samples = readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "structure.json")))
        .map(
          (e) => JSON.parse(readFileSync(join(dir, e.name, "structure.json"), "utf8")) as unknown,
        );
      const storage = workspaceStorage(projectPaths(loaded).workspace);
      const plan = cleanupTrialFiles(storage, samples, false);
      for (const k of plan.kept) log(`Kept ${k.key}: ${k.reason}`);
      const go = plan.found.length - plan.kept.length;
      if (!go) {
        log("No trial files to remove.");
        return 0;
      }
      log(`${go} trial files (structure-test-v0.json) equal their copies in docs/samples.`);
      if (!(await confirm("Remove them from the library?", args.yes))) return 0;
      for (const k of cleanupTrialFiles(storage, samples, true).removed) log(`Removed ${k}`);
      return 0;
    }
    case "store-text": {
      const client = newClient(loaded, projectPaths(loaded));
      const r = await runStoreTextBackfill(loaded, { yes: args.yes, log, client });
      return r.failed ? 1 : 0;
    }
    case "publish-deck-view":
      log(
        "Publishing the gallery as a private claude.ai page is done from Claude Code (Artifact tool) using views/gallery.html; the page will then save the pick to its page database. Until then, use the local gallery and npm run select.",
      );
      return 0;
    default:
      log(`Unknown command "${args.command}".\n\n${HELP}`);
      return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  },
);

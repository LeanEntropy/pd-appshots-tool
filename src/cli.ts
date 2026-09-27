import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { refreshAllRecords } from "./analysis/record-refresh.ts";
import { importCommand, loadForCommand, printProjects } from "./cli-project.ts";
import { type LoadedConfig, projectPaths } from "./config/load.ts";
import { asiaVsUs, writeOverview } from "./overview/overview-report.ts";
import { openBrowser, startGalleryServer } from "./server/gallery-server.ts";
import { runAnalyzeStep } from "./steps/analyze.ts";
import { runDeckView } from "./steps/deck-view.ts";
import { type Check, runDoctor } from "./steps/doctor.ts";
import { runDownload } from "./steps/download.ts";
import { runOwnAssets } from "./steps/own-assets.ts";
import { buildPlan, planProblem, readPlan } from "./steps/preview.ts";
import { describePlan, previewMarkdown } from "./steps/preview-report.ts";
import { currentFit, describeFit, runSelect } from "./steps/select.ts";
import { type Args, confirm, parseArgs } from "./util/cli-io.ts";

const log = (s: string) => console.log(s);

const HELP = `Store Screenshot Recipe: setup commands (no AI analysis)

  npm run doctor      Check this computer: Node, Python, PSD reader, disk space, Claude and Codex CLIs
                      (add -- --skip-ai to skip the two tiny AI connectivity prompts)
  npm run preview     Show what would be downloaded: store pages, images, disk space. Downloads nothing.
  npm run download    Download the previewed images after your approval (-- --yes to approve up front)
  npm run own-assets  Match our local files to our live deck; read the PSD if psd-tools is installed
  npm run deck-view   Build the offline raw deck pages and the gallery with the competitor picker
  npm run gallery     Open the gallery: comparison grid, competitor picker (saves automatically),
                      and the Start analysis button (approval screen first)
  npm run pilot       Approval screen for the core pilot (no AI). Approve in the gallery, with /analyze
                      in Claude Code, or with -- --yes after you have seen the numbers
  npm run core        The same for the full core check
  npm run select      Save the pick from the terminal: -- --pick "Name, Name, ..." (fallback to the page)
  npm run fit         Show which whole decks fit in the core check with the current pick
  npm run overview    Free store overview per country (orientation, ratios, deck length, reuse, colours). No AI
  npm run refresh-records  Rebuild each analysis record's identity block and taxonomy mapping (no AI)

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
    case "gallery": {
      const p = args.flags.get("port");
      const { url } = await startGalleryServer(loaded, typeof p === "string" ? Number(p) : 4777);
      log(`Gallery: ${url}
Your pick saves automatically. Keep this window open while you use the page; press Ctrl+C to stop.`);
      if (!args.flags.has("no-open")) openBrowser(url);
      await new Promise(() => {});
      return 0;
    }
    case "pilot":
    case "core": {
      const opts = { yes: args.yes, dryRun: args.flags.has("dry-run") };
      return (await runAnalyzeStep(loaded, args.command, opts, log)) ? 0 : 1;
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

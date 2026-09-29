import { join, resolve } from "node:path";
import { loadConfig } from "../config/load.ts";
import { kbFiles, readJsonFile, writeJsonFile } from "../storage/kb-files.ts";
import { blindPair, type EvalReport, evalCost } from "./eval.ts";
import { importSeeds } from "./import-seed.ts";
import { today } from "./open.ts";
import { promote } from "./promote.ts";
import { RecallSetSchema, recallOf } from "./recall.ts";
import { refreshOfficial } from "./refresh-official.ts";
import { loadKb } from "./release.ts";
import { reviewList, syncOfficial } from "./review.ts";
import { SOURCE_CUTOFF } from "./source-date.ts";

/**
 * Knowledge-base scripts (run from Claude Code; none of them calls a model):
 *   npm run kb -- import <seed folder> [more folders]   rebuild the inbox from seed files
 *   npm run kb -- review                                what waits for the user's approval
 *   npm run kb -- refresh-official                      re-check the official pages (free, no AI)
 *   npm run kb -- release [--dry-run]                   promote approved entries to a release
 *   npm run kb -- recall [recall-set.json]              retrieval recall against its gate
 *   npm run kb -- eval-cost [config]                    what the blind evaluation would cost
 *   npm run kb -- eval-blind <step> <with.json> <without.json> <out folder> <seed>
 */
const root = resolve(import.meta.dirname, "..", "..");
const files = kbFiles(root);
const [cmd, ...args] = process.argv.slice(2);
const date = today();

function print(lines: (string | false | null | undefined)[]): void {
  for (const l of lines) if (l) console.log(l);
}

switch (cmd) {
  case "import": {
    if (!args.length) throw new Error("Give at least one seed folder.");
    const r = importSeeds(files, args, date);
    const o = syncOfficial(files, date);
    print([
      `Imported ${r.imported} entries and ${r.sources} sources into kb/inbox; rejected ${r.rejects.length}.`,
      `Source date rule (before ${r.dateRule.cutoff}; undated only when a refresh confirmed them): removed ${r.dateRule.removedSources.length} sources ${JSON.stringify(r.dateRule.removedByType)}; dropped ${r.dateRule.droppedEntries.length} entries left without a source; ${r.dateRule.trustChanged.length} entries changed trust level.`,
      `By trust: ${JSON.stringify(r.byTrust)}`,
      `By market: ${JSON.stringify(r.byMarket)}`,
      `By rule class: ${JSON.stringify(r.byRuleClass)}`,
      `By kind: ${JSON.stringify(r.byKind)}`,
      ...r.files.map((f) => `  ${f.name} (${f.format}): ${f.imported} of ${f.entries}`),
      r.rejects.length > 0 && "Rejects (full list in kb/inbox/import-report.json):",
      ...r.rejects.slice(0, 40).map((x) => `  ${x.file} ${x.id}: ${x.reasons.join("; ")}`),
      r.warnings.length > 0 && `${r.warnings.length} warnings (see the report).`,
      `Official entries: ${o.current} current, approved automatically; ${o.needsCheck} need a freshness check; ${o.changed} changed (one by one).`,
    ]);
    break;
  }
  case "review": {
    const l = reviewList(files, date);
    print([
      `Approved automatically (official): ${l.auto.filter((i) => i.how === "auto").length}; needing a freshness check: ${l.counts.needs_check}.`,
      `One by one: ${l.one.length}; in bulk (unverified): ${l.bulk.length}.`,
      `Waiting ${l.counts.pending}, changed ${l.counts.changed}, approved ${l.counts.approved}, rejected ${l.counts.rejected}.`,
      "Review them in the tool: npm start, then open /knowledge.",
      ...l.problems.map((p) => `Problem: ${p}`),
    ]);
    break;
  }
  case "refresh-official": {
    console.log("Re-checking the official pages (one at a time)...");
    const r = await refreshOfficial(files, date, { progress: (l) => console.log(l) });
    print([
      `Pages: ${r.pages} (ok ${r.byStatus.ok}, gone ${r.byStatus.gone}, moved ${r.byStatus.moved}, not reached ${r.byStatus.error}).`,
      `Undated sources: ${r.undated} checked, ${r.undatedKept} count now (live official or law page, or a page dated ${SOURCE_CUTOFF} or later).`,
      "Run the import again to see the counts with the date rule applied.",
      `Official entries: ${r.current} current, approved automatically; ${r.changed.length} changed (one by one); ${r.needsCheck} need a freshness check; ${r.unreachable.length} with a page not reached.`,
      ...r.changed.map((c) => `  changed ${c.id}: ${c.problems.join("; ")}`),
    ]);
    break;
  }
  case "release": {
    const p = promote(files, date, args.includes("--dry-run"));
    print([
      p.unchanged
        ? `Nothing new: release ${p.version} stays.`
        : `Release ${p.version}${args.includes("--dry-run") ? " (dry run, nothing written)" : ""}: +${p.added.length} added, ${p.changed.length} changed, ${p.removed.length} removed.`,
      `By trust: ${JSON.stringify(p.counts)}`,
      ...p.held.map((h) => `Note: ${h}`),
      !p.unchanged &&
        "Reports built with an older release show their AI parts as out of date only when rebuilt; regenerating stays your choice.",
    ]);
    break;
  }
  case "recall": {
    const set = RecallSetSchema.parse(
      readJsonFile(args[0] ?? join(files.dir, "eval", "recall-set.json")),
    );
    const r = recallOf(loadKb(files, "release", date), set);
    print([
      `Recall ${Math.round(r.recall * 100)} % (${r.found} of ${r.total}), gate ${Math.round(r.gate * 100)} %: ${r.pass ? "passed" : "not passed"}.`,
      ...r.cases
        .filter((c) => c.missing.length || c.blocked)
        .map(
          (c) =>
            `  ${c.id}: missing ${c.missing.join(", ")}${c.blocked ? `; blocked: ${c.blocked}` : ""}`,
        ),
    ]);
    process.exitCode = r.pass ? 0 : 1;
    break;
  }
  case "eval-cost": {
    const { config } = loadConfig(args[0] ?? join(root, "configs", "rogue-legend.json"));
    const set = readJsonFile(join(files.dir, "eval", "set.json")) as { reports: EvalReport[] };
    const c = evalCost(
      {
        ...config,
        options: { ...config.options, knowledge: { ...config.options.knowledge, enabled: true } },
      },
      set.reports,
    );
    print([
      "Blind evaluation (not run; needs your approval):",
      ...c.lines.map(
        (l) =>
          `  ${l.name}: ${l.steps} judged steps, $${l.usd[0].toFixed(2)} to $${l.usd[1].toFixed(2)}`,
      ),
      `Total: $${c.usd[0].toFixed(2)} to $${c.usd[1].toFixed(2)} (crafted hard cases add a few text calls each).`,
    ]);
    break;
  }
  case "eval-blind": {
    const [step, withFile, withoutFile, out, seed] = args;
    if (!step || !withFile || !withoutFile || !out || !seed)
      throw new Error("eval-blind <step> <with.json> <without.json> <out folder> <seed>");
    const b = blindPair(step, readJsonFile(withFile), readJsonFile(withoutFile), seed);
    writeJsonFile(join(out, `${step}.packet.json`), b.packet);
    writeJsonFile(join(out, "keys", `${step}.key.json`), { ...b.key, seed });
    print([
      `Wrote ${step}.packet.json (blind) and keys/${step}.key.json (keep it away from the judges).`,
    ]);
    break;
  }
  default:
    print([
      "Commands: import, review, refresh-official, release, recall, eval-cost, eval-blind (see src/kb/cli.ts).",
    ]);
}

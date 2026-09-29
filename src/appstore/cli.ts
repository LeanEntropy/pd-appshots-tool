import { ROOT } from "../cli-project.ts";
import { formatBytes, parseArgs } from "../util/cli-io.ts";
import { type AppStoreJobResult, runAppStoreJob } from "./job.ts";

/**
 * npm run appstore -- --project <id> [--enable] [--match-only] [--root <tool folder>]
 * Matches the project's games (ours plus the picked competitors) on the App Store in every
 * project country, then downloads the automatically matched decks. Free: Apple's Lookup API and
 * image downloads only, no AI. Prints a short summary; the full result is saved under the
 * project's appstore-runs folder.
 */
function summary(r: AppStoreJobResult): string {
  const m = r.matches;
  const lines = [
    `Matches: ${m.auto.length} automatic, ${m.confirmed.length} confirmed earlier, ${m.confirm.length} need your confirmation, ${m.notFound.length} not found/not sold, ${m.failed.length} failed`,
  ];
  if (m.confirm.length) lines.push(`  Need confirmation: ${m.confirm.join("; ")}`);
  if (m.failed.length) lines.push(`  Failed: ${m.failed.join("; ")}`);
  let bytes = 0;
  for (const c of r.countries) {
    bytes += c.bytes;
    lines.push(
      `${c.gl.toUpperCase()}: ${c.decks} decks, ${c.screenshots} screenshots (${c.sameFile} identical file, ${c.samePicture} same picture as Play, ${c.fresh} new), ${c.notSold} not sold, ${c.identityChanged} identity changed, ${formatBytes(c.bytes)}`,
    );
    for (const f of c.failed) lines.push(`  failed: ${f}`);
  }
  lines.push(
    `Downloaded ${formatBytes(bytes)} in ${r.seconds} s; ${r.apiRequests} API requests, ${r.throttled} rate-limit waits.`,
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const args = parseArgs(["appstore", ...process.argv.slice(2)]);
  const projectId = args.flags.get("project");
  if (typeof projectId !== "string") {
    console.log("Usage: npm run appstore -- --project <id> [--enable] [--match-only]");
    process.exitCode = 1;
    return;
  }
  const r = await runAppStoreJob({
    // --root: another checkout's folder (its configs and workspace), e.g. from a worktree.
    root: typeof args.flags.get("root") === "string" ? String(args.flags.get("root")) : ROOT,
    projectId,
    enable: args.flags.has("enable"),
    matchOnly: args.flags.has("match-only"),
    log: args.flags.has("quiet") ? () => {} : (s) => console.log(s),
  });
  console.log(summary(r));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});

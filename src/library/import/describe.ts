import type { ImportReport } from "./run-import.ts";
import type { PlanFacts, Snapshot } from "./snapshot.ts";

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
const usd = (u: [number, number]) => `$${u[0].toFixed(2)}–${u[1].toFixed(2)}`;

function planLine(label: string, p: PlanFacts | { error: string }): string {
  if ("error" in p) return `  ${label}: cannot be planned (${p.error})`;
  return `  ${label}: ${p.newImages} images to analyse, ${usd(p.usd)}, fingerprint ${p.planHash.slice(0, 12)}`;
}

function snapshotLines(s: Snapshot): string[] {
  return [
    `  ${s.imageCount} images, ${s.usableRecords} usable analyses`,
    planLine("Pilot approval", s.plans.pilot),
    planLine("Core approval", s.plans.core),
  ];
}

/** Plain-language summary of an import or its dry run. */
export function describeImport(r: ImportReport): string {
  const out: string[] = [];
  if (r.status === "already-imported") {
    out.push(`${r.name} already uses the shared library. Nothing to import.`);
    out.push(...snapshotLines(r.before));
    return out.join("\n");
  }
  out.push(
    r.status === "dry-run"
      ? `Import ${r.name} into the shared library: DRY RUN (nothing written)`
      : `Import ${r.name}: ${r.status}`,
  );
  if (r.blocked) out.push(`  Waiting: ${r.blocked}`);
  out.push(
    `  Settings: ${r.settings.equal ? "the imported settings give exactly the current config" : "DIFFER from the current config"}${r.settings.overrides.length ? ` (kept as advanced values: ${r.settings.overrides.join(", ")})` : ""}.`,
  );
  out.push(`  Images: ${r.images} (${gb(r.bytes)}), ${r.alreadyInLibrary} already in the library.`);
  const f = r.files;
  out.push(
    `  Files to hardlink (no extra disk space; copied only where linking is impossible): ${f.original ?? 0} originals, ${f.thumbnail ?? 0} thumbnails, ${f["model copy"] ?? 0} model copies, ${f["model answer"] ?? 0} cached model answers.`,
  );
  out.push(`  Pixel facts: ${r.pixelFacts}. Google image ids: ${r.googleIds}.`);
  if (r.hashes)
    out.push(
      r.hashes.bad.length
        ? `  Content check: ${r.hashes.bad.length} of ${r.hashes.checked} originals do NOT match their hash (first: ${r.hashes.bad[0]}).`
        : `  Content check: all ${r.hashes.checked} originals match their content hash.`,
    );
  out.push(
    `  Analysis records: ${r.records.total}. Reusable by other projects: ${r.records.proven}. This project only (settings not proven): ${r.records.unproven}.`,
  );
  for (const [reason, n] of Object.entries(r.records.reasons)) out.push(`    ${n} × ${reason}`);
  if (r.linkCounts)
    out.push(
      `  Linked ${r.linkCounts.linked}, copied ${r.linkCounts.copied}, already there ${r.linkCounts.existed}.`,
    );
  out.push("  Before:", ...snapshotLines(r.before));
  if (r.after) out.push("  After:", ...snapshotLines(r.after));
  if (r.gate.length) out.push(`  Check: ${r.gate.join("; ")}`);
  else if (r.after)
    out.push("  Check: images, approval numbers, report freshness and views unchanged.");
  out.push("  Nothing is downloaded and nothing is sent to AI.");
  return out.join("\n");
}

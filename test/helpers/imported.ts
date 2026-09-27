import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { buildAnalysisPlan } from "../../src/analysis/plan.ts";
import { writeRecord } from "../../src/analysis/records.ts";
import { runAnalysis } from "../../src/analysis/run.ts";
import { type LoadedConfig, projectPaths } from "../../src/config/load.ts";
import { savePick } from "../../src/core/selection.ts";
import { sha256 } from "../../src/util/hash.ts";
import { fakeProvider } from "./fake-provider.ts";
import { tempProject } from "./project.ts";

export const DECKS = {
  "Archero 2": { phone: 3, tablet: 1 },
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 1, tablet: 0 },
  Heroll: { phone: 1, tablet: 0 },
  Dicero: { phone: 1, tablet: 0 },
};
export const PICK = [
  "com.xq.archeroii",
  "com.habby.capybara",
  "com.loadcomplete.minitales",
  "com.percent.aos.rollinghero",
  "com.bailing.lark.roll.dev",
];

/** Providers reporting the configured model names, so their results can be proven. */
export function providers() {
  const read = () => ({ screenType: "gameplay", headline: "EPIC BOSS FIGHTS!" });
  return {
    producer: fakeProvider({ model: "claude-fable-5-1", read }),
    reviewer: fakeProvider({ model: "gpt-5.6-sol", family: "openai", read }),
    adjudicator: fakeProvider({ model: "claude-opus-5-5", read }),
    onProgress: () => {},
  };
}

/**
 * A project as it is before the library: images, a finished pilot (8 proven records, cached
 * answers, run manifest, report) and one failed record from an interrupted run (unproven).
 */
export async function legacyProject(): Promise<{ loaded: LoadedConfig; root: string }> {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  await runAnalysis(loaded, buildAnalysisPlan(loaded, "pilot"), providers());
  const core = buildAnalysisPlan(loaded, "core");
  const extra = core.items.find((i) => i.tier === "full");
  if (!extra) throw new Error("expected a core image without analysis");
  writeRecord(projectPaths(loaded), {
    imageId: extra.imageId,
    appId: extra.appId,
    gl: "us",
    hl: "en",
    position: extra.position,
    status: "failed",
    final: null,
    producer: null,
    reviewer: null,
    adjudication: null,
    differences: [],
    problems: ["interrupted"],
    runId: "2026-01-01T00-00-00-000Z-core",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  return { loaded, root: dirname(dirname(loaded.path)) };
}

export function files(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
    );
  } catch {
    return [];
  }
}

/** Every file under a folder with its content hash (to prove nothing changed). */
export function fingerprint(dir: string, skip: (rel: string) => boolean = () => false) {
  const out: Record<string, string> = {};
  for (const f of files(dir)) {
    const r = relative(dir, f).split("\\").join("/");
    if (!skip(r)) out[r] = sha256(readFileSync(f));
  }
  return out;
}

export const links = (f: string) => statSync(f).nlink;

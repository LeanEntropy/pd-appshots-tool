import { readFileSync, rmSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromRoot, type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { formatBytes } from "../util/cli-io.ts";
import { ensureDir } from "../util/fsx.ts";
import { findPsdPython, pythonCandidates, run } from "../util/proc.ts";

export interface Check {
  name: string;
  ok: boolean;
  /** Optional checks warn instead of failing the host check. */
  optional?: boolean;
  detail: string;
}

const PROBE = "Reply with the single word OK and nothing else.";

async function checkClaude(root: string, model: string): Promise<Check> {
  const args = [
    "-p",
    "--model",
    model,
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--system-prompt-file",
    join(root, "prompts", "doctor-system.txt"),
    "--tools",
    "",
    "--output-format",
    "json",
    "--max-budget-usd",
    "0.10",
  ];
  const r = await run("claude", args, { input: PROBE, timeoutMs: 180_000 });
  const name = `Claude CLI (${model})`;
  try {
    const out = JSON.parse(r.stdout) as {
      result?: string;
      is_error?: boolean;
      total_cost_usd?: number;
    };
    const ok = r.code === 0 && !out.is_error && /\bOK\b/i.test(out.result ?? "");
    const cost = out.total_cost_usd !== undefined ? `, cost $${out.total_cost_usd.toFixed(4)}` : "";
    return {
      name,
      ok,
      detail: ok ? `answered${cost}` : `unexpected answer: ${(out.result ?? "").slice(0, 120)}`,
    };
  } catch {
    return {
      name,
      ok: false,
      detail: r.timedOut
        ? "timed out"
        : (r.stderr || r.stdout).trim().slice(0, 200) || `exit code ${r.code}`,
    };
  }
}

async function checkCodex(model: string): Promise<Check> {
  const out = join(tmpdir(), `ssr-doctor-${process.pid}-${model}.txt`);
  const args = [
    "exec",
    "-m",
    model,
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--ephemeral",
    "-o",
    out,
    "-",
  ];
  const r = await run("codex", args, { input: PROBE, timeoutMs: 180_000 });
  const name = `Codex CLI (${model})`;
  let answer = "";
  try {
    answer = readFileSync(out, "utf8");
    rmSync(out, { force: true });
  } catch {
    answer = r.stdout;
  }
  const ok = r.code === 0 && /\bOK\b/i.test(answer);
  return {
    name,
    ok,
    detail: ok
      ? "answered"
      : r.timedOut
        ? "timed out"
        : (r.stderr || answer).trim().slice(-200) || `exit code ${r.code}`,
  };
}

/** Distinct CLI models used by regular roles (special-case models are not probed). */
export function modelsToProbe(models: Record<string, string | undefined>): {
  claude: string[];
  codex: string[];
} {
  const claude = new Set<string>();
  const codex = new Set<string>();
  for (const [role, ref] of Object.entries(models)) {
    if (!ref || role === "imageReviewSpecial") continue;
    const [provider, model] = ref.split(":") as [string, string];
    (provider === "claude" ? claude : codex).add(model);
  }
  return { claude: [...claude], codex: [...codex] };
}

export async function runDoctor(loaded: LoadedConfig, opts: { skipAi: boolean }): Promise<Check[]> {
  const checks: Check[] = [];
  const major = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node.js",
    ok: major >= 22,
    detail: `version ${process.versions.node} (needs 22 or newer)`,
  });

  // First Python that runs, in the same priority order the PSD reader uses.
  let pyVersion = "";
  let pyPath = "";
  for (const py of pythonCandidates(loaded.root)) {
    const pv = await run(py, ["--version"], { timeoutMs: 30_000 });
    if (pv.code === 0) {
      pyVersion = (pv.stdout || pv.stderr).trim();
      pyPath = py;
      break;
    }
  }
  const m = /Python (\d+)\.(\d+)/.exec(pyVersion);
  const pyOk = !!m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10));
  checks.push({
    name: "Python",
    ok: pyOk,
    optional: true,
    detail: pyOk
      ? `${pyVersion} (${pyPath})`
      : `${pyVersion || "not found"}; 3.10 or newer is needed only for the optional PSD reader`,
  });

  const psdPy = await findPsdPython(loaded.root);
  checks.push({
    name: "PSD reader (psd-tools)",
    ok: !!psdPy,
    optional: true,
    detail: psdPy
      ? `available via ${psdPy}`
      : "not installed. Optional. Install with: python -m venv .venv && .venv/Scripts/python -m pip install -r tools/psd/requirements.txt",
  });

  try {
    const t = loadTaxonomy(loaded);
    checks.push({
      name: "Taxonomy file",
      ok: true,
      detail: `${t.taxonomy.id} version ${t.taxonomy.version}, ${t.taxonomy.screenTypes.length} screen types`,
    });
  } catch (e) {
    checks.push({
      name: "Taxonomy file",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const paths = projectPaths(loaded);
  ensureDir(paths.base);
  const fs = statfsSync(paths.base);
  const free = fs.bavail * fs.bsize;
  checks.push({
    name: "Free disk space",
    ok: free > 5 * 1024 ** 3,
    detail: `${formatBytes(free)} free where the workspace lives (${fromRoot(loaded, loaded.config.workspace)})`,
  });

  if (opts.skipAi) {
    checks.push({
      name: "AI command-line tools",
      ok: true,
      optional: true,
      detail: "skipped at your request",
    });
    return checks;
  }
  const probe = modelsToProbe(loaded.config.models);
  for (const model of probe.claude) checks.push(await checkClaude(loaded.root, model));
  for (const model of probe.codex) checks.push(await checkCodex(model));
  return checks;
}

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function quoteForCmd(a: string): string {
  return a === "" || /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

/**
 * Runs a program, optionally feeding text on stdin. On Windows, npm-installed CLIs are .cmd
 * shims that need a shell, so arguments are quoted for cmd.exe there.
 */
export function run(
  cmd: string,
  args: readonly string[],
  opts: { input?: string; timeoutMs?: number; cwd?: string } = {},
): Promise<ProcResult> {
  const win = process.platform === "win32";
  const useShell = win && !cmd.toLowerCase().endsWith(".exe");
  const finalArgs = useShell ? args.map(quoteForCmd) : [...args];
  return new Promise((resolve) => {
    const child = spawn(cmd, finalArgs, { shell: useShell, cwd: opts.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs ?? 120_000);
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + e.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.stdin.end(opts.input ?? "");
  });
}

/** Python used for the optional PSD helper: PSD_PYTHON, then the repo's .venv, then PATH. */
export function pythonCandidates(root: string): string[] {
  const list: string[] = [];
  if (process.env.PSD_PYTHON) list.push(process.env.PSD_PYTHON);
  for (const p of [
    join(root, ".venv", "Scripts", "python.exe"),
    join(root, ".venv", "bin", "python"),
  ]) {
    if (existsSync(p)) list.push(p);
  }
  list.push(process.platform === "win32" ? "python" : "python3");
  return list;
}

/** First Python that can import psd_tools, or null. */
export async function findPsdPython(root: string): Promise<string | null> {
  for (const py of pythonCandidates(root)) {
    const r = await run(py, ["-c", "import psd_tools"], { timeoutMs: 30_000 });
    if (r.code === 0) return py;
  }
  return null;
}

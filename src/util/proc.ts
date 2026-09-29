import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, extname, isAbsolute, join } from "node:path";

export interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** How a command is actually started. `shell` is only ever used for plain arguments. */
export interface Resolved {
  file: string;
  prefixArgs: string[];
  shell: boolean;
}

const PLAIN_ARG = /^[A-Za-z0-9 _\-.,:=@+/\\]*$/;
const MAX_SHELL_ARG = 2000;

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Finds a command on PATH the way Windows does (PATHEXT), or returns null. */
export function findOnPath(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const exts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const candidates = extname(cmd) ? [cmd] : exts.map((e) => cmd + e.toLowerCase());
  const dirs =
    isAbsolute(cmd) || cmd.includes("/") || cmd.includes("\\")
      ? [""]
      : (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  for (const d of dirs) {
    for (const c of candidates) {
      const p = d ? join(d, c) : c;
      if (isFile(p)) return p;
    }
  }
  return null;
}

/** The script an npm-generated .cmd shim runs with node, e.g. node_modules\@openai\codex\bin\codex.js. */
export function npmShimTarget(shimPath: string): string | null {
  const text = readFileSync(shimPath, "utf8");
  // npm templates: "%dp0%\node_modules\...\x.js" (current) and "%~dp0\node_modules\...\x.js" (older).
  const m = /"%(?:dp0%|~dp0)\\?([^"%]+\.(?:js|mjs|cjs))"/i.exec(text);
  if (!m?.[1]) return null;
  const script = join(dirname(shimPath), m[1]);
  return existsSync(script) ? script : null;
}

/**
 * Windows: a real .exe is started directly (shell:false, libuv quotes each argument correctly);
 * an npm .cmd shim is replaced by `node <script>` (also shell:false). Only an unknown .cmd/.bat
 * goes through cmd.exe, and then only with plain arguments (see assertShellSafe).
 */
export function resolveCommand(cmd: string, env: NodeJS.ProcessEnv = process.env): Resolved {
  if (process.platform !== "win32") return { file: cmd, prefixArgs: [], shell: false };
  const found = findOnPath(cmd, env);
  if (!found) return { file: cmd, prefixArgs: [], shell: false };
  const ext = extname(found).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    const script = npmShimTarget(found);
    if (script) {
      const localNode = join(dirname(found), "node.exe");
      return {
        file: existsSync(localNode) ? localNode : process.execPath,
        prefixArgs: [script],
        shell: false,
      };
    }
    return { file: found, prefixArgs: [], shell: true };
  }
  return { file: found, prefixArgs: [], shell: false };
}

/** cmd.exe re-parses the command line; anything but plain words could be mangled. */
export function assertShellSafe(file: string, args: readonly string[]): void {
  for (const a of args) {
    if (!PLAIN_ARG.test(a) || a.length > MAX_SHELL_ARG || a.endsWith("\\")) {
      throw new Error(
        `Refusing to pass this argument to ${file} through cmd.exe, because cmd.exe would change it: ${a.slice(0, 80)}${a.length > 80 ? "..." : ""}. Install the program as an .exe or pass the value on stdin.`,
      );
    }
  }
}

/** Runs a program, optionally feeding text on stdin. Never passes JSON or long text through cmd.exe. */
export function run(
  cmd: string,
  args: readonly string[],
  opts: { input?: string; timeoutMs?: number; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<ProcResult> {
  let r: Resolved;
  try {
    r = resolveCommand(cmd, opts.env ?? process.env);
    if (r.shell) assertShellSafe(r.file, args);
  } catch (e) {
    return Promise.resolve({
      code: -1,
      stdout: "",
      stderr: e instanceof Error ? e.message : String(e),
      timedOut: false,
    });
  }
  const finalArgs = r.shell
    ? args.map((a) => (a === "" || /\s/.test(a) ? `"${a}"` : a))
    : [...r.prefixArgs, ...args];
  const file = r.shell && /\s/.test(r.file) ? `"${r.file}"` : r.file;
  return new Promise((resolve) => {
    const child = spawn(file, finalArgs, {
      shell: r.shell,
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
    });
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
    child.stdin.on("error", () => {});
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

import { createInterface } from "node:readline/promises";

export interface Args {
  command: string;
  config: string;
  yes: boolean;
  flags: Map<string, string | true>;
}

export function parseArgs(argv: string[]): Args {
  const [command = "help", ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i] ?? "";
    if (!a.startsWith("--")) continue;
    const [key, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
    const next = rest[i + 1];
    if (inline !== undefined) flags.set(key, inline);
    else if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      i++;
    } else flags.set(key, true);
  }
  const cfg = flags.get("config");
  return {
    command,
    config: typeof cfg === "string" ? cfg : "configs/rogue-legend.json",
    yes: flags.has("yes"),
    flags,
  };
}

/** Ask a question on the terminal. Returns "" when there is no interactive terminal. */
export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Explicit approval: the --yes flag, or typing "yes" at an interactive prompt. */
export async function confirm(question: string, yesFlag: boolean): Promise<boolean> {
  if (yesFlag) return true;
  if (!process.stdin.isTTY) {
    console.log("No approval given. Re-run with --yes to approve, or run it in a terminal.");
    return false;
  }
  const answer = await ask(`${question} Type "yes" to continue: `);
  return answer.toLowerCase() === "yes";
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Runs async jobs with a concurrency limit and a pause after each job. */
export async function runThrottled<T, R>(
  items: readonly T[],
  concurrency: number,
  delayMs: number,
  job: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await job(items[i] as T, i);
      if (delayMs > 0) await sleep(delayMs);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

/**
 * A small worker pool for per-image AI calls (plan-analysis-speed, item 1). The first task runs
 * alone (its answer warms the prompt cache for the others); then up to `concurrency` tasks run
 * at once. Stop means "start nothing new": running tasks finish and are saved. A rate-limit
 * answer drops the pool to one task at a time for the rest of the batch and retries that task
 * once, after the wait the error names.
 */
export interface PoolDeps<T> {
  concurrency: number;
  /** false when nothing more may start (Stop pressed, spending limit reached). */
  gate: () => boolean;
  /** Runs one task; false ends the whole batch (e.g. the same error repeated). */
  run: (task: T) => Promise<boolean>;
  shouldStop: () => boolean;
  sleep: (ms: number, shouldStop: () => boolean) => Promise<void>;
  /** Told once when the pool slows down. */
  slowDown: (waitMs: number) => void;
  /** After each task: the wait a rate-limit answer asked for, or null. Taking it clears it. */
  rateLimit: () => number | null;
}

export async function runPool<T>(tasks: readonly T[], d: PoolDeps<T>): Promise<void> {
  const queue = [...tasks];
  const retried = new Set<T>();
  let limit = d.concurrency;
  let ended = false;

  async function one(task: T): Promise<void> {
    if (!(await d.run(task))) ended = true;
    const wait = d.rateLimit();
    if (wait !== null) {
      if (limit > 1) d.slowDown(wait);
      limit = 1;
      if (!retried.has(task)) {
        retried.add(task);
        await d.sleep(wait, d.shouldStop);
        queue.unshift(task);
      }
    }
  }

  async function worker(n: number): Promise<void> {
    while (!ended && n < limit && queue.length) {
      if (!d.gate()) {
        ended = true;
        return;
      }
      await one(queue.shift() as T);
    }
  }

  const first = queue.shift();
  if (first === undefined) return;
  if (!d.gate()) return;
  await one(first);
  // A task put back after a rate limit may arrive when the workers have ended: go round again.
  while (!ended && queue.length)
    await Promise.all(Array.from({ length: Math.max(1, limit) }, (_, n) => worker(n)));
}

/** Waits `ms`, ending early when Stop is pressed. */
export async function sleepUnlessStopped(ms: number, shouldStop: () => boolean): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end && !shouldStop())
    await new Promise((r) => setTimeout(r, Math.min(500, end - Date.now())));
}

const RATE = /rate.?limit|overloaded|too many requests|\b429\b|\b529\b|usage limit/i;

/** The wait a rate-limit error asks for (its "retry after N s"), 60 s by default; null if none. */
export function rateLimitWait(message: string): number | null {
  if (!RATE.test(message)) return null;
  const m = /(?:retry|try again)[^0-9]{0,20}(\d+)\s*(s|sec|seconds|m|min|minutes)?/i.exec(message);
  if (!m) return 60_000;
  const n = Number(m[1]);
  return /^m/i.test(m[2] ?? "") ? n * 60_000 : n * 1000;
}

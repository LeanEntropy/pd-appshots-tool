/**
 * A small worker pool for per-image AI calls (plan-analysis-speed, item 1). Tasks run one at a
 * time until the first task that paid for a model call has finished (its answer warms the
 * prompt cache for the others); then up to `concurrency` run at once. Stop means "start nothing
 * new": running tasks finish and are saved. A task that met a rate limit drops the pool to one
 * task at a time for the rest of the batch and is retried once, after the wait it names.
 */
export interface TaskOutcome {
  /** false ends the whole batch (e.g. the same error repeated). */
  ok: boolean;
  /** A model call was paid for (cache hits and skipped images are not). */
  paid?: boolean;
  /** This task met a rate limit: the wait it asked for. */
  retryAfterMs?: number | null;
}

export interface PoolDeps<T> {
  concurrency: number;
  /** false when nothing more may start (Stop pressed, spending limit reached). */
  gate: () => boolean;
  run: (task: T) => Promise<TaskOutcome>;
  shouldStop: () => boolean;
  sleep: (ms: number, shouldStop: () => boolean) => Promise<void>;
  /** Told once when the pool slows down. */
  slowDown: (waitMs: number) => void;
}

export async function runPool<T>(tasks: readonly T[], d: PoolDeps<T>): Promise<void> {
  const queue = [...tasks];
  const retried = new Set<T>();
  let limit = d.concurrency;
  let warm = false;
  let ended = false;

  async function one(task: T): Promise<void> {
    const r = await d.run(task);
    if (!r.ok) ended = true;
    if (r.paid) warm = true;
    const wait = r.retryAfterMs ?? null;
    if (wait === null) return;
    if (limit > 1) d.slowDown(wait);
    limit = 1;
    if (retried.has(task) || ended) return;
    retried.add(task);
    await d.sleep(wait, d.shouldStop);
    queue.unshift(task);
  }

  async function worker(n: number): Promise<void> {
    while (!ended && queue.length && n < limit) {
      if (!d.gate()) {
        ended = true;
        return;
      }
      await one(queue.shift() as T);
    }
  }

  // One at a time until a paid call has finished (it warms the prompt cache)...
  while (!ended && queue.length && !warm) {
    if (!d.gate()) return;
    await one(queue.shift() as T);
  }
  // ...then up to `limit` at once. A task put back after a rate limit may arrive when the
  // workers have ended: go round again.
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

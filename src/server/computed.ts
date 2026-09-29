import { dataStamp } from "../storage/changes.ts";

interface Entry {
  stamp: string;
  at: number;
  ttlMs: number;
  value: Promise<unknown>;
  /** Set once the computation has finished without an error. */
  settled: boolean;
  result?: unknown;
}

/**
 * Derived project data kept in memory (report list, suggestions, the page's view model), one
 * value per key, reused while the workspace's data stamp is unchanged. Single flight: requests
 * that ask while it is being computed share that one computation. The computation starts on the
 * next turn of the event loop, so the request that asked can answer (or stream) first. A time
 * limit bounds anything that depends on the clock rather than on the data.
 */
export class Computed {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly stampOf: (workspace: string) => string = dataStamp,
    private readonly ttlMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  private current(workspace: string, key: string): Entry | undefined {
    const e = this.entries.get(`${workspace}|${key}`);
    if (!e || e.stamp !== this.stampOf(workspace) || this.now() - e.at >= e.ttlMs) return;
    return e;
  }

  /** A shorter time limit (ttlMs) suits values that also read the clock (a job's heartbeat). */
  get<T>(
    workspace: string,
    key: string,
    compute: () => T | Promise<T>,
    ttlMs = this.ttlMs,
    /** For a pass whose own writes are its result: kept under the stamp it ends with. */
    keepAfterOwnWrites = false,
  ): Promise<T> {
    const hit = this.current(workspace, key);
    if (hit) return hit.value as Promise<T>;
    // The stamp before the work: a write made while it runs makes the next ask compute again.
    const entry: Entry = {
      stamp: this.stampOf(workspace),
      at: this.now(),
      ttlMs,
      value: null as never,
      settled: false,
    };
    entry.value = new Promise<T>((resolve, reject) =>
      setImmediate(() => {
        try {
          resolve(compute());
        } catch (e) {
          reject(e);
        }
      }),
    ).then(
      (v) => {
        entry.settled = true;
        entry.result = v;
        if (keepAfterOwnWrites) entry.stamp = this.stampOf(workspace);
        return v;
      },
      (e: unknown) => {
        // A failure is never kept: the next ask tries again.
        if (this.entries.get(`${workspace}|${key}`) === entry)
          this.entries.delete(`${workspace}|${key}`);
        throw e;
      },
    );
    this.entries.set(`${workspace}|${key}`, entry);
    return entry.value as Promise<T>;
  }

  /** The finished value for the current data, or undefined (never starts a computation). */
  peek<T>(workspace: string, key: string): T | undefined {
    const e = this.current(workspace, key);
    return e?.settled ? (e.result as T) : undefined;
  }
}

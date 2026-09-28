/**
 * One polite queue for every Google Play page read in this process (plan 3.3): requests run one
 * at a time, spaced by the pacing delay. Interactive requests (the wizard's lookups and searches)
 * go ahead of background ones (store checks, filling in download counts).
 */
export type Priority = "interactive" | "background";

interface Task {
  fn: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PlayQueue {
  private readonly high: Task[] = [];
  private readonly low: Task[] = [];
  private busy = false;
  private last = 0;
  public requests = 0;

  constructor(public delayMs: number) {}

  run<T>(fn: () => Promise<T>, priority: Priority = "background"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const task: Task = { fn, resolve: resolve as (v: unknown) => void, reject };
      (priority === "interactive" ? this.high : this.low).push(task);
      void this.pump();
    });
  }

  /** Waiting requests, for tests and progress lines. */
  get waiting(): number {
    return this.high.length + this.low.length;
  }

  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.high.length || this.low.length) {
        const ms = this.last + this.delayMs - Date.now();
        if (ms > 0) await wait(ms);
        // Picked after the wait, so an interactive request that arrived meanwhile goes first.
        const task = this.high.shift() ?? this.low.shift();
        if (!task) break;
        this.requests++;
        try {
          task.resolve(await task.fn());
        } catch (e) {
          task.reject(e);
        } finally {
          this.last = Date.now();
        }
      }
    } finally {
      this.busy = false;
    }
  }
}

let shared: PlayQueue | undefined;

/** The one queue of this process, shared by lookups, store checks and all projects. */
export function sharedPlayQueue(delayMs: number): PlayQueue {
  if (!shared) shared = new PlayQueue(delayMs);
  return shared;
}

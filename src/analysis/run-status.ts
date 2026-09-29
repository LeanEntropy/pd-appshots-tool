/**
 * What the run panel shows beyond the progress bar: each image's state (running, analysed, text
 * compared, reused for free, different screen, skipped, failed) and the steps after the images,
 * each waiting, running, done, failed or skipped, with its time and cost.
 */
export type ItemState = "running" | "ok" | "text" | "reused" | "different" | "skipped" | "failed";

export type OnItem = (imageId: string, state: ItemState, note?: string | null) => void;

export interface RunStep {
  key: string;
  label: string;
  state: "waiting" | "running" | "done" | "failed" | "skipped";
  startedAt: string | null;
  endedAt: string | null;
  usd: number | null;
  note: string | null;
}

export interface StepTracker {
  /** Starts a step (added at the end if it was not planned); a running step ends as done. */
  start(key: string, label?: string): void;
  /** Ends a step: failed with the reason when there is one (a step ended as done, too). */
  end(key: string, problem?: string | null): void;
  /** Ends the running step, if any (failed with the reason when there is one). */
  endRunning(problem?: string | null): void;
  /** Every step still waiting (whose key starts with `prefix`) is marked skipped, with why. */
  skipWaiting(note: string, prefix?: string): void;
  list(): RunStep[];
}

const round = (n: number) => Math.round(n * 10000) / 10000;

/** The error of a text step not started because the user pressed Stop (the step is skipped). */
export const STOPPED_STEP = "not started: you pressed Stop";

export function stepTracker(
  planned: readonly { key: string; label: string }[],
  spent: () => number,
  emit: (steps: RunStep[]) => void = () => {},
  now: () => Date = () => new Date(),
): StepTracker {
  const steps: RunStep[] = planned.map((p) => ({
    ...p,
    state: "waiting",
    startedAt: null,
    endedAt: null,
    usd: null,
    note: null,
  }));
  const from = new Map<string, number>();
  const show = () => emit(steps.map((s) => ({ ...s })));
  const close = (s: RunStep, problem: string | null) => {
    s.state = !problem ? "done" : problem.includes(STOPPED_STEP) ? "skipped" : "failed";
    if (s.state === "skipped") problem = STOPPED_STEP;
    s.endedAt = now().toISOString();
    s.usd = round(Math.max(0, spent() - (from.get(s.key) ?? spent())));
    s.note = problem;
  };
  return {
    start(key, label) {
      for (const s of steps) if (s.state === "running" && s.key !== key) close(s, null);
      let s = steps.find((x) => x.key === key);
      if (!s) {
        s = {
          key,
          label: label ?? key,
          state: "waiting",
          startedAt: null,
          endedAt: null,
          usd: null,
          note: null,
        };
        steps.push(s);
      }
      if (s.state !== "running") {
        s.state = "running";
        s.startedAt = now().toISOString();
        from.set(key, spent());
      }
      show();
    },
    end(key, problem) {
      const s = steps.find((x) => x.key === key);
      if (!s || s.state === "skipped" || s.state === "failed") return;
      if (s.state === "done") {
        if (!problem) return;
        s.state = "failed";
        s.note = problem;
        return show();
      }
      if (s.state === "waiting") {
        s.startedAt = now().toISOString();
        from.set(key, spent());
      }
      close(s, problem ?? null);
      show();
    },
    endRunning(problem) {
      const s = steps.find((x) => x.state === "running");
      if (!s) return;
      close(s, problem ?? null);
      show();
    },
    skipWaiting(note, prefix = "") {
      let changed = false;
      for (const s of steps)
        if (s.state === "waiting" && s.key.startsWith(prefix)) {
          s.state = "skipped";
          s.note = note;
          changed = true;
        }
      if (changed) show();
    },
    list: () => steps.map((s) => ({ ...s })),
  };
}

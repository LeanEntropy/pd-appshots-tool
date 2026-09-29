import { mkdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Data change stamp: which version of the workspace data a cached result was computed from.
 * Every write through the storage (or the few direct JSON writers) bumps this process's counter
 * and touches one marker file per workspace, so writes made by another process (a terminal
 * command) are seen too. Touches are throttled: at most one right away and one trailing touch
 * per half second, so a burst of writes costs two small file updates.
 */
let generation = 0;
const markers = new Set<string>();
let trailing: NodeJS.Timeout | null = null;
const TRAILING_MS = 500;

/** The marker file of a workspace folder (inside its locks folder, never part of any data). */
export function markerPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".locks", "data-changed");
}

/** Called when a workspace's storage is opened: its marker is touched on every data write. */
export function watchWorkspace(workspaceRoot: string): void {
  markers.add(markerPath(workspaceRoot));
}

function touchAll(): void {
  const now = new Date();
  for (const m of markers) {
    try {
      utimesSync(m, now, now);
    } catch {
      try {
        mkdirSync(dirname(m), { recursive: true });
        writeFileSync(m, "");
      } catch {
        // A read-only or missing workspace: the in-process counter still changes.
      }
    }
  }
}

function flush(): void {
  if (!trailing) return;
  clearTimeout(trailing);
  trailing = null;
  touchAll();
}
process.once("exit", flush);

/** Records that workspace data was written (by this process). */
export function dataChanged(): void {
  generation++;
  // A touch already scheduled comes after this write, so it covers it.
  if (trailing) return;
  touchAll();
  trailing = setTimeout(() => {
    trailing = null;
    touchAll();
  }, TRAILING_MS);
  trailing.unref();
}

let later: NodeJS.Timeout | null = null;
const LATER_MS = 10_000;

/**
 * A write from a long background pass that writes many small results (the same-screen check):
 * counted once when the pass ends (dataChangedNow) or ten seconds later, so the page's cached
 * data is not recomputed after every one of its writes.
 */
export function dataChangedLater(): void {
  if (later) return;
  later = setTimeout(() => {
    later = null;
    dataChanged();
  }, LATER_MS);
  later.unref();
}

/** Counts a pending deferred write now (a background pass has ended). */
export function flushDataChanges(): void {
  if (!later) return;
  clearTimeout(later);
  later = null;
  dataChanged();
}
process.once("exit", flushDataChanges);

/**
 * The current stamp of a workspace: this process's write count plus the marker's time (writes
 * from other processes). Equal stamps mean no data was written in between. One file stat.
 */
export function dataStamp(workspaceRoot: string): string {
  let mtime = 0;
  try {
    mtime = statSync(markerPath(workspaceRoot)).mtimeMs;
  } catch {}
  return `${generation}:${mtime}`;
}

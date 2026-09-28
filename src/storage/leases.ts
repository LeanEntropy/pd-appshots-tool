import { randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import type { Storage } from "./types.ts";

/**
 * Locks (plan section 7): an exclusive-create file holding a random nonce. Only the holder of
 * the nonce may renew or release it; a stale lock (dead process or no heartbeat for 2 minutes)
 * is taken over by renaming it aside, so only one contender can win.
 */
export const LockSchema = z.object({
  nonce: z.string().min(16),
  pid: z.number().int(),
  processStartedAt: z.string(),
  projectId: z.string().nullable(),
  kind: z.string(),
  startedAt: z.string(),
  heartbeatAt: z.string(),
});
export type LockInfo = z.infer<typeof LockSchema>;

export const STALE_MS = 2 * 60_000;
export const HEARTBEAT_MS = 15_000;

/** Well-known lock keys. */
export const LOCKS = {
  ai: "locks/ai.lock",
  store: "locks/store.lock",
  library: "locks/library.lock",
  server: "locks/server.lock",
} as const;

const PROCESS_STARTED = new Date(Date.now() - process.uptime() * 1000).toISOString();

export interface Lease {
  key: string;
  nonce: string;
  /** Renews the heartbeat; false if the lock is no longer ours. */
  heartbeat(): boolean;
  release(): void;
}

/** The lock's content and its heartbeat time (the later of the recorded beat and the file time). */
function readLock(path: string): { info: LockInfo | null; beat: number } | null {
  try {
    const p = LockSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    const info = p.success ? p.data : null;
    const beat = Math.max(info ? Date.parse(info.heartbeatAt) : 0, statSync(path).mtimeMs);
    return { info, beat };
  } catch {
    return null;
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Stale = no heartbeat for 2 minutes, or its process is gone (or its pid was reused). */
export function isStale(l: LockInfo | null, beat: number, now = Date.now()): boolean {
  if (!l) return now - beat > STALE_MS; // unreadable: give a writer in progress time
  if (now - beat > STALE_MS) return true;
  if (l.pid === process.pid) return l.processStartedAt !== PROCESS_STARTED;
  return !alive(l.pid);
}

function create(path: string, info: LockInfo): boolean {
  try {
    writeFileSync(path, JSON.stringify(info), { flag: "wx" });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

/**
 * Moves a stale lock aside (only one contender's rename can succeed). If what was moved is not
 * the stale lock that was judged (it was replaced meanwhile), it is put back without ever
 * overwriting; should that fail, its owner sees the loss at its next heartbeat and stops.
 */
function takeOver(path: string, staleNonce: string | null): void {
  const aside = `${path}.stale-${randomBytes(8).toString("hex")}`;
  try {
    renameSync(path, aside);
  } catch {
    return; // another contender moved it first
  }
  const moved = readLock(aside);
  if (moved?.info && moved.info.nonce !== staleNonce && !isStale(moved.info, moved.beat)) {
    try {
      linkSync(aside, path);
    } catch {}
  }
  rmSync(aside, { force: true });
}

export function tryAcquire(
  storage: Storage,
  key: string,
  who: { projectId: string | null; kind: string },
): Lease | { heldBy: LockInfo | null } {
  const path = storage.localPath(key);
  mkdirSync(dirname(path), { recursive: true });
  const nowIso = new Date().toISOString();
  const info: LockInfo = {
    nonce: randomBytes(16).toString("hex"),
    pid: process.pid,
    processStartedAt: PROCESS_STARTED,
    projectId: who.projectId,
    kind: who.kind,
    startedAt: nowIso,
    heartbeatAt: nowIso,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    if (create(path, info)) return lease(path, key, info.nonce);
    const held = readLock(path);
    if (!held) continue; // released meanwhile
    if (!isStale(held.info, held.beat)) return { heldBy: held.info };
    takeOver(path, held.info?.nonce ?? null);
  }
  return { heldBy: readLock(path)?.info ?? null };
}

function lease(path: string, key: string, nonce: string): Lease {
  const ours = () => readLock(path)?.info?.nonce === nonce;
  return {
    key,
    nonce,
    // Renewal only touches the file time: it never replaces the file, so it cannot destroy a
    // lock another process took over; the nonce is checked again afterwards.
    heartbeat() {
      if (!ours()) return false;
      try {
        const now = new Date();
        utimesSync(path, now, now);
      } catch {
        return false;
      }
      return ours();
    },
    // Moved aside first (atomic), then deleted only if it really is ours; otherwise put back.
    release() {
      if (!ours()) return;
      const aside = `${path}.release-${nonce}`;
      try {
        renameSync(path, aside);
      } catch {
        return;
      }
      if (readLock(aside)?.info?.nonce !== nonce) {
        try {
          linkSync(aside, path);
        } catch {}
      }
      rmSync(aside, { force: true });
    },
  };
}

/** Who holds a lock right now: its content when held and not stale, else null. */
export function lockHolder(storage: Storage, key: string): LockInfo | null {
  const held = readLock(storage.localPath(key));
  if (!held?.info || isStale(held.info, held.beat)) return null;
  return held.info;
}

export interface HeldLocks {
  leases: Lease[];
  /** Throws when any lock was lost (e.g. taken over after a long pause): stop before writing. */
  check: () => void;
  release: () => void;
}

/** Takes several locks in order; on any refusal releases what it took and says who holds it. */
export function acquireAll(
  storage: Storage,
  keys: readonly string[],
  who: { projectId: string | null; kind: string },
): HeldLocks | { heldBy: LockInfo | null; key: string } {
  const got: Lease[] = [];
  for (const k of keys) {
    const r = tryAcquire(storage, k, who);
    if ("heldBy" in r) {
      for (const l of got.reverse()) l.release();
      return { heldBy: r.heldBy, key: k };
    }
    got.push(r);
  }
  let lost: string | null = null;
  const beat = () => {
    for (const l of got) if (!l.heartbeat()) lost ??= l.key;
  };
  const timer = setInterval(beat, HEARTBEAT_MS);
  timer.unref();
  return {
    leases: got,
    check: () => {
      beat();
      if (lost) throw new Error(`Stopped: the lock ${lost} was lost; nothing more was written.`);
    },
    release: () => {
      clearInterval(timer);
      for (const l of [...got].reverse()) l.release();
    },
  };
}

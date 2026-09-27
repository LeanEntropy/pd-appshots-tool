import { randomBytes } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
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
} as const;

const PROCESS_STARTED = new Date(Date.now() - process.uptime() * 1000).toISOString();

export interface Lease {
  key: string;
  nonce: string;
  /** Renews the heartbeat; false if the lock is no longer ours. */
  heartbeat(): boolean;
  release(): void;
}

function readLock(path: string): LockInfo | null {
  try {
    const p = LockSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return p.success ? p.data : null;
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

export function isStale(l: LockInfo | null, now = Date.now()): boolean {
  if (!l) return true;
  if (now - Date.parse(l.heartbeatAt) > STALE_MS) return true;
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

/** Moves a stale lock aside. Restores it if what was moved turns out to be someone's live lock. */
function takeOver(path: string, staleNonce: string | null): void {
  const aside = `${path}.stale-${randomBytes(8).toString("hex")}`;
  try {
    renameSync(path, aside);
  } catch {
    return; // another contender moved it first
  }
  const moved = readLock(aside);
  if (moved && moved.nonce !== staleNonce && !isStale(moved)) {
    try {
      linkSync(aside, path); // fails if a new lock exists meanwhile; never overwrites
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
    if (create(path, info)) return lease(path, key, info);
    const held = readLock(path);
    if (!isStale(held)) return { heldBy: held };
    takeOver(path, held?.nonce ?? null);
  }
  return { heldBy: readLock(path) };
}

function lease(path: string, key: string, info: LockInfo): Lease {
  return {
    key,
    nonce: info.nonce,
    heartbeat() {
      if (readLock(path)?.nonce !== info.nonce) return false;
      const tmp = `${path}.${info.nonce}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ...info, heartbeatAt: new Date().toISOString() }));
      renameSync(tmp, path);
      return true;
    },
    release() {
      if (readLock(path)?.nonce !== info.nonce) return;
      try {
        unlinkSync(path);
      } catch {}
    },
  };
}

/** Takes several locks in order; on any refusal releases what it took and says who holds it. */
export function acquireAll(
  storage: Storage,
  keys: readonly string[],
  who: { projectId: string | null; kind: string },
): { leases: Lease[]; release: () => void } | { heldBy: LockInfo | null; key: string } {
  const got: Lease[] = [];
  for (const k of keys) {
    const r = tryAcquire(storage, k, who);
    if ("heldBy" in r) {
      for (const l of got.reverse()) l.release();
      return { heldBy: r.heldBy, key: k };
    }
    got.push(r);
  }
  const timer = setInterval(() => {
    for (const l of got) l.heartbeat();
  }, HEARTBEAT_MS);
  timer.unref();
  return {
    leases: got,
    release: () => {
      clearInterval(timer);
      for (const l of [...got].reverse()) l.release();
    },
  };
}

import type { Server } from "node:http";
import { z } from "zod";
import { workspaceDir } from "../config/project.ts";
import type { RunnerOptions } from "../jobs/index.ts";
import { type Storage, workspaceStorage } from "../storage/index.ts";
import { acquireAll, LOCKS } from "../storage/leases.ts";
import { createAppContext } from "./app-context.ts";
import { createAppServer, listen } from "./app-server.ts";

const SERVER_INFO = "locks/server.json";
const ServerInfo = z.object({ pid: z.number(), port: z.number(), nonce: z.string() });

async function healthy(info: z.infer<typeof ServerInfo>): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const body = (await r.json()) as { nonce?: string };
    return body.nonce === info.nonce;
  } catch {
    return false;
  }
}

/**
 * The running tool's address, if the server that holds the lock recorded it and answers with
 * that same nonce (an old server that lost the lock is never reused).
 */
export async function runningServer(storage: Storage, lockNonce: string): Promise<string | null> {
  const info = ServerInfo.safeParse(storage.getJson(SERVER_INFO));
  if (!info.success || info.data.nonce !== lockNonce) return null;
  return (await healthy(info.data)) ? `http://127.0.0.1:${info.data.port}` : null;
}

/**
 * Starts the one tool server (plan 6.1), in this order: take the server lock, listen, then
 * record { pid, port, nonce }. A second start finds the lock held, checks the recorded server
 * answers with the same nonce, and hands back its address instead of starting another.
 */
export async function startToolServer(o: {
  root: string;
  port: number;
  runner?: RunnerOptions;
}): Promise<{ server: Server | null; origin: string }> {
  const storage = workspaceStorage(workspaceDir(o.root));
  for (let attempt = 0; attempt < 5; attempt++) {
    const held = acquireAll(storage, [LOCKS.server], { projectId: null, kind: "server" });
    if ("heldBy" in held) {
      const other = held.heldBy ? await runningServer(storage, held.heldBy.nonce) : null;
      if (other) return { server: null, origin: other };
      // Held by a live process that does not answer yet (starting up): wait a moment.
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    const nonce = held.leases[0]?.nonce ?? "";
    const app = createAppContext({ root: o.root, nonce, runner: o.runner });
    const server = createAppServer(app);
    let port: number;
    try {
      port = await listen(server, o.port);
    } catch (e) {
      held.release();
      throw e;
    }
    storage.putJson(SERVER_INFO, { pid: process.pid, port, nonce });
    const release = () => held.release();
    server.on("close", release);
    process.once("exit", release);
    return { server, origin: `http://127.0.0.1:${port}` };
  }
  throw new Error(
    "Another copy of the tool is running but does not answer. Close it (or wait two minutes) and try again.",
  );
}

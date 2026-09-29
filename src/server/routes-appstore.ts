import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  type AppStoreProject,
  appleDeckKey,
  appStoreLock,
  type Match,
  readAppleDeck,
  readAppStore,
  writeAppStore,
} from "../appstore/data.ts";
import { appleLangFor } from "../appstore/lang.ts";
import type { LoadedConfig } from "../config/load.ts";
import type { ProjectContext, Storage } from "../storage/index.ts";
import { tryAcquire } from "../storage/leases.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext } from "./app-context.ts";
import { send, writeRequest } from "./http-util.ts";
import { oneAtATime } from "./routes-setup.ts";

/**
 * The App Store opt-in and the match confirmations (plan-app-store 1.3 and 5):
 *   GET  /api/appstore          the switch, each game's matches per country and fetched decks
 *   POST /api/appstore/enabled  { enabled }       the project's explicit opt-in
 *   POST /api/appstore/confirm  { appId, trackId | null }  the user's answer for one game: that
 *        app in every country where it was a candidate, or "not on the App Store" everywhere
 *        it was waiting. Refused while an App Store job of this project runs (it writes too).
 */
export interface GameView {
  appId: string;
  name: string;
  ours: boolean;
  /** Countries with a fetched App Store deck (for the store marks). */
  decks: string[];
  byCountry: Record<
    string,
    Pick<
      Match,
      "status" | "trackId" | "trackName" | "confidence" | "evidence" | "candidates" | "auto"
    >
  >;
}

export function appStoreView(
  storage: Storage,
  loaded: LoadedConfig,
): { enabled: boolean; games: GameView[]; countries: { gl: string; label: string }[] } {
  const { config } = loaded;
  const ctx: ProjectContext = { projectId: config.project };
  const a = readAppStore(storage, ctx);
  const names = new Map([
    [config.ourApp.id, config.ourApp.name],
    ...config.competitors.map((c): [string, string] => [c.id, c.name]),
  ]);
  const games: GameView[] = Object.entries(a.games).map(([appId, g]) => ({
    appId,
    name: names.get(appId) ?? appId,
    ours: appId === config.ourApp.id,
    decks: config.markets
      .filter(
        (m) =>
          readAppleDeck(storage, appleDeckKey(ctx, appId, m.gl, appleLangFor(m.gl, m.hl)))
            ?.status === "ok",
      )
      .map((m) => m.gl),
    byCountry: Object.fromEntries(
      Object.entries(g.byCountry).map(([gl, m]) => [
        gl,
        {
          status: m.status,
          trackId: m.trackId,
          trackName: m.trackName,
          confidence: m.confidence,
          evidence: m.evidence,
          candidates: m.candidates,
          auto: m.auto,
        },
      ]),
    ),
  }));
  games.sort((x, y) => Number(y.ours) - Number(x.ours));
  return {
    enabled: a.enabled,
    games,
    countries: config.markets.map((m) => ({ gl: m.gl, label: m.label })),
  };
}

const Enabled = z.strictObject({ enabled: z.boolean() });
const Confirm = z.strictObject({
  appId: z.string().min(1).max(200),
  trackId: z.number().int().positive().nullable(),
});

/** Applies the user's answer for one game; the countries that changed, or a problem. */
export function confirmGame(
  a: AppStoreProject,
  appId: string,
  trackId: number | null,
  now: string,
): string[] | { problem: string } {
  const g = a.games[appId];
  if (!g) return { problem: "This game has no App Store matches yet." };
  const changed: string[] = [];
  for (const [gl, m] of Object.entries(g.byCountry)) {
    if (trackId === null) {
      if (m.status !== "needs_confirmation") continue;
      g.byCountry[gl] = {
        ...m,
        status: "confirmed_none",
        source: "user",
        confirmedAt: now,
        trackId: undefined,
        bundleId: undefined,
      };
      changed.push(gl);
      continue;
    }
    const c = m.candidates.find((x) => x.trackId === trackId);
    if (!c || m.status === "matched") continue;
    g.byCountry[gl] = {
      ...m,
      status: "matched",
      trackId: c.trackId,
      bundleId: c.bundleId,
      sellerName: c.sellerName,
      trackName: c.trackName,
      source: "user",
      confirmedAt: now,
    };
    changed.push(gl);
  }
  return changed.length
    ? changed
    : { problem: "Nothing to confirm for this game. Reload the page." };
}

/** One save from the page, under the project's App Store lock (the fetch job holds it too). */
export function postAppStore(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  raw: unknown,
): ApiResponse {
  const ctx = { projectId: loaded.config.project };
  const lease = tryAcquire(app.storage, appStoreLock(ctx), { ...ctx, kind: "appstore-save" });
  if ("heldBy" in lease)
    return {
      status: 409,
      body: {
        problems: [
          "The App Store pages of this project are being read now. Try again when that ends.",
        ],
      },
    };
  try {
    return postLocked(app, loaded, rest, raw);
  } finally {
    lease.release();
  }
}

function postLocked(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  raw: unknown,
): ApiResponse {
  const ctx = { projectId: loaded.config.project };
  const a = readAppStore(app.storage, ctx);
  if (rest === "/api/appstore/enabled") {
    const b = Enabled.safeParse(raw);
    if (!b.success)
      return {
        status: 400,
        body: { problems: ["The page sent a change the tool cannot read. Reload the page."] },
      };
    writeAppStore(app.storage, ctx, { ...a, enabled: b.data.enabled });
    return {
      status: 200,
      body: {
        saved: true,
        message: b.data.enabled
          ? "App Store is on for this project. Saved."
          : "App Store is off for this project. Saved; nothing already fetched was removed.",
      },
    };
  }
  const b = Confirm.safeParse(raw);
  if (!b.success)
    return {
      status: 400,
      body: { problems: ["The page sent an answer the tool cannot read. Reload the page."] },
    };
  const r = confirmGame(a, b.data.appId, b.data.trackId, new Date().toISOString());
  if ("problem" in r) return { status: 409, body: { problems: [r.problem] } };
  writeAppStore(app.storage, ctx, a);
  const where = r.map((gl) => gl.toUpperCase()).join(", ");
  return {
    status: 200,
    body: {
      saved: true,
      message:
        b.data.trackId === null
          ? `Saved: not on the App Store (${where}).`
          : `Confirmed for ${where}. Its App Store pages are read at the next App Store fetch.`,
      view: appStoreView(app.storage, loaded),
    },
  };
}

export async function appStoreRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!rest.startsWith("/api/appstore")) return false;
  if (req.method === "GET" && rest === "/api/appstore") {
    send(res, 200, appStoreView(app.storage, loaded));
    return true;
  }
  if (
    req.method === "POST" &&
    (rest === "/api/appstore/enabled" || rest === "/api/appstore/confirm")
  ) {
    const w = await writeRequest(req, res, app.token);
    if (!w) return true;
    const r = await oneAtATime(`appstore:${loaded.config.project}`, async () =>
      postAppStore(app, loaded, rest, w.body),
    );
    send(res, r.status, r.body);
    return true;
  }
  return false;
}

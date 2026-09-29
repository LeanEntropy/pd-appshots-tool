import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  appleDeckKey,
  appStoreLock,
  emptyAppStore,
  readAppleDeck,
  readAppStore,
  writeAppStore,
} from "../src/appstore/data.ts";
import { runFetch } from "../src/appstore/fetch-run.ts";
import type { AppleImages } from "../src/appstore/ingest.ts";
import { AppleQueue } from "../src/appstore/queue.ts";
import type { LoadedConfig } from "../src/config/load.ts";
import type { AppContext } from "../src/server/app-context.ts";
import { postAppStore } from "../src/server/routes-appstore.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { tryAcquire } from "../src/storage/leases.ts";

const NOW = "2026-09-29T00:00:00.000Z";
const clock = { now: () => 0, sleep: async () => {} };

function confirmedStore() {
  const a = emptyAppStore(NOW);
  a.enabled = true;
  a.games.g = {
    byCountry: {
      us: {
        status: "matched",
        trackId: 7,
        bundleId: "com.old",
        confidence: "high",
        evidence: [],
        candidates: [],
        source: "user",
        checkedAt: NOW,
        confirmedAt: NOW,
      },
    },
  };
  return a;
}

test("a bundle id that changed after the user's confirmation blocks the deck and asks again", async () => {
  const storage = workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-asf-")));
  const ctx = { projectId: "p" };
  const row = {
    kind: "software",
    trackId: 7,
    bundleId: "com.new",
    trackName: "New",
    sellerName: "S",
  };
  const api = new AppleQueue(
    async () => new Response(JSON.stringify({ resultCount: 1, results: [row] })),
    { minIntervalMs: 0 },
    clock,
  );
  const images = {
    get: async () => assert.fail("no image is read for a changed app"),
  } as unknown as AppleImages;
  const store = confirmedStore();
  const out = await runFetch(
    { storage, ctx, api, images, log: () => {}, check: () => {} },
    [{ appId: "g", name: "Game", gl: "us", hl: "en" }],
    store,
  );
  assert.equal(out[0]?.identityChanged, 1);
  const m = store.games.g?.byCountry.us;
  assert.equal(m?.status, "needs_confirmation");
  assert.notEqual(m?.source, "user");
  assert.equal(m?.trackId, undefined);
  assert.equal(m?.candidates[0]?.bundleId, "com.new");
  assert.equal(
    readAppleDeck(storage, appleDeckKey(ctx, "g", "us", "en_us"))?.status,
    "identity_changed",
  );
});

test("the page's saves wait while the App Store job holds the project's App Store lock", () => {
  const storage = workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-asl-")));
  const ctx = { projectId: "p" };
  writeAppStore(storage, ctx, emptyAppStore(NOW));
  const app = { storage } as unknown as AppContext;
  const loaded = { config: { project: "p" } } as unknown as LoadedConfig;
  const job = tryAcquire(storage, appStoreLock(ctx), { ...ctx, kind: "appstore" });
  assert.ok(!("heldBy" in job));
  const r = postAppStore(app, loaded, "/api/appstore/enabled", { enabled: true });
  assert.equal(r.status, 409);
  assert.equal(readAppStore(storage, ctx).enabled, false);
  job.release();
  const ok = postAppStore(app, loaded, "/api/appstore/enabled", { enabled: true });
  assert.equal(ok.status, 200);
  assert.equal(readAppStore(storage, ctx).enabled, true);
});

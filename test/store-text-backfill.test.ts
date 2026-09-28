import assert from "node:assert/strict";
import { test } from "node:test";
import { projectPaths } from "../src/config/load.ts";
import { hasStoreText } from "../src/library/store-text.ts";
import type { Listing } from "../src/play/client.ts";
import type { StoreOfficial } from "../src/play/store-text.ts";
import { runStoreTextBackfill } from "../src/steps/store-text.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { tempProject } from "./helpers/project.ts";

function official(o: Partial<StoreOfficial> = {}): StoreOfficial {
  return {
    title: null,
    shortDescription: null,
    description: null,
    recentChanges: null,
    genre: { id: "GAME_ROLE_PLAYING", name: "Role Playing" },
    chips: [],
    contentRating: null,
    ...o,
  };
}

test("backfill: shows the count and reads nothing without --yes; then reads, saves, skips saved", async () => {
  const loaded = await tempProject({ [loadedName(0)]: { phone: 2, tablet: 0 } });
  const s = workspaceStorage(projectPaths(loaded).workspace);
  const calls: string[] = [];
  const client = {
    async listing(appId: string, gl: string, hl: string): Promise<Listing> {
      calls.push(appId);
      const base = {
        appId,
        gl,
        hl,
        rawCount: 0,
        screenshots: [],
        fetchedAt: "2026-09-28T01:00:00Z",
      };
      if (appId === loaded.config.ourApp.id)
        return { ...base, status: "ok", store: official({ title: "Ours Game" }) };
      return { ...base, status: "unavailable" };
    },
  };
  const lines: string[] = [];
  const log = (l: string) => lines.push(l);
  const dry = await runStoreTextBackfill(loaded, { yes: false, log, client, storage: s });
  assert.equal(dry.toRead, 2);
  assert.equal(calls.length, 0, "nothing read before the approval");
  assert.match(lines.join("\n"), /2 store pages to read, 0 already saved[\s\S]*--yes/);
  const run = await runStoreTextBackfill(loaded, { yes: true, log, client, storage: s });
  assert.deepEqual([run.saved, run.notSold, run.failed], [1, 1, 0]);
  assert.match(lines.join("\n"), /Reading store page 2 of 2/);
  assert.ok(hasStoreText(s, loaded.config.ourApp.id, "us", "en"));
  const again = await runStoreTextBackfill(loaded, { yes: false, log, client, storage: s });
  assert.equal(again.toRead, 1, "the saved page is skipped");
  // A storage problem is counted as a failure (and the command asks to run again).
  const broken = new Proxy(s, {
    get: (t, k) =>
      k === "putJson"
        ? () => {
            throw new Error("disk full");
          }
        : Reflect.get(t, k).bind(t),
  });
  const bad = await runStoreTextBackfill(loaded, {
    yes: true,
    log,
    client: {
      listing: async (a, g, h) => ({
        ...(await client.listing(a, g, h)),
        status: "ok",
        store: official(),
      }),
    },
    storage: broken,
  });
  assert.deepEqual([bad.saved, bad.failed], [0, 1]);
  assert.match(lines.join(" "), /disk full[\s\S]*run the command again/);
});

function loadedName(i: number): string {
  return ["Capybara Go", "Mini Tales", "Heroll"][i] ?? "";
}

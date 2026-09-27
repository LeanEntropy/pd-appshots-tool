import assert from "node:assert/strict";
import { test } from "node:test";
import type { DeckTarget } from "../src/core/targets.ts";
import type { Listing } from "../src/play/client.ts";
import {
  computePlanHash,
  type DownloadPlan,
  humanCategory,
  planProblem,
} from "../src/steps/preview.ts";

const target: DeckTarget = {
  appId: "a.app",
  name: "A",
  group: "named",
  tier: "direct",
  gl: "us",
  hl: "en",
  chartRanks: {},
};
const listing: Listing = {
  appId: "a.app",
  gl: "us",
  hl: "en",
  status: "ok",
  rawCount: 3,
  screenshots: ["https://play-lh.googleusercontent.com/x"],
  fetchedAt: "",
};

function plan(now: number): DownloadPlan {
  const listings = { "a.app|us|en": listing };
  return {
    createdAt: new Date(now).toISOString(),
    configHash: "cfg",
    planHash: computePlanHash("cfg", [target], listings),
    category: "GAME_ROLE_PLAYING",
    bytesPerImage: 1,
    bytesSource: "config",
    targets: [target],
    listings,
    charts: [],
    summary: {} as DownloadPlan["summary"],
    incomplete: [],
  };
}

test("an unchanged, fresh plan is accepted", () => {
  const now = Date.now();
  assert.equal(planProblem(plan(now), "cfg", 24, now), null);
});

test("a plan is refused after a config change, an edit, or when too old", () => {
  const now = Date.now();
  assert.match(planProblem(plan(now), "other", 24, now) ?? "", /config changed/);
  const edited = plan(now);
  edited.listings["a.app|us|en"] = { ...listing, screenshots: ["https://evil.example/y"] };
  assert.match(planProblem(edited, "cfg", 24, now) ?? "", /changed after/);
  assert.match(planProblem(plan(now - 30 * 3_600_000), "cfg", 24, now) ?? "", /hours old/);
});

test("store category ids read as plain words", () => {
  assert.equal(humanCategory("GAME_ROLE_PLAYING"), "Role Playing");
});

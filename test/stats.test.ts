import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ConfigSchema } from "../src/config/schema.ts";
import { computeStats } from "../src/core/stats.ts";
import type { DeckManifest } from "../src/store/manifest.ts";

function deck(
  appId: string,
  gl: string,
  hl: string,
  ids: (string | null)[],
  status: DeckManifest["status"] = "ok",
): DeckManifest {
  return {
    appId,
    name: appId,
    group: "named",
    tier: "direct",
    gl,
    hl,
    chartRanks: {},
    status,
    rawCount: ids.length,
    deckLength: ids.length,
    deviceMix: { phone: ids.length, tablet: 0, unknown: 0 },
    fetchedAt: "",
    slots: ids.map((imageId, i) => ({
      position: i + 1,
      googleId: `g${i}`,
      imageId,
      width: 1,
      height: 2,
      deviceClass: "phone",
      deviceConfidence: 0.9,
      orientation: "portrait",
    })),
  };
}

test("identical-to-English counts only exact image matches in other locales", () => {
  const s = computeStats(
    [
      deck("a", "us", "en", ["x", "y", "z"]),
      deck("a", "jp", "ja", ["x", "j2", "z"]),
      deck("a", "kr", "ko", [], "unavailable"),
      deck("b", "us", "en", ["q"]),
    ],
    { gl: "us", hl: "en" },
  );
  assert.equal(s.games, 2);
  assert.equal(s.identicalToBaseline, 2);
  assert.equal(s.nonBaselineSlots, 3);
  assert.equal(s.uniqueImages, 5);
  assert.equal(s.decksUnavailable, 1);
  assert.deepEqual(s.deckLengths.named, { min: 1, median: 2, max: 3, n: 2 });
});

test("the Rogue Legend config is valid", () => {
  const url = new URL("../configs/rogue-legend.json", import.meta.url);
  const c = ConfigSchema.parse(JSON.parse(readFileSync(url, "utf8")));
  assert.equal(c.ourApp.id, "com.pockethaven.roguelegend");
  assert.equal(c.core.imageCap, 100);
  assert.equal(c.markets.find((m) => m.gl === "hk")?.hl, "zh-TW");
  assert.equal(c.markets.find((m) => m.gl === "ph")?.hl, "en");
});

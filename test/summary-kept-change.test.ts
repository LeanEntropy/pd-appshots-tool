import assert from "node:assert/strict";
import { test } from "node:test";
import type { Recommendations } from "../src/analysis/synthesis-schema.ts";
import { type SummaryInput, summaryPart } from "../src/reports/summary.ts";

type Rec = Recommendations["positions"][number];

const rec = (position: number, source: string, texts: string[], logo?: boolean): Rec =>
  ({
    position,
    screenType: "gameplay_battle",
    subtype: "",
    source,
    marketingLayer: {
      present: texts.length > 0,
      texts: texts.map((text) => ({ role: "headline", text })),
    },
    ...(logo === undefined ? {} : { logo: { show: logo, why: "" } }),
  }) as unknown as Rec;

const ours = (position: number, texts: string[]) => ({
  position,
  name: "Rogue Legends",
  final: {
    screenshot: { screenType: "gameplay_battle", subtype: "" },
    marketingLayer: {
      present: texts.length > 0,
      texts: texts.map((text) => ({ role: "headline", text })),
      elements: [],
    },
  } as never,
});

const input = (positions: Rec[], deck: SummaryInput["ours"]): SummaryInput => ({
  fit: null,
  interpretation: null,
  recommendations: { rationale: "", positions },
  aiCurrent: true,
  competitors: 2,
  market: "the United States",
  label: (k: string) => k,
  generatedAt: null,
  orderDates: [],
  analysedAt: [],
  ours: deck,
});

test("key recommendations: a kept position with a new line, a moved one or a logo change counts", () => {
  const s = summaryPart(
    input(
      [
        rec(1, "keep our current position 1", ["Rogue Legends", "Roll the dice, rule the dungeon"]),
        rec(2, "keep our current position 2", ["FIGHT BOSSES"]),
        rec(3, "keep our current position 4", ["LOOT"]),
        rec(4, "keep our current position 3", ["upgrade"], true),
        rec(5, "new capture", []),
      ],
      [
        ours(1, ["Rogue Legends"]),
        ours(2, ["Fight  bosses"]),
        ours(3, ["Upgrade"]),
        ours(4, ["LOOT"]),
      ],
    ),
  );
  assert.deepEqual(
    s.keyRecommendations.map((k) => k.position),
    [1, 3, 4, 5],
    "position 2 keeps our image as it is",
  );
  assert.match(s.keyRecommendations[0]?.text ?? "", /\(keep our current position 1: new text\)$/);
  assert.match(s.keyRecommendations[1]?.text ?? "", /\(keep our current position 4: moved here\)$/);
  assert.match(s.keyRecommendations[2]?.text ?? "", /: moved here, add the logo\)$/);
  // Only 5 fit: new pictures and new text go before images that only move.
  const many = summaryPart(
    input(
      [
        rec(1, "keep our current position 2", ["A"]),
        rec(2, "keep our current position 1", ["B"]),
        rec(3, "keep our current position 4", ["C"]),
        rec(4, "keep our current position 3", ["D"]),
        rec(5, "new capture", []),
        rec(6, "recapture our position 5", []),
        rec(7, "keep our current position 7", ["NEW LINE"]),
      ],
      [ours(1, ["B"]), ours(2, ["A"]), ours(3, ["D"]), ours(4, ["C"]), ours(7, ["OLD"])],
    ),
  );
  assert.deepEqual(
    many.keyRecommendations.map((k) => k.position),
    [1, 2, 5, 6, 7],
  );
  const logo = summaryPart(
    input([rec(1, "keep our current position 1", ["Upgrade"], true)], [ours(1, ["Upgrade"])]),
  );
  assert.match(logo.keyRecommendations[0]?.text ?? "", /: add the logo\)$/);
});

test("key recommendations: without our analyses only a moved kept position counts", () => {
  const s = summaryPart(
    input(
      [rec(1, "keep our current position 1", ["New"]), rec(2, "keep our current position 3", [])],
      undefined,
    ),
  );
  assert.deepEqual(
    s.keyRecommendations.map((k) => k.position),
    [2],
  );
  assert.match(s.keyRecommendations[0]?.text ?? "", /\(keep our current position 3: moved here\)$/);
});

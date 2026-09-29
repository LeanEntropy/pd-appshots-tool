import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { kbCost } from "../src/kb/cost.ts";
import { RecallSetSchema, recallOf } from "../src/kb/recall.ts";
import { type KbQuery, select } from "../src/kb/retrieve.ts";
import { budgetOf } from "../src/kb/steps.ts";
import { entry, fixtureKb } from "./helpers/kb.ts";
import { baseConfig } from "./helpers/kb-config.ts";

const q = (over: Partial<KbQuery> = {}): KbQuery => ({
  step: "recommend",
  store: "google_play",
  country: "US",
  genres: ["roguelike"],
  facts: ["position-1", "layer"],
  preset: "normal",
  ...over,
});
const ids = (kb: ReturnType<typeof fixtureKb>, x: KbQuery) =>
  select(kb, x).picked.map((p) => p.entry.id);

test("eligibility: store, country list and genre; another country's notes never leak in", () => {
  const kb = fixtureKb();
  const us = ids(kb, q());
  assert.ok(!us.includes("jp-note"), "Japan's note is not for the United States");
  assert.ok(us.includes("gn-rogue"), "the project's genre");
  assert.ok(!ids(kb, q({ genres: [] })).includes("gn-rogue"));
  assert.ok(
    ids(kb, q({ step: "countryAdvice", country: "JP", facts: ["advice:words"] })).includes(
      "jp-note",
    ),
  );
});

test("mandatory material: enforced store rules always, the country's regulation notes in the reserved part", () => {
  const kb = fixtureKb();
  const s = select(kb, q());
  assert.ok(
    s.picked
      .filter((p) => p.mandatory)
      .map((p) => p.entry.id)
      .includes("gp-enf-1"),
  );
  const jp = select(kb, q({ step: "countryAdvice", country: "JP", facts: [] }));
  assert.ok(jp.picked.some((p) => p.entry.id === "jp-reg" && p.mandatory));
});

test("mandatory material that does not fit blocks the call with the reason, nothing dropped silently", () => {
  const many = Array.from({ length: 30 }, (_, i) =>
    entry(`gp-rule-${i}`, "store_fact", ["g1"], ["screenshots"], {
      ruleClass: "enforced_rule",
      claim: `Rule ${i} ${"with a long policy statement ".repeat(6)}`,
      enforcement: {
        consequence: "listing removed",
        exactWording: "x ".repeat(100),
        policyUrl: "https://support.google.com/googleplay/android-developer/answer/1",
      },
    }),
  );
  const kb = fixtureKb({ entries: many });
  const s = select(kb, q({ preset: "small" }));
  assert.ok(s.blocked);
  assert.match(s.blocked ?? "", /Raise the knowledge budget preset/);
  assert.equal(s.picked.length, 0);
});

test("budget and balance: within the step budget, unverified at most a third, counter-claims travel together", () => {
  const kb = fixtureKb();
  for (const preset of ["small", "normal", "large"] as const) {
    const s = select(kb, q({ preset }));
    assert.ok(s.tokens <= s.budget, `${preset}: ${s.tokens} of ${s.budget}`);
    assert.equal(s.budget, budgetOf("recommend", preset).budget);
    const weak = s.picked.filter((p) => p.computed.trust === "unverified" || p.computed.contested);
    assert.ok(weak.reduce((a, p) => a + p.tokens, 0) <= s.budget / 3 + 60);
  }
  const s = select(kb, q());
  if (s.picked.some((p) => p.entry.id === "h-corr"))
    assert.ok(s.picked.some((p) => p.entry.id === "h-counter"));
  // Handles are K1..Kn in order, global core first.
  assert.deepEqual(
    s.picked.map((p) => p.handle),
    s.picked.map((_, i) => `K${i + 1}`),
  );
});

test("a counter-claim for another country never travels into this country's prompt", () => {
  const list = [
    entry("h-a", "heuristic", ["v1", "d1"], ["first_images"], { contradicts: ["h-b"] }),
    entry("h-b", "heuristic", ["v2", "jp1"], ["first_images"], {
      scope: {
        store: ["google_play"],
        genre: ["all_games"],
        countries: ["JP"],
        position: ["all"],
        asset: [],
      },
    }),
  ];
  const kb = fixtureKb({ entries: list });
  assert.deepEqual(ids(kb, q()), ["h-a"]);
  assert.deepEqual(ids(kb, q({ country: "JP" })).sort(), ["h-a", "h-b"]);
});

test("entries about other questions are left out with a reason; the facet caps hold", () => {
  const kb = fixtureKb();
  const s = select(kb, q({ step: "patterns", facts: [] }));
  assert.ok(
    !s.picked.some((p) => p.entry.kind === "store_fact"),
    "pattern wording takes no store rules",
  );
  assert.ok(s.leftOut.some((l) => l.id === "exp-fact"));
});

test("recall fixture: retrieval finds the must-have entries (gate)", () => {
  const set = RecallSetSchema.parse(
    JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "kb-recall.json"), "utf8")),
  );
  const r = recallOf(fixtureKb(), set);
  assert.ok(r.pass, JSON.stringify(r.cases.filter((c) => c.missing.length)));
  assert.ok(r.total >= 10);
});

test("cost: priced per report from the call graph, with the $0.50 cap (D6)", () => {
  const c = baseConfig(true);
  const pilot = kbCost(c, { main: true, abroad: 0, abTests: true });
  assert.ok(pilot.usd[0] > 0 && pilot.usd[0] <= pilot.usd[1]);
  assert.equal(pilot.capUsd, 0.5);
  const five = kbCost(c, { main: false, abroad: 5, abTests: true });
  assert.ok(five.tokens[1] > pilot.tokens[1]);
  const big = kbCost(c, { main: true, abroad: 9, abTests: true }, "large");
  assert.equal(big.overCap, big.usd[1] > 0.5);
});

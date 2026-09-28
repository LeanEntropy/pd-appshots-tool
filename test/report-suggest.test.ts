import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCheck, savePairVerdict } from "../src/reports/match-check.ts";
import { buildScopePlan } from "../src/reports/scope-plan.ts";
import { setDismissed, suggestionsView } from "../src/reports/suggest.ts";
import {
  addDeck,
  analyse,
  builderProject,
  idOf,
  idsOf,
  newText,
  picture,
  readyReport,
  usBytes,
} from "./helpers/builder.ts";

const CODES = /\b(S\d|L\d|F\d|pick-gap|layer-diff|full-check)\b/;

test("suggestions: Full check first, localising countries, skipped countries, charts; ranked and free to show", async () => {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  const pick = ["Capybara Go", "Mini Tales", "Heroll", "Archero 2", "Dicero"];
  assert.equal(suggestionsView(loaded).note, "Suggestions appear once the Pilot is ready.");
  readyReport(loaded, "pilot");
  analyse(loaded, [ours, "Capybara Go", "Mini Tales"]);
  // Japan: every competitor changes its images; the Philippines: all reused from the US.
  for (const [i, n] of pick.entries()) {
    await addDeck(loaded, n, "jp", "ja", [await picture(800 + i)]);
    await addDeck(loaded, n, "ph", "en", [usBytes(loaded, idOf(loaded, n), 1)]);
  }
  await addDeck(loaded, ours, "id", "id", [usBytes(loaded, idOf(loaded, ours), 1)], "ours", {
    id: 10,
  });
  await addDeck(
    loaded,
    ours,
    "us",
    "en",
    [1, 2, 3].map((p) => usBytes(loaded, idOf(loaded, ours), p)),
    "ours",
    { id: 10 },
  );
  const v = suggestionsView(loaded);
  assert.equal(v.note, null);
  const top = v.suggestions[0];
  assert.equal(top?.title, "Run the Full check");
  assert.equal(top?.category, "full-check");
  const jp = v.suggestions.find((s) => s.title === "A Japan report");
  assert.ok(jp);
  assert.match(jp.why, /change 5 of 5 images in Japan/);
  // The cost shown is the builder's own plan for the same scope.
  const plan = buildScopePlan(loaded, jp.action?.scope as never, { proposeDrop: false });
  assert.deepEqual(jp.cost?.usd, plan.usd);
  const ph = v.suggestions.find((s) => s.category === "same");
  assert.match(
    ph?.why ?? "",
    /^Skip the Philippines: 5 of 5 images are reused from the United States/,
  );
  const chart = v.suggestions.find((s) => s.category === "charts");
  assert.match(chart?.why ?? "", /is #10 grossing in Indonesia/);
  assert.equal(chart?.cost, null);
  // Ranked by value / (1 + cost); plain words only.
  for (let i = 1; i < v.suggestions.length; i++)
    assert.ok((v.suggestions[i - 1]?.score ?? 0) >= (v.suggestions[i]?.score ?? 0));
  for (const s of v.suggestions) assert.doesNotMatch(`${s.title} ${s.why} ${s.rankWhy}`, CODES);
  // The coverage map: ours first, the main country first, report use separate from coverage.
  assert.equal(v.coverage.rows[0]?.kind, "ours");
  assert.equal(v.coverage.countries[0]?.gl, "us");
  assert.equal(v.coverage.rows[0]?.cells[0]?.state, "analysed");
  assert.equal(v.coverage.rows.find((r) => r.name === "Heroll")?.cells[0]?.state, "downloaded");
  // Dismissed stays dismissed; restored comes back.
  assert.ok(setDismissed(loaded, jp.id, true));
  assert.ok(!suggestionsView(loaded).suggestions.some((s) => s.id === jp.id));
  assert.ok(suggestionsView(loaded).dismissed.some((s) => s.id === jp.id));
  assert.ok(setDismissed(loaded, jp.id, false));
  assert.ok(suggestionsView(loaded).suggestions.some((s) => s.id === jp.id));
  assert.equal(setDismissed(loaded, "s-000000000000", true), false);
  // Once the Full check is ready, a picked competitor not analysed is the gap to fill.
  readyReport(loaded, "core");
  const after = suggestionsView(loaded).suggestions;
  assert.ok(!after.some((s) => s.category === "full-check"));
  assert.ok(after.some((s) => s.category === "pick-gap" && /Heroll/.test(s.title)));
});

test("picture-match check: doubtful pairs shown; a pair marked different is analysed in full", async () => {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  analyse(loaded, [ours]);
  const us1 = usBytes(loaded, idOf(loaded, ours), 1);
  await addDeck(loaded, ours, "jp", "ja", [await newText(us1)], "ours");
  const check = matchCheck(loaded);
  assert.equal(check.checked, 1);
  assert.equal(check.same, 1);
  const scope = {
    type: "country" as const,
    markets: [{ gl: "jp", hl: "ja", label: "Japan" }],
    competitors: idsOf(loaded, []),
    includeCharts: [],
  };
  const before = buildScopePlan(loaded, scope).items[0];
  assert.equal(before?.tier, "layer-diff");
  savePairVerdict(loaded, before?.imageId as string, before?.basedOn as string, false);
  assert.equal(buildScopePlan(loaded, scope).items[0]?.tier, "full");
  assert.equal(matchCheck(loaded).different, 1);
});

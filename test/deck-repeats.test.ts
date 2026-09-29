import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
  findRepeats,
  ourRepeatAction,
  type RepeatSlot,
  runsText,
  type SameLevel,
} from "../src/analysis/deck-repeats.ts";
import { assignTiers } from "../src/analysis/tiers.ts";
import { projectPaths } from "../src/config/load.ts";
import { buildReportVersion } from "../src/reports/build.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import { repeatUpgrader } from "../src/reports/repeat-upgrade.ts";
import { ensureSameScreens } from "../src/reports/same-screen-run.ts";
import { buildScopePlan } from "../src/reports/scope-plan.ts";
import { createReport } from "../src/reports/store.ts";
import type { ReportScope } from "../src/reports/types.ts";
import { getReportVersion } from "../src/server/reports-api.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { sameScreenFiles } from "../src/store/same-screen.ts";
import {
  addDeck,
  analyse,
  builderProject,
  idOf,
  idsOf,
  readyReport,
  usBytes,
} from "./helpers/builder.ts";
import { screen, tallScreen } from "./helpers/screens.ts";

const slot = (position: number, imageId: string, tall = false): RepeatSlot => ({
  position,
  imageId,
  width: tall ? 1242 : 1080,
  height: tall ? 2688 : 1920,
});

/** Same screens: a1 = b1, ...; the level of each named pair (2 unless said otherwise). */
const check =
  (pairs: Record<string, SameLevel>) =>
  (x: string, y: string): SameLevel =>
    x === y ? 2 : (pairs[`${x}|${y}`] ?? pairs[`${y}|${x}`] ?? 0);

test("a doubled set is one ordered run, counted once, in plain words", () => {
  const slots = [
    ...["a", "b", "c", "d", "e", "f"].map((id, i) => slot(i + 1, id)),
    ...["A", "B", "C", "D", "E", "F"].map((id, i) => slot(i + 7, id, true)),
  ];
  const same = check({ "a|A": 2, "b|B": 2, "c|C": 2, "d|D": 2, "e|E": 2, "f|F": 2 });
  const r = findRepeats(slots, same);
  assert.ok(r);
  assert.equal(r.total, 12);
  assert.equal(r.unique, 6);
  assert.equal(r.size, "taller");
  assert.equal(runsText(r), "positions 7–12 repeat 1–6");
  assert.equal(
    ourRepeatAction(r),
    "Your store page shows the same 6 screenshots twice (positions 7–12 repeat 1–6, in a taller size). Remove the second set, or replace it with 6 new screens.",
  );
  // A single deck (US, Thailand...): nothing.
  assert.equal(findRepeats(slots.slice(0, 6), same), null);
});

test("a likely pair counts only when it continues a run of confirmed pairs", () => {
  const slots = [
    ...["a", "b", "c", "d"].map((id, i) => slot(i + 1, id)),
    ...["A", "B", "C", "D"].map((id, i) => slot(i + 5, id, true)),
  ];
  const r = findRepeats(slots, check({ "a|A": 2, "b|B": 2, "c|C": 1, "d|D": 2 }));
  assert.equal(r && runsText(r), "positions 5–8 repeat 1–4");
  // Alone, a likely pair (for example two screens on one template) is not a repeat.
  assert.equal(findRepeats(slots, check({ "c|C": 1, "a|B": 1 })), null);
  // A likely pair away from the run (no neighbour in it) stays out.
  const six = [
    ...["a", "b", "c", "d", "e", "f"].map((id, i) => slot(i + 1, id)),
    ...["A", "B", "C", "D", "E", "F"].map((id, i) => slot(i + 7, id, true)),
  ];
  const gap = findRepeats(six, check({ "a|A": 2, "b|B": 2, "e|E": 1 }));
  assert.equal(gap && runsText(gap), "positions 7–8 repeat 1–2");
  // One confirmed pair is not a run: the likely one stays out.
  const one = findRepeats(slots, check({ "a|A": 2, "b|B": 1 }));
  assert.equal(one && runsText(one), "position 5 repeats 1");
});

test("the planner reuses the earlier copy's analysis for a repeated screen", () => {
  const t = assignTiers(
    [
      { appId: "g", gl: "us", hl: "en", position: 1, imageId: "a", phash: "0" },
      {
        appId: "g",
        gl: "us",
        hl: "en",
        position: 2,
        imageId: "A",
        phash: "1",
        repeatOf: { position: 1, imageId: "a" },
      },
    ],
    [],
    () => true,
  );
  assert.deepEqual(
    t.map((x) => [x.tier, x.basedOn]),
    [
      ["full", null],
      ["identical", "a"],
    ],
  );
  assert.match(t[1]?.reason ?? "", /^same screen in another size \(free\)/);
});

test("pixels: the same screen at another size matches; another screen on the same background does not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ssr-same-"));
  const file = async (name: string, b: Promise<Buffer>) => {
    const buf = await b;
    const meta = await sharp(buf).metadata();
    const f = join(dir, `${name}.png`);
    writeFileSync(f, buf);
    return { id: name, phash: "", width: meta.width ?? 0, height: meta.height ?? 0, file: f };
  };
  const one = await file("one", screen(1));
  const oneTall = await file("one-tall", tallScreen(1));
  const two = await file("two", screen(2));
  const twoTall = await file("two-tall", tallScreen(2));
  const same = await sameScreenFiles(one, oneTall);
  assert.equal(same.same, true, JSON.stringify(same));
  assert.equal((await sameScreenFiles(two, twoTall)).same, true);
  // Near-identical but different screens: same background and band, other game area and text.
  for (const [a, b] of [
    [one, two],
    [one, twoTall],
    [two, oneTall],
  ] as const) {
    const r = await sameScreenFiles(a, b);
    assert.equal(r.same, false, `${a.id} vs ${b.id}: ${JSON.stringify(r)}`);
    assert.ok(r.share < 0.2, `${a.id} vs ${b.id}: ${r.share}`);
  }
});

const JP = { gl: "jp", hl: "ja", label: "Japan" };

test("our doubled set in Japan: free in the plan, counted once, the top finding of the report", async () => {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  const two = ["Capybara Go", "Mini Tales"];
  analyse(loaded, [ours, ...two]);
  readyReport(loaded, "pilot");
  const set = [await screen(1), await screen(2), await screen(3)];
  const tall = [await tallScreen(1), await tallScreen(2), await tallScreen(3)];
  await addDeck(loaded, ours, "jp", "ja", [...set, ...tall], "ours");
  for (const n of two) await addDeck(loaded, n, "jp", "ja", [usBytes(loaded, idOf(loaded, n), 1)]);
  const scope: ReportScope = {
    type: "country",
    markets: [JP],
    competitors: idsOf(loaded, two),
    includeCharts: [],
  };
  const oursId = loaded.config.ourApp.id;
  const mine = () => buildScopePlan(loaded, scope).items.filter((i) => i.appId === oursId);
  // Before the free check: six full analyses.
  assert.deepEqual(
    mine().map((i) => i.tier),
    ["full", "full", "full", "full", "full", "full"],
  );
  assert.ok((await ensureSameScreens(loaded)) > 0);
  const items = mine();
  assert.deepEqual(
    items.map((i) => i.tier),
    ["full", "full", "full", "identical", "identical", "identical"],
  );
  assert.equal(items[3]?.basedOn, items[0]?.imageId);
  assert.match(items[3]?.reason ?? "", /same screen in another size \(free\)/);
  // Nothing new to analyse once Japan's screens are read: the report builds at once.
  analyse(loaded, [ours], "jp", "ja");
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const def = createReport(s, paths, { name: "Japan", type: "country", scope });
  const built = await buildReportVersion(loaded, def, { now: new Date("2026-09-29T12:00:00Z") });
  assert.ok(built.ok, built.ok ? "" : built.problem);
  const v = getReportVersion(loaded, def.id, built.versionId).body as { country: CountryReport };
  const action =
    "Your store page shows the same 3 screenshots twice (positions 4–6 repeat 1–3, in a taller size). Remove the second set, or replace it with 3 new screens.";
  assert.ok(
    v.country.summary.shortAnswer.startsWith(`Japan: ${action.replace("Your", "your")}`),
    v.country.summary.shortAnswer,
  );
  assert.equal(v.country.summary.keyActions[0]?.text, action);
  assert.equal(
    v.country.summary.keyActions[0]?.why,
    "Counted once in this report: 6 images, 3 unique.",
  );
  const data = v.country.countries[0]?.data;
  assert.deepEqual(
    data?.repeats?.map((r) => [r.ours, r.total, r.unique, r.counted]),
    [[true, 6, 3, true]],
  );
  const row4 = data?.games.find((g) => g.ours)?.rows.find((r) => r.position === 4);
  assert.equal(row4?.repeatOf, 1);
  assert.equal(row4?.screen, "Same screen as #1 (in a taller size)");
  assert.equal(data?.fit?.keyPoints[0], action);
  // A version saved before the check gets the finding when opened, and says what it counted.
  const old = JSON.parse(JSON.stringify(v.country)) as CountryReport;
  for (const c of old.countries) {
    delete c.data.repeats;
    for (const g of c.data.games) for (const r of g.rows) delete r.repeatOf;
  }
  old.summary.shortAnswer = "Our store page is on par.";
  old.summary.keyActions = [];
  const up = repeatUpgrader(loaded).country(old);
  assert.ok(up.summary.shortAnswer.startsWith("Japan: your store page shows the same 3"));
  assert.equal(up.countries[0]?.data.repeats?.[0]?.counted, false);
  assert.match(up.summary.keyActions[0]?.why ?? "", /built before the check/);
  // Opening it twice changes nothing more.
  assert.deepEqual(repeatUpgrader(loaded).country(up), up);
});

test("single decks and competitors' repeats: no finding for us, a note for them", async () => {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  const two = ["Capybara Go", "Mini Tales"];
  analyse(loaded, [ours, ...two]);
  readyReport(loaded, "pilot");
  await addDeck(loaded, ours, "jp", "ja", [await screen(1), await screen(2)], "ours");
  await addDeck(loaded, "Capybara Go", "jp", "ja", [
    await screen(5),
    await screen(6),
    await tallScreen(5),
    await tallScreen(6),
  ]);
  await addDeck(loaded, "Mini Tales", "jp", "ja", [await screen(7), await screen(8)]);
  await ensureSameScreens(loaded);
  analyse(loaded, [ours, ...two], "jp", "ja");
  const scope: ReportScope = {
    type: "country",
    markets: [JP],
    competitors: idsOf(loaded, two),
    includeCharts: [],
  };
  const paths = projectPaths(loaded);
  const def = createReport(workspaceStorage(paths.workspace), paths, {
    name: "Japan",
    type: "country",
    scope,
  });
  const built = await buildReportVersion(loaded, def);
  assert.ok(built.ok);
  const v = getReportVersion(loaded, def.id, built.versionId).body as { country: CountryReport };
  const data = v.country.countries[0]?.data;
  assert.deepEqual(
    data?.repeats?.map((r) => [r.name, r.ours, r.total, r.unique]),
    [["Capybara Go", false, 4, 2]],
  );
  assert.ok(!v.country.summary.shortAnswer.includes("store page shows"));
  assert.ok(!v.country.summary.keyActions.some((a) => a.text.includes("store page shows")));
  const capy = data?.patterns?.games.find((g) => g.name === "Capybara Go");
  assert.deepEqual([capy?.deckLength, capy?.images], [2, 4]);
  assert.match(data?.patterns?.repeats?.[0] ?? "", /^Capybara Go: 4 images, 2 unique/);
});

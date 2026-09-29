import assert from "node:assert/strict";
import { test } from "node:test";
import { textFits } from "../src/reports/derive-ab.ts";
import { captureShare } from "../src/reports/group-dims.ts";
import { gameValue } from "../src/reports/group-findings.ts";
import { effectiveGroups, suggestGroups } from "../src/reports/groups.ts";
import { deck, pages, row } from "./helpers/groups-fixture.ts";

const JP = { gl: "jp", hl: "ja", label: "Japan" };
const KR = { gl: "kr", hl: "ko", label: "South Korea" };
const TH = { gl: "th", hl: "th", label: "Thailand" };

test("a game with a page not analysed in the group is unknown, never yes", () => {
  const ps = [
    pages("jp", "ja", "Japan", [deck("a", "A", { ids: "a-jp", titleArt: true })]),
    pages("kr", "ko", "South Korea", [deck("a", "A", { ids: "a-kr", unknown: true })]),
  ];
  assert.equal(gameValue(ps, ["jp", "kr"], "a", "titleArt"), "unknown");
  assert.equal(gameValue(ps, ["jp"], "a", "titleArt"), "yes");
});

test("an unreadable capture share is unknown, not a large layer", () => {
  assert.equal(captureShare(row(1, { captures: ["Gameplay, fills the image"] })), null);
  assert.equal(
    captureShare(row(1, { captures: ["a, 40% of the image", "b, 30% of the image"] })),
    70,
  );
});

test("All compared countries stays next to the user's own groups; repeated countries count once", () => {
  const ps = [JP, KR, TH].map((m) =>
    pages(m.gl, m.hl, m.label, [deck("a", "A", { ids: `a-${m.gl}` })]),
  );
  const sug = suggestGroups([JP, KR, TH], []);
  const got = effectiveGroups([{ name: "Pair", countries: ["jp", "jp", "kr"] }], sug, ps);
  assert.deepEqual(
    got.map((g) => g.group.name),
    ["All compared countries", "Pair"],
  );
  assert.deepEqual(got[1]?.group.countries, ["jp", "kr"]);
  assert.equal(got[1]?.suggested, false);
});

test("a Latin-script listing refuses Japanese, Korean or Thai letters in new text", () => {
  assert.equal(textFits("Roll the dice!", "en"), true);
  assert.equal(textFits("Roll サイコロ", "en"), false);
  assert.equal(textFits("ลุยเลย", "th"), true);
});

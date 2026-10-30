import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allKeys, deriveKeywords, display, wordRuns } from "../src/analysis/keywords.ts";
import { storeTextMarkdown } from "../src/analysis/report-store-md.ts";
import { compareStoreText, storeTextViews } from "../src/analysis/store-compare.ts";
import {
  hasStoreText,
  latestStoreText,
  saveStoreText,
  storeTextDir,
} from "../src/library/store-text.ts";
import { officialFromApp, type StoreOfficial } from "../src/play/store-text.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { STORE_SCRIPT } from "../src/view/gallery-store.ts";

const storage = () => workspaceStorage(mkdtempSync(join(tmpdir(), "ssr-store-")));

function official(o: Partial<StoreOfficial> = {}): StoreOfficial {
  return {
    title: null,
    shortDescription: null,
    description: null,
    recentChanges: null,
    genre: { id: "GAME_ROLE_PLAYING", name: "Role Playing" },
    chips: [{ id: "GAME_ROLE_PLAYING", name: "Role Playing" }],
    contentRating: null,
    ...o,
  };
}

test("store text: the scraper answer is cleaned (entities, line breaks), missing fields are null", () => {
  const o = officialFromApp({
    title: "Legend of Slime: Idle RPG",
    summary: "An epic idle war &amp; online RPG!",
    recentChanges: "What&#39;s New<br>* New Saga",
    genre: "Role Playing",
    genreId: "GAME_ROLE_PLAYING",
    categories: [
      { name: "Role Playing", id: "GAME_ROLE_PLAYING" },
      { name: "Idle RPG", id: null },
      { bad: 1 },
    ],
    contentRating: 7,
  });
  assert.ok(o);
  assert.equal(o.shortDescription, "An epic idle war & online RPG!");
  assert.equal(o.recentChanges, "What's New\n* New Saga");
  assert.equal(o.description, null);
  assert.equal(o.contentRating, null, "a wrong type is 'not available', not an error");
  assert.deepEqual(
    o.chips.map((c) => [c.id, c.name]),
    [
      ["GAME_ROLE_PLAYING", "Role Playing"],
      [null, "Idle RPG"],
    ],
  );
  assert.equal(officialFromApp("nonsense"), null);
  const html = officialFromApp({
    description: "<p>First</p><p>Second</p><ul><li>A</li><li>B</li></ul>",
  });
  assert.deepEqual(
    html?.description?.split(/\n+/),
    ["First", "Second", "A", "B"],
    "block tags keep words apart",
  );
});

test("keywords: weighted by field, stopwords removed, no phrase bridges a removed word", () => {
  const o = official({
    title: "Rogue Legend - Roguelike RPG",
    shortDescription: "Action roguelike RPG with upgrades and boss fights!",
    description:
      "Roll the dice and beat the boss. Visit https://example.com or mail help@example.com.\nIdle progression for every hero.",
    chips: [
      { id: "GAME_ROLE_PLAYING", name: "Role Playing" },
      { id: null, name: "Roguelike" },
      { id: null, name: "Roguelike" },
    ],
  });
  const k = deriveKeywords(o, "en");
  const byKey = new Map(k.map((x) => [x.key, x]));
  // title 3 + short 2 = 5; tag names are compared as tags, never split into keywords (v2)
  assert.equal(byKey.get("roguelike rpg")?.score, 5);
  assert.deepEqual(byKey.get("roguelike rpg")?.fields, ["title", "short"]);
  assert.equal(k[0]?.key, "roguelike rpg");
  assert.ok(!byKey.has("role playing") && !allKeys(o, "en").has("role playing"), "no tag names");
  // "Rogue Legend" only ever appears together: the single words are dropped for the phrase.
  assert.ok(byKey.has("rogue legend") && !byKey.has("rogue") && !byKey.has("legend"));
  assert.ok(!byKey.has("the") && !byKey.has("and"), "stopwords");
  assert.ok(![...allKeys(o, "en")].some((x) => x.includes("example")), "URLs and e-mails dropped");
  // "beat the boss" never becomes one phrase: "the" ends the run.
  assert.ok(!allKeys(o, "en").has("beat boss"));
  assert.ok(k.every((x) => x.score >= 2));
  // A hyphenated word stays whole: "Light-hearted" is never "light" and "hearted".
  const h = wordRuns("A light-hearted game. Play Mah-jong!", "en").flat();
  assert.ok(h.includes("light-hearted") && h.includes("mah-jong"), h.join("|"));
  assert.ok(!h.includes("hearted"));
});

test("keywords: Japanese, Chinese and Thai are split into words (ICU), shown without spaces", () => {
  const ja = wordRuns("サイコロを振ってボスを倒せ！放置で強くなるローグライクRPG！", "ja").flat();
  assert.ok(ja.includes("サイコロ") && ja.includes("ボス"), ja.join("|"));
  assert.ok(!ja.includes("を") && !ja.includes("で"), "particles dropped");
  const zh = wordRuns("動作Roguelike RPG，擁有強化、BOSS戰與放置成長！", "zh-TW").flat();
  assert.ok(zh.includes("roguelike") && zh.includes("rpg") && zh.includes("強化"), zh.join("|"));
  assert.ok(!zh.includes("與"), "Traditional stopword");
  const th = wordRuns("ทอยลูกเต๋า สู้บอส อัปเกรดฮีโร่ของคุณ", "th").flat();
  assert.ok(th.includes("ลูกเต๋า") && th.includes("ฮีโร่"), th.join("|"));
  assert.ok(!th.includes("คุณ"));
  assert.equal(display(["放置", "型"]), "放置型");
  assert.equal(display(["ローグライク", "rpg"]), "ローグライク rpg");
  assert.equal(display(["idle", "rpg"]), "idle rpg");
});

test("library: saved per day read, newest wins, older keyword method derived again", () => {
  const s = storage();
  const page = (fetchedAt: string, title: string) => ({
    appId: "com.some_game",
    gl: "us",
    hl: "en",
    fetchedAt,
    official: official({ title }),
  });
  assert.equal(hasStoreText(s, "com.some_game", "us", "en"), false);
  saveStoreText(s, page("2026-09-01T10:00:00Z", "Old Title Game"));
  saveStoreText(s, page("2026-09-20T08:00:00Z", "Morning Title"));
  saveStoreText(s, page("2026-09-20T18:00:00Z", "Evening Title"));
  const dir = storeTextDir("com.some_game", "us", "en");
  assert.equal([...s.list(dir)].length, 2, "one file per day");
  const last = latestStoreText(s, "com.some_game", "us", "en");
  assert.equal(last?.official.title, "Evening Title");
  assert.equal(last?.date, "2026-09-20");
  s.putJson(`${dir}/2026-09-21.json`, {
    ...last,
    date: "2026-09-21",
    derived: { version: 0, keywords: [] },
  });
  const re = latestStoreText(s, "com.some_game", "us", "en");
  assert.ok(
    re?.derived.keywords.some((k) => k.key === "evening title"),
    "derived again",
  );
  s.putJson(`${dir}/2026-09-22.json`, { broken: true });
  assert.equal(
    latestStoreText(s, "com.some_game", "us", "en")?.date,
    "2026-09-21",
    "bad file skipped",
  );
  // Current method but damaged keywords: derived again rather than crashing a page.
  s.putJson(`${dir}/2026-09-23.json`, {
    ...re,
    date: "2026-09-23",
    derived: { version: 1, keywords: [{ key: 1 }] },
  });
  assert.ok(latestStoreText(s, "com.some_game", "us", "en")?.derived.keywords.length);
  // Only a damaged file: not counted as saved, so the backfill reads the page again.
  const other = storeTextDir("other.game", "us", "en");
  s.putJson(`${other}/2026-09-01.json`, {
    appId: "other.game",
    date: "2026-09-01",
    official: { chips: [] },
  });
  assert.equal(hasStoreText(s, "other.game", "us", "en"), false);
});

test("compare: competitor keywords missing from ours, per country; same text folded", () => {
  const s = storage();
  const save = (appId: string, gl: string, description: string, title = appId) =>
    saveStoreText(s, {
      appId,
      gl,
      hl: "en",
      fetchedAt: "2026-09-28T00:00:00Z",
      official: official({ title, description }),
    });
  save("our.app", "us", "Dice roguelike adventure. Dice roguelike adventure.");
  save("a.app", "us", "Idle heroes with pets. Idle heroes with pets.");
  save("b.app", "us", "Idle heroes and dice. Idle heroes and dice.");
  save("our.app", "ph", "Dice roguelike adventure. Dice roguelike adventure.");
  const markets = [
    { gl: "us", hl: "en", label: "United States" },
    { gl: "ph", hl: "en", label: "Philippines" },
    { gl: "jp", hl: "ja", label: "Japan" },
  ];
  const cs = compareStoreText(s, markets, { appId: "our.app", name: "Ours" }, [
    { appId: "a.app", name: "A" },
    { appId: "b.app", name: "B" },
  ]);
  assert.deepEqual(
    cs.map((c) => c.gl),
    ["us", "ph"],
    "countries with nothing saved are left out",
  );
  const us = cs[0];
  assert.ok(us?.oursSaved);
  const terms = us?.missing.map((m) => m.term) ?? [];
  assert.ok(terms.includes("idle heroes"), terms.join("|"));
  assert.ok(!terms.includes("dice"), "we use it");
  assert.ok(!terms.includes("pets"), "only one competitor");
  assert.equal(cs[1]?.rows.filter((r) => r.store).length, 1);
  const views = storeTextViews(s, "our.app", markets);
  assert.equal(views[1]?.sameAs, "United States");
  const md = storeTextMarkdown(cs).join("\n");
  assert.match(md, /Keywords derived from the store text/);
  assert.match(md, /Google Play has no official keywords/);
  assert.match(md, /### United States[\s\S]*idle heroes \(A, B\)/);
  assert.match(storeTextMarkdown([]).join("\n"), /npm run store-text/);
});

test("page: the Store (i) and the report section say the keywords are derived, and escape text", () => {
  const data = {
    storeText: {
      "x.app": [
        {
          gl: "us",
          hl: "en",
          label: "United States",
          date: "2026-09-28",
          category: "Role Playing",
          chipCategory: null,
          tags: ["<b>Idle</b>"],
          keywords: ["idle rpg"],
          title: "X",
          shortDescription: "Short",
          contentRating: "Everyone",
          sameAs: null,
        },
      ],
    },
  };
  const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const api = new Function(
    "DATA",
    "esc",
    `${STORE_SCRIPT}; return { storeBtn, storeHtml, storeTextHtml };`,
  )(data, esc) as Record<string, (x: unknown) => string>;
  assert.match(api.storeBtn?.("x.app") ?? "", /data-info="store:x\.app"/);
  assert.equal(api.storeBtn?.("none"), "");
  const h = api.storeHtml?.("x.app") ?? "";
  assert.match(h, /Keywords \(derived\)/);
  assert.match(h, /Google Play has no official keywords/);
  assert.ok(!h.includes("<b>Idle"), "escaped");
  assert.match(api.storeTextHtml?.({ storeText: [] }) ?? "", /npm run store-text/);
});

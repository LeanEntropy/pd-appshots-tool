import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { allKeys, deriveKeywords, display, wordRuns } from "../src/analysis/keywords.ts";
import { storeTextMarkdown } from "../src/analysis/report-store-md.ts";
import { compareStoreText, storeTextViews } from "../src/analysis/store-compare.ts";
import { projectPaths } from "../src/config/load.ts";
import {
  hasStoreText,
  latestStoreText,
  saveStoreText,
  storeTextDir,
} from "../src/library/store-text.ts";
import type { Listing } from "../src/play/client.ts";
import { officialFromApp, type StoreOfficial } from "../src/play/store-text.ts";
import { runStoreTextBackfill } from "../src/steps/store-text.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { STORE_SCRIPT } from "../src/view/gallery-store.ts";
import { tempProject } from "./helpers/project.ts";

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
  // title 3 + tags 3 (once, though listed twice) + short 2 = 8
  assert.equal(byKey.get("roguelike")?.score, 8);
  assert.deepEqual(byKey.get("roguelike")?.fields, ["title", "tags", "short"]);
  assert.equal(k[0]?.key, "roguelike");
  // "Rogue Legend" only ever appears together: the single words are dropped for the phrase.
  assert.ok(byKey.has("rogue legend") && !byKey.has("rogue") && !byKey.has("legend"));
  assert.ok(!byKey.has("the") && !byKey.has("and"), "stopwords");
  assert.ok(![...allKeys(o, "en")].some((x) => x.includes("example")), "URLs and e-mails dropped");
  // "beat the boss" never becomes one phrase: "the" ends the run.
  assert.ok(!allKeys(o, "en").has("beat boss"));
  assert.ok(k.every((x) => x.score >= 2));
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
});

function loadedName(i: number): string {
  return ["Capybara Go", "Mini Tales", "Heroll"][i] ?? "";
}

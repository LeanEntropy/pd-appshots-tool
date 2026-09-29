import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { type AppleApp, parseLookup } from "../src/appstore/api.ts";
import { assetPath, fullSizeUrl } from "../src/appstore/assets.ts";
import { emptyAppStore } from "../src/appstore/data.ts";
import { appleLangFor } from "../src/appstore/lang.ts";
import {
  matchByBundle,
  matchBySearch,
  normaliseName,
  sellerMatches,
} from "../src/appstore/match.ts";
import { runMatching } from "../src/appstore/matching.ts";
import { AppleQueue, type Clock, HttpError } from "../src/appstore/queue.ts";

const fixture = () =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "appstore", "lookup-us.json"), "utf8"),
  );
const NOW = "2026-09-29T00:00:00.000Z";

function fakeClock(): Clock & { t: number; sleeps: number[] } {
  const c = {
    t: 0,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
  };
  return c;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

test("the Lookup reader keeps the iPhone set in API order, counts iPad images, skips non-apps", () => {
  const apps = parseLookup(fixture());
  assert.deepEqual(
    apps.map((a) => a.bundleId),
    ["com.pockethaven.roguelegend", "com.xq.archeroii", "com.TornadoBear.WayOfKings"],
  );
  const rl = apps[0] as AppleApp;
  assert.equal(rl.trackId, 6754965520);
  assert.equal(rl.screenshotUrls.length, 6);
  assert.equal(rl.ipadCount, 6);
  assert.match(rl.screenshotUrls[0] ?? "", /mzstatic\.com/);
  assert.equal(rl.sellerName, "PocketHaven Games Ltd.");
});

test("a malformed API answer fails loudly instead of reading as 'not on the App Store'", () => {
  assert.throws(() => parseLookup({ nope: true }), /unexpected shape/);
  assert.deepEqual(parseLookup({ resultCount: 0, results: [] }), []);
});

test("full-size URLs keep the asset path and the original format", () => {
  const png = "https://is1-ssl.mzstatic.com/image/thumb/P/v4/0e/cc/x/A.png/320x480bb.jpg";
  const jpg = "https://is1-ssl.mzstatic.com/image/thumb/P/v4/65/c4/y/1242x2688-a.jpg/392x696bb.jpg";
  assert.equal(assetPath(png), "/image/thumb/P/v4/0e/cc/x/A.png");
  assert.equal(
    fullSizeUrl(png),
    "https://is1-ssl.mzstatic.com/image/thumb/P/v4/0e/cc/x/A.png/9999x9999bb.png",
  );
  assert.match(fullSizeUrl(jpg), /1242x2688-a\.jpg\/9999x9999bb\.jpg$/);
  assert.equal(assetPath(png), assetPath(fullSizeUrl(png)));
});

test("each country is read in its local language (decision 1)", () => {
  assert.equal(appleLangFor("th", "th"), "th_th");
  assert.equal(appleLangFor("id", "id"), "id_id");
  assert.equal(appleLangFor("hk", "zh-TW"), "zh_tw");
  assert.equal(appleLangFor("ph", "en"), "en_us");
  assert.equal(appleLangFor("xx", "ab"), "ab_xx");
});

const apps = () => parseLookup(fixture());
const app = (o: Partial<AppleApp>): AppleApp => ({ ...(apps()[1] as AppleApp), ...o });

test("only an exact bundle id with the same developer is accepted automatically", () => {
  const rl = {
    appId: "com.pockethaven.roguelegend",
    name: "Rogue Legend",
    developer: "PocketHaven Games",
  };
  const m = matchByBundle(rl, apps(), NOW);
  assert.equal(m?.status, "matched");
  assert.equal(m?.auto, true);
  assert.equal(m?.trackId, 6754965520);
  // Only the letter case differs (Path of Kings): the user confirms.
  const pok = { appId: "com.TornadoBear.WayofKings", name: "Path of Kings", developer: "Voodoo" };
  const p = matchByBundle(pok, apps(), NOW);
  assert.equal(p?.status, "needs_confirmation");
  assert.equal(p?.trackId, undefined);
  // Same id, another seller: the user confirms.
  const other = { appId: "com.xq.archeroii", name: "Archero 2", developer: "Someone Else" };
  assert.equal(matchByBundle(other, apps(), NOW)?.status, "needs_confirmation");
  assert.equal(matchByBundle({ ...rl, appId: "com.none" }, apps(), NOW), null);
});

test("name search never auto-matches: lookalikes wait for the user, nothing found is not_found", () => {
  const archero = { appId: "com.xq.archeroii", name: "Archero 2", developer: "Habby" };
  const lookalike = app({
    trackId: 1,
    bundleId: "com.x.hunter",
    trackName: "Archer Hunter",
    sellerName: "X",
    artistName: "X",
  });
  assert.equal(matchBySearch(archero, [lookalike], NOW).status, "not_found");
  const same = app({
    trackId: 2,
    bundleId: "com.other",
    trackName: "Archero 2: Roguelike",
    sellerName: "HABBY PTE. LTD.",
  });
  const m = matchBySearch(archero, [lookalike, same], NOW);
  assert.equal(m.status, "needs_confirmation");
  assert.equal(m.confidence, "medium");
  assert.equal(m.candidates[0]?.trackId, 2);
  assert.equal(m.trackId, undefined);
  assert.ok(sellerMatches("Habby", { sellerName: "HABBY PTE. LTD.", artistName: "" }));
  assert.ok(!sellerMatches("Habby", { sellerName: "Hab", artistName: "" }));
  assert.equal(normaliseName("Sword x Staff - Idle RPG"), "sword x staff");
});

test("matching: one lookup per country, 'not sold' where the known app is missing, failures kept apart", async () => {
  const rl = apps()[0] as AppleApp;
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (u.searchParams.get("country") === "jp") throw new Error("network down");
    const body =
      u.searchParams.get("country") === "us"
        ? { resultCount: 1, results: [fixture().results[0]] }
        : { resultCount: 0, results: [] };
    return json(body);
  };
  const q = new AppleQueue(fetcher, { minIntervalMs: 0, maxRetries: 0 }, fakeClock());
  const prev = emptyAppStore(NOW);
  prev.games["com.pockethaven.roguelegend"] = {
    byCountry: {
      kr: {
        status: "confirmed_none",
        confidence: "none",
        evidence: [],
        candidates: [],
        source: "user",
        checkedAt: NOW,
      },
    },
  };
  const games = [
    { appId: "com.pockethaven.roguelegend", name: "Rogue Legend", developer: "PocketHaven Games" },
  ];
  const markets = ["us", "vn", "jp", "kr"].map((gl) => ({ gl, hl: "en" }));
  const out = await runMatching(q, games, markets, prev, () => {});
  const by = out["com.pockethaven.roguelegend"]?.byCountry ?? {};
  assert.equal(by.us?.trackId, rl.trackId);
  assert.equal(by.vn?.status, "not_found");
  assert.equal(by.jp?.status, "fetch_failed");
  assert.equal(by.kr?.status, "confirmed_none");
  // Three lookups (KR was answered by the user), no name search: the app is known.
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.includes("/lookup?")));
});

test("the queue keeps its pace and honours 429 retry-after, then gives up with the status", async () => {
  const clock = fakeClock();
  const answers = [json({}, 429, { "retry-after": "15" }), json({ a: 1 }), json({ b: 2 })];
  const q = new AppleQueue(async () => answers.shift() as Response, { minIntervalMs: 4000 }, clock);
  const [a, b] = await Promise.all([q.json("https://x.test/1"), q.json("https://x.test/2")]);
  assert.deepEqual([a, b], [{ a: 1 }, { b: 2 }]);
  assert.equal(q.throttled, 1);
  assert.ok(clock.sleeps.includes(15_000));
  // 429 at 0, retry after 15 s, then the second request one pace later.
  assert.equal(clock.t, 15_000 + 4000);
  const q2 = new AppleQueue(
    async () => json({}, 429),
    { minIntervalMs: 0, maxRetries: 2, backoffMs: 1000 },
    fakeClock(),
  );
  await assert.rejects(
    q2.get("https://x.test/3"),
    (e: unknown) => e instanceof HttpError && e.status === 429,
  );
  assert.equal(q2.sent, 3);
  const q3 = new AppleQueue(async () => json({}, 404), { minIntervalMs: 0 }, fakeClock());
  await assert.rejects(q3.get("https://x.test/4"), /HTTP 404/);
  assert.equal(q3.sent, 1);
});

test("an app row that no longer parses fails the read (never 'not found')", () => {
  const bad = { resultCount: 1, results: [{ wrapperType: "software", trackId: "x" }] };
  assert.throws(() => parseLookup(bad), /unexpected shape/);
});

test("a retry-after longer than accepted stops instead of retrying early", async () => {
  const q = new AppleQueue(
    async () => json({}, 429, { "retry-after": "900" }),
    { minIntervalMs: 0 },
    fakeClock(),
  );
  await assert.rejects(q.get("https://x.test/5"), /HTTP 429/);
  assert.equal(q.sent, 1);
});

test("requests are never closer than the pace", async () => {
  const clock = fakeClock();
  const at: number[] = [];
  const q = new AppleQueue(
    async () => {
      at.push(clock.t);
      return json({});
    },
    { minIntervalMs: 4000 },
    clock,
  );
  await Promise.all([1, 2, 3, 4].map((i) => q.json(`https://x.test/${i}`)));
  for (let i = 1; i < at.length; i++) assert.ok((at[i] ?? 0) - (at[i - 1] ?? 0) >= 4000);
});

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";
import { importSeeds } from "../src/kb/import-seed.ts";
import { AUTO_NOTE } from "../src/kb/official.ts";
import { promote } from "../src/kb/promote.ts";
import {
  type Fetcher,
  pageDate,
  quoteOnPage,
  refreshOfficial,
} from "../src/kb/refresh-official.ts";
import { loadKb } from "../src/kb/release.ts";
import { decide, readApprovals, reviewList, syncOfficial } from "../src/kb/review.ts";
import { REFRESH_FILE } from "../src/kb/source-date.ts";
import { writeJsonFile } from "../src/storage/kb-files.ts";
import { KB_REVIEW_SCRIPT } from "../src/view/kb-review.ts";
import { entries, entry, SOURCES, TODAY, tempKbDir } from "./helpers/kb.ts";

const LATER = "2026-11-15"; // more than 30 days after TODAY, the sources' accessed date
const GP_META = "https://support.google.com/googleplay/android-developer/answer/9898842";
const GP_ASSETS = "https://support.google.com/googleplay/android-developer/answer/9866151";

function setup(extraEntries: unknown[] = [], extraSources: unknown[] = []) {
  const { files } = tempKbDir();
  const dir = mkdtempSync(join(tmpdir(), "seed-"));
  writeJsonFile(join(dir, "entries-t.json"), {
    file: "entries-t",
    entries: [...entries(), ...extraEntries],
  });
  writeJsonFile(join(dir, "sources-t.json"), { sources: [...SOURCES, ...extraSources] });
  const report = importSeeds(files, [dir], TODAY);
  return { files, report };
}

const page = (html: string) => ({ status: 200, text: html });
function fakeFetcher(pages: Record<string, { status: number; text: string; url?: string }>) {
  const asked: string[] = [];
  const f: Fetcher = async (url) => {
    asked.push(url);
    const base = url.replace(/[?&]hl=en$/, "");
    const p = pages[base] ?? { status: 200, text: "<p>nothing</p>" };
    return { status: p.status, url: p.url ?? url, text: p.text };
  };
  return { f, asked };
}

test("official entries are approved automatically, listed apart, never one by one", () => {
  const { files } = setup();
  const s = syncOfficial(files, TODAY);
  assert.equal(s.current, 4);
  const saved = readApprovals(files).filter((d) => d.how === "auto");
  assert.equal(saved.length, 4);
  assert.ok(saved.every((d) => d.note === AUTO_NOTE && d.by === "auto" && d.at === TODAY));
  const l = reviewList(files, TODAY);
  assert.deepEqual(l.auto.map((i) => i.id).sort(), [
    "exp-fact",
    "gp-count",
    "gp-enf-1",
    "gp-guid-1",
  ]);
  assert.ok(l.auto.every((i) => i.status === "approved"));
  assert.ok(!l.one.some((i) => i.trust === "official"));
  assert.ok(
    l.one.some((i) => i.id === "jp-reg"),
    "a country regulation note stays one by one",
  );
});

test("an official entry not verified in 30 days or past its review date needs a freshness check", () => {
  const { files } = setup([
    entry("gp-old", "store_fact", ["g1"], ["screenshots"], {
      ruleClass: "store_behaviour",
      reviewBy: "2026-01-01",
    }),
  ]);
  assert.equal(reviewList(files, TODAY).auto.find((i) => i.id === "gp-old")?.status, "needs_check");
  syncOfficial(files, TODAY);
  const later = syncOfficial(files, LATER);
  assert.equal(later.current, 0);
  assert.equal(readApprovals(files).filter((d) => d.how === "auto").length, 0, "withdrawn");
  assert.ok(reviewList(files, LATER).auto.every((i) => i.status === "needs_check"));
  const p = promote(files, LATER, true);
  assert.ok(!p.added.includes("gp-enf-1"), "not used until refreshed");
});

test("the user's own decision on an official entry is never replaced", () => {
  const { files } = setup();
  decide(files, TODAY, "gp-count", "rejected", "user");
  syncOfficial(files, TODAY);
  const d = readApprovals(files).find((x) => x.entryId === "gp-count");
  assert.equal(d?.decision, "rejected");
  assert.equal(d?.how, "one");
});

test("an official entry with an undecided counter-claim waits", () => {
  const { files } = setup([
    entry("h-against", "heuristic", ["v1", "d1"], ["orientation"], { contradicts: ["gp-guid-1"] }),
  ]);
  const l = reviewList(files, TODAY);
  assert.deepEqual(l.auto.find((i) => i.id === "gp-guid-1")?.waitsFor, ["h-against"]);
  const p = promote(files, TODAY);
  assert.ok(p.held.some((h) => h.startsWith("gp-guid-1")));
  assert.ok(!p.added.includes("gp-guid-1"));
});

test("refresh-official: verified pages re-approve, a gone page or missing wording goes one by one", async () => {
  const { files } = setup();
  syncOfficial(files, TODAY);
  const { f, asked } = fakeFetcher({
    [GP_META]: page("<p>Rules</p><p>Do <b>not</b> use ranking&nbsp;claims.</p>"),
    [GP_ASSETS]: { status: 404, text: "" },
  });
  const r = await refreshOfficial(files, LATER, { fetcher: f, delayMs: 0 });
  assert.ok(
    asked.some((u) => u.includes("hl=en")),
    "Google help pages in English",
  );
  assert.equal(r.byStatus.gone, 1);
  assert.deepEqual(r.changed.map((c) => c.id).sort(), ["gp-count", "gp-guid-1"]);
  const l = reviewList(files, LATER);
  assert.deepEqual(l.auto.map((i) => i.id).sort(), ["exp-fact", "gp-enf-1"]);
  assert.ok(l.auto.every((i) => i.status === "approved" && i.how === "auto"));
  assert.equal(l.one.find((i) => i.id === "gp-count")?.official?.state, "changed");
  const log = files.getJson(REFRESH_FILE) as { sources: Record<string, { verified: string }> };
  assert.equal(log.sources.g1?.verified, LATER);
  // The wording disappears from the policy page: the enforced rule asks again.
  const again = await refreshOfficial(files, LATER, {
    fetcher: fakeFetcher({ [GP_META]: page("<p>New rules.</p>") }).f,
    delayMs: 0,
  });
  assert.ok(again.changed.some((c) => c.id === "gp-enf-1"));
  assert.equal(reviewList(files, LATER).one.find((i) => i.id === "gp-enf-1")?.status, "pending");
});

test("source dates: before 2023 removed, trust recounted, entries without a source dropped", () => {
  const extraSources = [
    { ...SOURCES[4], id: "old1", published: "2022-11", evidenceOrigin: "old-org" },
    { ...SOURCES[4], id: "old2", published: "2021", evidenceOrigin: "older-org" },
    { ...SOURCES[4], id: "nod1", published: "unknown", evidenceOrigin: "nodate-org" },
    {
      ...SOURCES[0],
      id: "gnd",
      published: "unknown",
      url: "https://support.google.com/googleplay/android-developer/answer/1",
    },
  ];
  const { files, report } = setup(
    [
      entry("h-was-corr", "heuristic", ["v1", "old1"], ["captions"]),
      entry("h-gone", "heuristic", ["old2"], ["captions"]),
      entry("h-nodate", "heuristic", ["v2", "nod1"], ["captions"]),
      entry("gp-undated", "store_fact", ["gnd"], ["screenshots"], { ruleClass: "store_behaviour" }),
    ],
    extraSources,
  );
  const d = report.dateRule;
  assert.deepEqual(d.removedSources.map((r) => r.id).sort(), ["gnd", "nod1", "old1", "old2"]);
  assert.deepEqual(d.droppedEntries.sort(), ["gp-undated", "h-gone"]);
  assert.deepEqual(d.trustChanged.map((t) => `${t.id}:${t.from}>${t.to}`).sort(), [
    "h-nodate:corroborated>unverified",
    "h-was-corr:corroborated>unverified",
  ]);
  assert.equal(report.byMarket.global, entries().length);
  const kb = loadKb(files, "inbox", TODAY);
  assert.ok(!kb.byId.has("h-gone") && kb.problems.length === 0);
  assert.ok(loadKb(files, "inbox", TODAY, { raw: true }).byId.has("h-gone"));
});

test("source dates: undated pages count after a refresh (live official page, or dated 2023+)", async () => {
  const { files } = setup(
    [
      entry("h-nodate", "heuristic", ["v2", "nod1"], ["captions"]),
      entry("gp-undated", "store_fact", ["gnd"], ["screenshots"], { ruleClass: "store_behaviour" }),
    ],
    [
      {
        ...SOURCES[4],
        id: "nod1",
        url: "https://blog.example/x",
        published: "unknown",
        evidenceOrigin: "n",
      },
      { ...SOURCES[0], id: "gnd", url: `${GP_ASSETS}0`, published: "unknown" },
    ],
  );
  const r = await refreshOfficial(files, TODAY, {
    fetcher: fakeFetcher({
      "https://blog.example/x": page(
        '<meta property="article:modified_time" content="2024-03-02T10:00:00Z"> © 2019',
      ),
    }).f,
    delayMs: 0,
  });
  assert.equal(r.undated, 2);
  assert.equal(r.undatedKept, 2);
  const kb = loadKb(files, "inbox", TODAY);
  assert.equal(kb.computed.get("h-nodate")?.trust, "corroborated");
  assert.equal(kb.computed.get("gp-undated")?.trust, "official");
});

test("page dates and quotes: markup, entities and ellipses do not matter; footers do not date", () => {
  assert.equal(
    pageDate(
      '<script type="application/ld+json">{"datePublished":"2023-05-01","dateModified":"2025-01-09"}</script>',
    ),
    "2025-01-09",
  );
  assert.equal(pageDate('<time datetime="2022-02-02">x</time>'), "2022-02-02");
  assert.equal(pageDate("<footer>© 2025 Example</footer>"), "");
  const norm =
    "customersshouldknowwhattheyregettingwhentheydownloadtheappscreenshotsandpreviewsaccuratelyreflect";
  assert.ok(
    quoteOnPage(
      norm,
      "Customers should know what they’re getting ... screenshots, and previews accurately reflect",
    ),
  );
  assert.ok(!quoteOnPage(norm, "Screenshots must show gameplay only."));
});

test("the review page script compiles", () => {
  assert.doesNotThrow(() => new Script(KB_REVIEW_SCRIPT));
});

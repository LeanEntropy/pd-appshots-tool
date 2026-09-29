import assert from "node:assert/strict";
import { test } from "node:test";
import { EntrySchema } from "../src/kb/schema.ts";
import { canDrive, computeOne, platformOf } from "../src/kb/trust.ts";
import { entry, fixtureKb, SOURCES, TODAY } from "./helpers/kb.ts";

const sources = new Map(SOURCES.map((s) => [s.id, s]));
const trustOf = (support: string[], kind = "heuristic", over = {}) =>
  computeOne(entry("x-1", kind, support, ["captions"], over), sources, TODAY);

test("trust is counted from independent origins: 1 unverified, 2 corroborated, 3 with data established", () => {
  assert.equal(trustOf(["v1"]).trust, "unverified");
  assert.equal(trustOf(["v1", "d1"]).trust, "corroborated");
  assert.equal(trustOf(["v1", "v2", "d1"]).trust, "established");
  assert.equal(trustOf(["v1", "v2", "d1"]).origins, 3);
});

test("independence groups: same origin, parent organisation, sponsor and unknown provenance count once", () => {
  // d2 repeats the SplitMetrics study.
  assert.equal(trustOf(["v1", "d2"]).origins, 1);
  // data.ai's parent is Sensor Tower.
  assert.equal(trustOf(["d1", "p1"]).origins, 1);
  // A study commissioned by AppTweak counts with AppTweak.
  assert.equal(trustOf(["v2", "c1"]).origins, 1);
  // All unknown provenance together counts once.
  assert.equal(trustOf(["u1", "u2"]).origins, 1);
  assert.equal(trustOf(["u1", "u2", "v1"]).trust, "corroborated");
});

test("a page that was not read, or a snippet-only support record, does not count", () => {
  assert.equal(trustOf(["v1", "s1"]).origins, 1);
  const e = EntrySchema.parse({
    ...entry("x-2", "heuristic", ["v1", "d1"], ["captions"]),
    support: [
      { sourceId: "v1", excerpt: "x", excerptType: "quote", fetched: true },
      { sourceId: "d1", excerpt: "y", excerptType: "quote", fetched: false },
    ],
  });
  assert.equal(computeOne(e, sources, TODAY).trust, "unverified");
});

test("vendor-only evidence never reaches established; A/B cases stay single cases", () => {
  const v = trustOf(["v1", "v2", "v3"]);
  assert.equal(v.trust, "corroborated");
  assert.equal(v.vendorOnly, true);
  assert.equal(trustOf(["v1", "d1", "jp1"], "ab_case").trust, "unverified");
});

test("D1: an official platform page makes a store fact official; the same page does not make a heuristic trusted", () => {
  const kb = fixtureKb();
  assert.equal(kb.computed.get("gp-enf-1")?.trust, "official");
  assert.equal(kb.computed.get("gp-guid-1")?.trust, "official");
  assert.equal(trustOf(["g1"]).trust, "unverified");
  // A store fact without an official rule class is counted like any claim.
  assert.equal(trustOf(["g1"], "store_fact").trust, "unverified");
  // An App Store claim needs Apple's page, not Google's.
  const as = entry("x-3", "store_fact", ["g1"], ["captions"], {
    ruleClass: "store_behaviour",
    scope: {
      store: ["app_store"],
      genre: ["all_games"],
      countries: ["global"],
      position: ["all"],
      asset: [],
    },
  });
  assert.equal(computeOne(as, sources, TODAY).trust, "unverified");
  assert.equal(platformOf("https://support.google.com/googleplay/x"), "google_play");
  assert.equal(platformOf("https://developer.apple.com/app-store/"), "app_store");
  assert.equal(platformOf("https://google.com.evil.example/"), null);
});

test("a trusted counter-claim contests both sides; contested, unverified and stale store facts cannot drive", () => {
  const kb = fixtureKb();
  const c = (id: string) => kb.computed.get(id);
  assert.equal(c("h-corr")?.contested, true);
  assert.equal(c("h-counter")?.contested, true);
  const drives = (id: string) => {
    const e = kb.byId.get(id);
    const x = kb.computed.get(id);
    assert.ok(e && x);
    return canDrive(e, x);
  };
  assert.equal(drives("h-corr"), false);
  assert.equal(drives("h-unv"), false);
  assert.equal(drives("h-est"), true);
  const stale = computeOne(
    entry("x-4", "store_fact", ["g1"], ["captions"], {
      ruleClass: "store_behaviour",
      reviewBy: "2026-01-01",
    }),
    sources,
    TODAY,
  );
  assert.equal(stale.stale, true);
  assert.equal(stale.trust, "official", "freshness is separate from trust");
  assert.equal(canDrive(entry("x-4", "store_fact", ["g1"], ["captions"]), stale), false);
});

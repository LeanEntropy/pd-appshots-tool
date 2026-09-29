import assert from "node:assert/strict";
import { test } from "node:test";
import { type Candidate, emptyAppStore, type Match } from "../src/appstore/data.ts";
import { confirmGame } from "../src/server/routes-appstore.ts";
import {
  APPSTORE_PANEL_SCRIPT,
  APPSTORE_SETTINGS_SCRIPT,
  appStoreBoxHtml,
  storeMarkHtml,
} from "../src/view/appstore-ui.ts";

const NOW = "2026-09-29T00:00:00.000Z";
const cand = (trackId: number): Candidate => ({
  trackId,
  bundleId: `b${trackId}`,
  trackName: `App ${trackId}`,
  sellerName: "Seller",
  iconUrl: "",
  firstScreenshot: "",
  signals: ["same name"],
  sellerMatch: false,
});
const waiting = (...c: Candidate[]): Match => ({
  status: "needs_confirmation",
  confidence: "low",
  evidence: [],
  candidates: c,
  source: "search",
  checkedAt: NOW,
});

function project() {
  const a = emptyAppStore(NOW);
  a.games.g = {
    byCountry: {
      us: waiting(cand(1), cand(2)),
      th: waiting(cand(3)),
      vn: { ...waiting(), status: "not_found", confidence: "none" },
    },
  };
  return a;
}

test("confirming a candidate matches it in every country where it was offered, and only there", () => {
  const a = project();
  assert.deepEqual(confirmGame(a, "g", 1, NOW), ["us"]);
  const us = a.games.g?.byCountry.us;
  assert.equal(us?.status, "matched");
  assert.equal(us?.trackId, 1);
  assert.equal(us?.source, "user");
  assert.equal(a.games.g?.byCountry.th?.status, "needs_confirmation");
  assert.deepEqual(confirmGame(a, "g", 1, NOW), {
    problem: "Nothing to confirm for this game. Reload the page.",
  });
});

test("'not on the App Store' is saved only where a match was waiting", () => {
  const a = project();
  assert.deepEqual(confirmGame(a, "g", null, NOW), ["us", "th"]);
  assert.equal(a.games.g?.byCountry.us?.status, "confirmed_none");
  assert.equal(a.games.g?.byCountry.vn?.status, "not_found");
  assert.ok("problem" in (confirmGame(a, "missing", null, NOW) as object));
});

test("store marks carry a text tooltip and escape it", () => {
  const m = storeMarkHtml("appstore", ['Japan"<x>']);
  assert.match(m, /title="App Store: Japan&#34;&#60;x&#62;"/);
  assert.match(storeMarkHtml("play", []), /title="Google Play"/);
  assert.match(appStoreBoxHtml("p", false), /id="appstoreOn" >/);
  assert.match(appStoreBoxHtml("p", true), /id="appstoreOn" checked>/);
});

test("the App Store page scripts parse", () => {
  assert.doesNotThrow(() => new Function(APPSTORE_PANEL_SCRIPT));
  assert.doesNotThrow(() => new Function(APPSTORE_SETTINGS_SCRIPT));
});

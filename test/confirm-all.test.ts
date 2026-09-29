import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { type LoadedConfig, projectPaths } from "../src/config/load.ts";
import { doubtfulInPlan, type MatchPair, readSamePairs } from "../src/reports/match-check.ts";
import { ensurePixelChecks } from "../src/reports/pixel-pairs.ts";
import { buildScopePlan } from "../src/reports/scope-plan.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { PAIR_GROUP_SCRIPT } from "../src/view/pair-group.ts";
import { REPORT_APPROVE_SCRIPT } from "../src/view/report-approve.ts";
import { headers, TOKEN } from "./helpers/builder.ts";
import { JP, setup } from "./helpers/pixel-setup.ts";

const plan = (l: LoadedConfig, capy: string) =>
  buildScopePlan(l, { type: "country", markets: [JP], competitors: [capy], includeCharts: [] });

test("confirm all: the block is saved in one request, and Undo opens the pairs again", async () => {
  const { loaded, capy, ids } = await setup();
  await ensurePixelChecks(loaded);
  const [a, b, c] = ids.jp as [string, string, string];
  const before = plan(loaded, capy);
  const block = doubtfulInPlan(loaded, before.items).filter((x) => x.group);
  assert.deepEqual(block.map((x) => x.image.id).sort(), [a, b].sort());
  const { server, origin } = await startAppServer({
    root: loaded.root,
    projects: [loaded],
    token: TOKEN,
  });
  try {
    const url = `${origin}/p/${projectPaths(loaded).projectId}/api/reports/match-check/pairs`;
    const post = (same: boolean | null, h: Record<string, string> = headers) =>
      fetch(url, {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          pairs: block.map((x) => ({ image: x.image.id, anchor: x.anchor.id, same })),
        }),
      });
    const noToken = { "Content-Type": "application/json" };
    assert.equal((await post(true, noToken)).status, 403, "a write needs the page's token");
    const r = await post(true);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { saved: 2 });
    assert.equal(readSamePairs(loaded).size, 2);
    const after = plan(loaded, capy);
    assert.equal(after.items.find((i) => i.imageId === b && i.gl === "jp")?.tier, "layer-diff");
    assert.deepEqual(
      doubtfulInPlan(loaded, after.items).map((x) => x.image.id),
      [c],
      "answered pairs are never asked again",
    );
    // Undo: the answers are removed, the plan is exactly as before.
    const u = await post(null);
    assert.equal(u.status, 200);
    assert.equal(readSamePairs(loaded).size, 0);
    assert.equal(plan(loaded, capy).planHash, before.planHash);
  } finally {
    server.close();
  }
});

type Handler = (e: unknown) => void;

function page() {
  const handlers: Handler[] = [];
  const calls: { url: string; body: { pairs: { same: boolean | null }[] } }[] = [];
  const refreshed: string[] = [];
  const toasts: string[] = [];
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    API: "/p/x/api",
    esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    money: (n: number) => `$${Number(n || 0).toFixed(2)}`,
    usdRange: (u: number[]) => `$${u[0]} to $${u[1]}`,
    countryOf: (l: string) => l,
    theCountryOf: (l: string) => l,
    document: { addEventListener: (_: string, h: Handler) => handlers.push(h) },
    send: async (url: string, body: (typeof calls)[number]["body"]) => {
      calls.push({ url, body });
      return { saved: body.pairs.length };
    },
    act: async (_b: unknown, o: { run: () => Promise<unknown>; done: string }) => {
      await o.run();
      toasts.push(o.done);
    },
  };
  runInNewContext(
    `${PAIR_GROUP_SCRIPT}\n${REPORT_APPROVE_SCRIPT}\nthis.reportApprovalHtml = reportApprovalHtml; showReportApproval = async (id) => { this.refreshed.push(id); };`,
    Object.assign(ctx, { refreshed }),
  );
  const click = async (dataset: Record<string, string>, cls: string) => {
    const btn = { dataset, classList: { contains: (c: string) => c === cls }, id: "" };
    for (const h of handlers) h({ target: { closest: () => btn } });
    await new Promise((r) => setTimeout(r, 0));
  };
  const html = ctx.reportApprovalHtml as (r: unknown) => string;
  return { html, click, calls, refreshed, toasts };
}

const pair = (n: number, group?: MatchPair["group"]): MatchPair => ({
  game: "Capybara Go",
  country: "Japan",
  position: n,
  image: { id: `i${n}`, thumb: `t/i${n}.webp` },
  anchor: { id: `a${n}`, thumb: `t/a${n}.webp`, position: 0 },
  bits: 5,
  treatedAs: "same",
  userSaid: null,
  pixel: {
    verdict: group ? "same-new-text" : "different",
    changed: 0.1,
    inside: 0.09,
    outside: group ? 0 : 0.2,
    areas: [{ x: 10, y: 4, w: 60, h: 6 }],
  },
  ...(group ? { group } : {}),
});

const approval = (doubtful: MatchPair[]) => ({
  id: "r-1",
  name: "Japan",
  doubtful,
  plan: {
    items: [
      { tier: "full", name: "Capybara Go", country: "Japan", position: 5, thumb: null, reason: "" },
    ],
    counts: { full: 1, layerDiff: 2, identical: 0 },
    images: { passes: [] },
    text: { parts: [] },
    usd: [1, 2],
    limitUsd: 30,
    overLimit: false,
  },
});

test("confirm all view: one compact block, one click, undo, the rest one by one", async () => {
  const p = page();
  const grouped = [pair(1, "same-new-text"), pair(2, "same-new-text"), pair(3, "moved")];
  const html = p.html(approval([...grouped, pair(4)]));
  assert.match(html, /3 pairs look like the same picture with new text/);
  assert.match(html, /Confirm all 3 as same/);
  assert.match(html, /<summary>Review one by one<\/summary>/);
  assert.match(html, /1 of them would otherwise get a full analysis/);
  assert.match(html, /class="pstrip"/);
  assert.match(html, /class="parea" style="left:10%;top:4%;width:60%;height:6%"/);
  assert.match(html, /Then 1 doubtful picture match/);
  assert.match(html, /20% of the picture changed outside the text and band/);
  assert.match(html, /id="approveReport" class="primary" disabled/);
  assert.doesNotMatch(html, /same-new-text|layer-diff|pixel-check/, "no internal codes");

  await p.click({ ctx: "r:r-1" }, "pg-all");
  assert.equal(p.calls.length, 1, "one request for the whole block");
  assert.equal(p.calls[0]?.url, "/p/x/api/reports/match-check/pairs");
  assert.deepEqual(
    Array.from(p.calls[0]?.body.pairs ?? [], (x) => x.same),
    [true, true, true],
  );
  assert.deepEqual(p.refreshed, ["r-1"]);
  assert.match(String(p.toasts[0]), /Saved: 3 pairs confirmed as the same picture/);

  // The server no longer lists the answered pairs; the page shows them as saved, with Undo.
  const after = p.html(approval([pair(4)]));
  assert.match(after, /Saved: <strong>3 pairs<\/strong> confirmed as the same picture/);
  assert.match(after, /class="pg-undo"/);
  assert.match(after, /Change to different screens/);
  assert.doesNotMatch(after, /Confirm all/);
  assert.match(after, /disabled/, "the one-by-one pair still waits");
  assert.doesNotMatch(p.html(approval([])), /id="approveReport" class="primary" disabled/);

  // Change one pair, then Undo all.
  await p.click({ ctx: "r:r-1", key: "i1|a1", same: "false" }, "pg-one");
  assert.equal(
    JSON.stringify(p.calls[1]?.body.pairs),
    JSON.stringify([{ image: "i1", anchor: "a1", same: false }]),
  );
  assert.match(
    p.html(approval([])),
    /2 pairs<\/strong> confirmed as the same picture, 1 marked as different/,
  );
  await p.click({ ctx: "r:r-1" }, "pg-undo");
  assert.deepEqual(
    Array.from(p.calls[2]?.body.pairs ?? [], (x) => x.same),
    [null, null, null],
  );
  assert.match(String(p.toasts.at(-1)), /Undone: 3 pairs are open again/);
  assert.match(p.html(approval(grouped)), /Confirm all 3 as same/, "the block is back");
});

test("confirm all view: automatic mode lists the decided pairs folded, never blocking", () => {
  const html = page().html(approval([pair(1, "decided"), pair(2, "decided")]));
  assert.match(html, /Decided by the pixel check: 2 pairs/);
  assert.doesNotMatch(html, /Confirm all/);
  assert.doesNotMatch(html, /disabled/);
});

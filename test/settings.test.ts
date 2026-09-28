import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { approvalProblem } from "../src/analysis/job.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { settingsOf } from "../src/settings/access.ts";
import { type FieldView, madeByAnotherProject, settingsServer } from "./helpers/settings.ts";

/** A valid value different from the current one, per kind of field. */
const NUMBERS: Record<string, number> = {
  "core.stability.minDecks": 6,
  "core.stability.window": 3,
  "core.stability.maxShareShift": 0.15,
  "budget.maxUsdPerIncrement": 25,
  "options.spending.maxUsdPerReport": 40,
  "core.imageTarget": 80,
  "core.imageCap": 95,
  "options.suggestions.reuseShare": 0.85,
  "options.suggestions.splitLow": 0.35,
  "options.suggestions.splitHigh": 0.65,
  "options.suggestions.weakN": 5,
  "options.suggestions.staleDays": 45,
};
function another(f: FieldView): unknown {
  if (f.kind === "switch") return !f.value;
  if (f.choices) return f.choices.find((c) => c.value !== f.value)?.value;
  const n = NUMBERS[f.id];
  assert.ok(n !== undefined, `no test value for ${f.id}`);
  return n;
}

test("settings: every field saves, reloads, and goes back to the default", async () => {
  const s = await settingsServer();
  try {
    const before = await s.view();
    assert.ok(before.fields.length >= 30);
    // The imported fixture has the screenshot second opinion on; everything else is default.
    assert.deepEqual(
      before.fields.filter((f) => f.changed).map((f) => f.id),
      ["review.screenshotAnalysis"],
    );
    const wanted = new Map<string, unknown>();
    for (const f of before.fields) {
      const v = another(f);
      const r = await s.post({ field: f.id, value: v, confirm: true });
      assert.equal(r.status, 200, `${f.id}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.saved, true);
      wanted.set(f.id, v);
    }
    const after = await s.view();
    for (const f of after.fields) {
      assert.deepEqual(f.value, wanted.get(f.id), f.id);
      assert.equal(f.changed, JSON.stringify(f.value) !== JSON.stringify(f.defaultValue), f.id);
    }
    // The pipeline reads them through the one accessor.
    const t = settingsOf(s.project().config);
    assert.equal(t.mainMarket.gl, wanted.get("mainCountry"));
    assert.equal(t.spending.perReportUsd, 40);
    assert.equal(t.steps.countryAdvice.secondOpinion, false);
    assert.equal(t.steps.screenshotAnalysis.secondOpinion, false);
    assert.equal(t.pdf.paper, "Letter");
    assert.equal(t.traffic("jp"), wanted.get("traffic.jp"));
    for (const f of after.fields) {
      const r = await s.post({ field: f.id, reset: true, confirm: true });
      assert.equal(r.status, 200, `${f.id}: ${JSON.stringify(r.body)}`);
    }
    const back = await s.view();
    assert.deepEqual(
      back.fields.map((f) => f.value),
      before.fields.map((f) => f.defaultValue),
    );
    assert.ok(back.fields.every((f) => !f.changed));
    const saved = JSON.parse(readFileSync(s.settingsFile, "utf8"));
    assert.equal(saved.overrides.options, undefined, "no options left");
    assert.equal(saved.overrides.core, undefined, "no core values left");
  } finally {
    s.server.close();
  }
});

test("settings: refused values keep the old value and say why", async () => {
  const s = await settingsServer();
  try {
    const file = readFileSync(s.settingsFile, "utf8");
    const cases: [string, unknown, RegExp][] = [
      ["reviewer.screenshots", "codex:gpt-6-astra", /Astra is kept for special/],
      ["reviewer.text", "claude:claude-opus-5-5", /other model family/],
      ["model.screenshotAnalysis", "claude:claude-sonnet-5", /Sonnet is not used to read/],
      ["model.recommendations", "claude:claude-haiku-4-5", /Haiku is not used/],
      ["model.recommendations", "claude:claude-opus-9", /not one of the choices/],
      ["core.imageTarget", 150, /aim cannot be above the hard stop/],
      ["options.suggestions.splitLow", 0.7, /lower end of a split vote/],
      ["core.stability.minDecks", 0, /too small/],
      ["options.pdf.images", "yes", /choose on or off/],
      ["core.workspace", "x", /does not know/],
    ];
    for (const [field, value, reason] of cases) {
      const r = await s.post({ field, value, confirm: true });
      assert.equal(r.status, 400, field);
      assert.match(r.body.problems?.[0] ?? "", reason, field);
    }
    assert.equal(readFileSync(s.settingsFile, "utf8"), file, "nothing was written");
    assert.equal((await s.field("reviewer.screenshots"))?.value, "codex:gpt-5.6-sol");
    // A text step's model may be GPT only while its second opinion (GPT) is off.
    const off = await s.post({ field: "review.countryAdvice", value: false });
    assert.equal(off.status, 200);
    const gpt = await s.post({ field: "model.countryAdvice", value: "claude:claude-sonnet-5" });
    assert.equal(gpt.status, 200, "Sonnet is fine for text steps");
    const bad = await s.post({ field: "reviewer.text", value: "codex:gpt-6-astra" });
    assert.equal(bad.status, 400);
  } finally {
    s.server.close();
  }
});

test("settings: a new screenshot model shows the images analysed again and their cost first", async () => {
  const s = await settingsServer();
  try {
    assert.ok(madeByAnotherProject(s.root, s.id) >= 8);
    const file = readFileSync(s.settingsFile, "utf8");
    const r = await s.post({ field: "model.screenshotAnalysis", value: "claude:claude-opus-5-5" });
    assert.equal(r.status, 200);
    assert.equal(r.body.needsConfirm, true);
    const c = r.body.consequences?.[0];
    assert.equal(c?.images, 8, "the 8 shared pilot images would be analysed again");
    assert.ok((c?.usd?.[0] ?? 0) > 0);
    assert.match(c?.text ?? "", /not reused: 8 images would be analysed again \(about \$/);
    assert.equal(readFileSync(s.settingsFile, "utf8"), file, "not saved before the answer");
    const off = await s.post({ field: "review.screenshotAnalysis", value: false });
    assert.equal(off.body.consequences?.[0]?.images, 8);
    assert.equal(
      (await s.post({ field: "review.screenshotAnalysis", value: false, confirm: true })).body
        .saved,
      true,
    );
    const on = await s.post({ field: "review.screenshotAnalysis", value: true });
    assert.equal(on.body.consequences?.length, 1, "switching back reuses the shared analyses");
    assert.match(
      on.body.consequences?.[0]?.text ?? "",
      /second opinion on screenshot analysis by gpt-5\.6-sol costs about \$0\.15 to \$0\.25 per image/,
    );
    const text = await s.post({ field: "review.patterns", value: true });
    assert.match(
      text.body.consequences?.[0]?.text ?? "",
      /per use\. It is part of the next approval/,
    );
    const main = await s.post({ field: "mainCountry", value: "jp" });
    assert.match(
      main.body.consequences?.[0]?.text ?? "",
      /for Japan from now on\. Your United States/,
    );
    assert.match(
      main.body.consequences?.[0]?.text ?? "",
      /must be downloaded/,
      "no Japan decks yet",
    );
    // Free changes save at once.
    const free = await s.post({ field: "options.pdf.paper", value: "Letter" });
    assert.equal(free.body.saved, true);
  } finally {
    s.server.close();
  }
});

test("settings: a saved change refuses an approval shown before it", async () => {
  const s = await settingsServer();
  try {
    // This project's own analyses stay usable after a model change: nothing to confirm.
    const model = await s.post({
      field: "model.screenshotAnalysis",
      value: "claude:claude-opus-5-5",
    });
    assert.equal(model.body.saved, true);
    const shown = buildAnalysisPlan(s.project(), "core", { save: true });
    const r = await s.post({ field: "budget.maxUsdPerIncrement", value: 20 });
    assert.equal(r.status, 200);
    const now = buildAnalysisPlan(s.project(), "core");
    assert.match(approvalProblem(shown, now, shown.planHash) ?? "", /changed since the approval/);
  } finally {
    s.server.close();
  }
});

test("settings: the page and the Settings link", async () => {
  const s = await settingsServer();
  try {
    const page = await (await fetch(`${s.origin}/p/${s.id}/settings`)).text();
    assert.match(page, /<h1>Settings<\/h1>/);
    assert.match(page, /id="settingsData"/);
    assert.match(page, /set-token/);
    assert.doesNotMatch(page, /<\/script><script/i, "data is escaped");
    const gallery = await (await fetch(`${s.origin}/p/${s.id}/views/gallery.html`)).text();
    assert.ok(gallery.includes(`href="/p/${s.id}/settings"`));
    const noToken = await fetch(s.api, { method: "POST", body: "{}" });
    assert.equal(noToken.status, 403);
  } finally {
    s.server.close();
  }
});

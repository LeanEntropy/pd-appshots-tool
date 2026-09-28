import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runImport } from "../src/library/import/run-import.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { ACTION_SCRIPT } from "../src/view/action.ts";
import { GALLERY_SCRIPT } from "../src/view/gallery-script.ts";
import { HOME_SCRIPT } from "../src/view/home-script.ts";
import { fakeDom } from "./helpers/fake-dom.ts";
import { legacyProject } from "./helpers/imported.ts";

const VIEW = join(import.meta.dirname, "..", "src", "view");
const views = readdirSync(VIEW)
  .filter((f) => f.endsWith(".ts") && f !== "action.ts")
  .map((f) => ({ f, text: readFileSync(join(VIEW, f), "utf8") }));

test("every page script carries the feedback helper; no page posts or alerts on its own", () => {
  assert.ok(HOME_SCRIPT.startsWith(ACTION_SCRIPT));
  assert.ok(GALLERY_SCRIPT.startsWith(ACTION_SCRIPT));
  for (const { f, text } of views) {
    assert.doesNotMatch(text, /method:\s*"POST"/, `${f} posts without the helper (use send)`);
    assert.doesNotMatch(text, /\balert\(/, `${f} uses alert() instead of an on-page message`);
    assert.doesNotMatch(text, /\.disabled = true/, `${f} sets a busy state by hand (use act)`);
  }
});

// Every control that starts an async action, and the line that must hand it to the helper.
const CONTROLS: [string, RegExp][] = [
  ["Import it", /if \(t\.dataset\.import\) importing\(/],
  ["Show what will happen", /if \(t\.dataset\.dry\) \{\s*const id = t\.dataset\.dry;\s*act\(t,/],
  ["Archive / Show again", /if \(t\.dataset\.archive\) \{[\s\S]{0,300}?\n\s*act\(t,/],
  ["Start analysis", /id === "startAnalysis"\) openApproval\(/],
  ["Continue", /id === "continueRun"[^\n]*openApproval\(/],
  [
    "Open the approval (report)",
    /closest\("button\.reportApprove"\)[\s\S]{0,400}?openApproval\(ap,/,
  ],
  ["Rename (report)", /function saveName\(btn, rid\) \{[\s\S]{0,300}?\n\s*act\(btn,/],
  ["Archive / Restore (report)", /contains\("rc-archive"\)\) \{[\s\S]{0,200}?\n\s*act\(b,/],
  ["Delete (report)", /contains\("rc-delete"\)\) \{[\s\S]{0,400}?\n\s*act\(b,/],
  ["Approve and run", /id === "approve"\)\s*act\(/],
  ["Build / Rebuild the overview", /id === "rebuildOverview"\)\s*act\(/],
  ["Stop", /if \(stop\)\s*act\(/],
];

test("every button that starts work goes through act()", () => {
  const all = views.map((v) => v.text).join("\n");
  for (const [name, re] of CONTROLS) assert.match(all, re, `${name} is not wired through act()`);
  assert.match(all, /function openApproval\(btn, cont\) \{\s*return act\(/);
  assert.match(all, /function importing\(id, name, btn\) \{\s*return act\(/);
});

test("act(): busy at once, double clicks ignored, success message, button restored", async () => {
  const dom = fakeDom();
  const { act, btn, line } = dom.run(ACTION_SCRIPT);
  let release: () => void = () => {};
  let runs = 0;
  const o = {
    busy: "Importing... this takes about a minute",
    status: line,
    run: (progress: (t: string, d: number, n: number) => void) => {
      runs++;
      progress("Linking images", 800, 1418);
      return new Promise<string>((r) => {
        release = () => r("ok");
      });
    },
    done: "Imported.",
  };
  const first = act(btn, o);
  assert.equal(btn.disabled, true);
  assert.equal(btn.getAttribute("aria-busy"), "true");
  assert.match(btn.innerHTML, /act-spin.*Importing\.\.\. this takes about a minute/);
  assert.match(line.innerHTML, /Linking images: 800 \/ 1,418/);
  assert.equal(await act(btn, o), undefined, "a second click while busy does nothing");
  assert.equal(runs, 1);
  release();
  assert.equal(await first, "ok");
  assert.equal(btn.disabled, false);
  assert.equal(btn.innerHTML, "Import it");
  assert.equal(line.className, "act-msg ok");
  assert.equal(dom.toasts().at(-1)?.text, "Imported.");
});

test("act(): a failure shows the server's reason in red and frees the button", async () => {
  const dom = fakeDom();
  const { act, send, btn, line } = dom.run(ACTION_SCRIPT);
  dom.respond(409, { problems: ["An import is running already."] });
  const r = await act(btn, {
    busy: "Importing...",
    status: line,
    run: () => send("/api/import", {}),
  });
  assert.equal(r, undefined);
  assert.equal(line.className, "act-msg bad");
  assert.match(line.innerHTML, /An import is running already\./);
  assert.equal(dom.toasts().at(-1)?.kind, "bad");
  assert.equal(btn.disabled, false);
  dom.offline();
  await act(btn, { busy: "Archiving...", status: line, run: () => send("/x", {}) });
  assert.match(line.innerHTML, /The tool did not answer\. Is npm start still running/);
});

test("spinners: no bare span is inserted without a phase-synced delay", () => {
  // Every place a spinner is inserted goes through spinHtml()/ACT_SPIN() (a computed negative
  // animation-delay), never a hand-written <span class="spin">/<span class="act-spin">. A bare
  // span restarts its CSS animation from 0deg whenever the surrounding innerHTML is rebuilt on the
  // next progress poll, which is what made the run panel's spinner visibly jump backward every
  // ~1.5 rotations (a 1.5s poll fighting a 1s animation).
  for (const { f, text } of views) {
    assert.doesNotMatch(
      text,
      /<span class="(act-)?spin"[^>]*aria-hidden/,
      `${f} inserts a spinner without going through spinHtml()/ACT_SPIN()`,
    );
  }
});

test("spin keyframes: a full turn, linear pace, forever, wherever a spinner is styled", () => {
  const files = readdirSync(VIEW).filter((f) => f.endsWith(".ts"));
  let keyframesSeen = 0;
  for (const f of files) {
    const text = readFileSync(join(VIEW, f), "utf8");
    for (const block of text.match(
      /@keyframes [\w-]+ \{ to \{ transform: rotate\([^)]*\); \} \}/g,
    ) || []) {
      keyframesSeen++;
      assert.match(block, /rotate\(360deg\)/, `${f}: ${block} is not a full 360deg turn`);
    }
    for (const anim of text.match(/animation:\s*[\w-]+\s+[\d.]+s\s+\w+\s+\w+/g) || []) {
      assert.match(anim, /\blinear\s+infinite\b/, `${f}: "${anim}" is not linear and infinite`);
      // spinHtml()'s phase-sync math (action.ts) hard-codes a 1000ms cycle: any spin animation
      // with a different duration would fall out of phase and the old jump would reappear.
      assert.match(
        anim,
        /\s1s\s/,
        `${f}: "${anim}" must run for exactly 1s to match spinHtml()'s cycle`,
      );
    }
  }
  assert.ok(keyframesSeen >= 2, "expected spin keyframes in at least action.ts and one page's CSS");
});

test("spinHtml(): a freshly rendered spinner is phase-synced to the clock, not restarted at 0deg", () => {
  const dom = fakeDom();
  const { spinHtml } = dom.run(ACTION_SCRIPT);
  const delayOf = (html: string) => {
    const m = html.match(/animation-delay:\s*(-?[\d.]+)s/);
    assert.ok(m, `no animation-delay in ${html}`);
    return Number(m?.[1]);
  };
  // A driven fake clock (not a real setTimeout wait) keeps this exact and non-flaky.
  dom.setClockMs(200);
  assert.equal(delayOf(spinHtml("spin")), -0.2, "0.2s into the cycle: -0.2s delay");
  dom.setClockMs(200 + 120);
  // A spinner recreated 120ms later lands 120ms further into the (negative) cycle, so it picks up
  // at the same angle a spinner that had kept spinning the whole time would be at - instead of
  // every recreation restarting the rotation from 0deg.
  assert.equal(delayOf(spinHtml("spin")), -0.32);
  // Crossing a 1s cycle boundary wraps, instead of drifting to -1s and beyond.
  dom.setClockMs(2950);
  assert.equal(delayOf(spinHtml("spin")), -0.95);
});

test("the import reports live steps with counts", async () => {
  const { loaded, root } = await legacyProject();
  const seen: { step: string; done?: number; total?: number }[] = [];
  const r = await runImport({
    root,
    configPath: loaded.path,
    apply: true,
    verifyHashes: true,
    progress: (step, done, total) => seen.push({ step, done, total }),
  });
  assert.equal(r.status, "imported");
  const steps = [...new Set(seen.map((s) => s.step))];
  for (const s of [
    /^Reading/,
    /^Linking images/,
    /^Checking every image/,
    /^Checking that nothing/,
  ])
    assert.ok(
      steps.some((x) => s.test(x)),
      `missing step ${s}: ${steps.join(" | ")}`,
    );
  const link = seen.filter((s) => s.step.startsWith("Linking")).at(-1);
  assert.ok(link?.total && link.done === link.total, "linking ends at its total");
});

test("POST /api/import answers at once; GET shows the running step, then done", async () => {
  const { loaded, root } = await legacyProject();
  const { server, origin } = await startAppServer({ root, token: "t" });
  try {
    const id = loaded.config.project;
    const go = await fetch(`${origin}/api/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SSR-Token": "t" },
      body: JSON.stringify({ id }),
    });
    assert.equal(go.status, 202);
    const started = (await go.json()) as { importing: { state: string; progress: unknown } };
    assert.equal(started.importing.state, "running");
    assert.ok(started.importing.progress, "the first answer already carries a step");
    type Imp = { state: string; name: string; progress: unknown } | null;
    let imp: Imp = null;
    for (let i = 0; i < 300; i++) {
      imp = ((await (await fetch(`${origin}/api/import`)).json()) as { importing: Imp }).importing;
      if (imp?.state !== "running") break;
      await new Promise((res) => setTimeout(res, 50));
    }
    assert.equal(imp?.state, "done");
    assert.equal(imp?.name, loaded.config.ourApp.name);
    assert.equal(imp?.progress, null);
  } finally {
    server.close();
  }
});

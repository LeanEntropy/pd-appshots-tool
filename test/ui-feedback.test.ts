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
  ["Open the approval (report)", /id === "reportApprove"\)[^\n]*openApproval\(/],
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

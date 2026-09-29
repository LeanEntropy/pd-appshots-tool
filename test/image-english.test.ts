import assert from "node:assert/strict";
import { test } from "node:test";
import {
  englishProblems,
  englishScope,
  englishTask,
  startEnglish,
} from "../src/analysis/english-run.ts";
import { readEnglish, saveEnglish } from "../src/analysis/english-store.ts";
import { textRows } from "../src/analysis/image-texts.ts";
import type { Provider, VisionCall } from "../src/analysis/providers.ts";
import {
  type AnalysisRecord,
  isUsable,
  readRecords,
  writeRecord,
} from "../src/analysis/records.ts";
import { projectPaths } from "../src/config/load.ts";
import { loadProject } from "../src/config/project.ts";
import { libraryKey } from "../src/storage/index.ts";
import { sender } from "./helpers/share.ts";

/** A library project whose first analysed picture carries a Japanese headline and a badge. */
async function japaneseProject() {
  const s = await sender();
  const loaded = loadProject(s.id, { root: s.root });
  const paths = projectPaths(loaded);
  const r = [...readRecords(paths).values()].find(isUsable) as AnalysisRecord & {
    final: NonNullable<AnalysisRecord["final"]>;
  };
  const head = r.final.marketingLayer.texts[0];
  assert.ok(head);
  r.final.marketingLayer.texts = [
    { ...head, text: "ボスを 全部倒せ", language: "ja" },
    { ...head, role: "badge", text: "NEW", language: "en" },
    { ...head, role: "label", text: "限定", language: "ja" },
  ];
  writeRecord(paths, r);
  return { ...s, loaded, paths, r };
}

/** Answers the English step's prompt without any model: "EN:" + the text. */
function fakeTranslator(): Provider & { calls: VisionCall[] } {
  const calls: VisionCall[] = [];
  return {
    family: "anthropic",
    model: "fake-small",
    calls,
    async call(c) {
      calls.push(c);
      const items = [...c.prompt.matchAll(/^(\d+)\. \[[^\]]+\] (.*)$/gm)].map((m) => ({
        n: Number(m[1]),
        english: `EN: ${m[2]}`,
      }));
      return { ok: true, output: { items }, costUsd: 0.01, error: null };
    },
  };
}

test("texts: original kept exactly; English from the original, the layer comparison or the English step", async () => {
  const t = await japaneseProject();
  const rows = () => textRows(t.paths, t.storage, t.r, null);
  let x = rows();
  assert.deepEqual(
    x.map((r) => [r.role, r.text, r.from]),
    [
      ["Headline", "ボスを 全部倒せ", ""],
      ["Badge", "NEW", "original"],
      ["Label", "限定", ""],
    ],
  );
  // A saved layer comparison's back-translation.
  t.storage.putJson(libraryKey("layer-diff", t.r.imageId, "k1.json"), {
    status: "ok",
    updatedAt: "2026-09-29T00:00:00Z",
    diff: { texts: [{ localText: "ボスを 全部倒せ", backTranslation: "Defeat all the bosses" }] },
  });
  // The English step's saved answer (by exact text and language).
  saveEnglish(t.storage, { text: "限定", language: "ja", english: "Limited", model: "m", at: "x" });
  x = rows();
  assert.equal(x[0]?.english, "Defeat all the bosses");
  assert.equal(x[0]?.from, "layer comparison");
  assert.equal(x[2]?.english, "Limited");
  assert.equal(x[2]?.from, "English step");
  assert.equal(readEnglish(t.storage, "限定", "ko"), null, "another language is another text");
});

test("English step: count and cost first, approval of the exact list, answers saved once per text", async () => {
  const t = await japaneseProject();
  const scope = englishScope(t.loaded);
  assert.equal(scope.items.length, 2);
  assert.equal(scope.calls, 1);
  assert.ok(scope.usd[0] > 0 && scope.usd[1] >= scope.usd[0]);
  assert.match(englishTask(scope.items), /1\. \[ja\] /);
  assert.deepEqual(englishProblems({ items: [{ n: 1, english: "x" }] }, 2), ["text 2 is missing"]);
  assert.ok(englishProblems({ items: [{ n: 3, english: "x" }] }, 1).length > 1);
  const fake = fakeTranslator();
  const stale = startEnglish(t.loaded, "0".repeat(64), () => fake);
  assert.equal(stale.ok, false);
  assert.equal(fake.calls.length, 0, "nothing is sent without the approved list");
  const run = startEnglish(t.loaded, scope.scopeHash, () => fake);
  assert.ok(run.ok);
  const p = await run.done;
  assert.equal(p.state, "finished");
  assert.equal(p.saved, 2);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0]?.images, [], "text only, never a picture");
  assert.equal(readEnglish(t.storage, "限定", "ja"), "EN: 限定");
  // Everything has English now: nothing left to pay for.
  assert.equal(englishScope(t.loaded).items.length, 0);
});

test("English step API: the Analysis page's card reads the count; a stale approval is refused", async () => {
  const t = await japaneseProject();
  const { startAppServer } = await import("../src/server/app-server.ts");
  const srv = await startAppServer({ root: t.root, token: "tok" });
  try {
    const g = await fetch(`${srv.origin}/p/${t.id}/api/english`);
    const body = (await g.json()) as { scope: { texts: number; usd: number[] } };
    assert.equal(body.scope.texts, 2);
    const post = await fetch(`${srv.origin}/p/${t.id}/api/english`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SSR-Token": "tok" },
      body: JSON.stringify({ scopeHash: "f".repeat(64) }),
    });
    assert.equal(post.status, 409);
  } finally {
    srv.server.close();
  }
});

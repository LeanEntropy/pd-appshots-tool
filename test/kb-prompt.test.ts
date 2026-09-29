import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import type { CallContext } from "../src/analysis/call.ts";
import type { Provider, VisionCall } from "../src/analysis/providers.ts";
import { textStep } from "../src/analysis/synthesis.ts";
import { openKbRun } from "../src/kb/open.ts";
import { snapshotKey } from "../src/kb/release.ts";
import { kbPart, marksOf } from "../src/kb/synthesis-kb.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { kbFiles } from "../src/storage/kb-files.ts";
import { content, fixtureKb, run } from "./helpers/kb.ts";
import { baseConfig } from "./helpers/kb-config.ts";

const BASE = { text: "BASE PROMPT", hash: "h0", file: "" };
const writeTextFile = (p: string, t: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, t);
};
const TASK = { now: "DATA\n\nWrite it.", before: "Write it.\n\nDATA" };
const Answer = z.strictObject({
  items: z.array(z.strictObject({ n: z.number(), headline: z.string() })),
});
type A = z.infer<typeof Answer>;
const opts = {
  facts: ["position-1"],
  items: (v: A) => v.items.map((i) => `position:${i.n}`),
  placed: (v: A) => ({
    texts: v.items.map((i) => ({ where: `position ${i.n}`, text: i.headline })),
    lengths: [{ where: "deck", n: v.items.length }],
  }),
};

test("prompt order: step prompt, rules block, core entries; per-call entries before the data", () => {
  const r = run(fixtureKb(), { market: "JP" });
  const k = kbPart({
    ...opts,
    step: "countryAdvice",
    run: r,
    system: BASE,
    task: TASK,
    schema: Answer,
    check: () => [],
  });
  assert.ok(!("blocked" in k));
  const sys = k.system.text;
  assert.ok(
    sys.startsWith("BASE PROMPT\n\nKB RULES BLOCK\n\nKnowledge base entries for this step:"),
  );
  assert.ok(!sys.includes("Claim of jp-note."), "country notes are not in the stable core");
  assert.ok(k.task.now.startsWith("Knowledge base entries for this call:"));
  assert.ok(k.task.now.indexOf("Claim of jp-note.") < k.task.now.indexOf("DATA"));
  assert.ok(k.task.now.endsWith(TASK.now));
  assert.ok(
    !/https?:\/\//.test(sys + k.task.now),
    "no links in the prompt: the model cites handles only",
  );
  assert.ok(!/Pub (g1|v1|d1)/.test(sys + k.task.now), "no source names in the prompt");
});

test("switch off: prompt, task, schema and check pass through unchanged", () => {
  const check = () => ["x"];
  const k = kbPart({
    ...opts,
    step: "recommend",
    run: undefined,
    system: BASE,
    task: TASK,
    schema: Answer,
    check,
  });
  assert.ok(!("blocked" in k));
  assert.equal(k.system, BASE);
  assert.equal(k.task, TASK);
  assert.equal(k.schema, Answer);
  assert.equal(k.check, check);
});

function recorder(outputs: (c: VisionCall) => unknown): Provider & { calls: VisionCall[] } {
  const calls: VisionCall[] = [];
  return {
    family: "anthropic",
    model: "fake",
    calls,
    async call(c) {
      calls.push(c);
      return { ok: true, output: outputs(c), costUsd: 0, error: null };
    },
  };
}

function ctx(kb?: ReturnType<typeof run>): CallContext {
  const storage = workspaceStorage(mkdtempSync(join(tmpdir(), "kbp-")));
  return {
    storage,
    answerKey: (step, key) => `shared/test/${step}/${key}.json`,
    taxonomy: { id: "t", version: "1", screenTypes: [], definitions: {}, subtypeLabels: {} },
    taxonomyHash: "t",
    maxBudgetUsd: 1,
    remainingUsd: () => 1,
    timeoutMs: 1000,
    onCost: () => {},
    ...(kb ? { kb } : {}),
  };
}

test("switch off: the model gets exactly today's system prompt, task and answer schema", async () => {
  const plain = recorder(() => ({ items: [{ n: 1, headline: "EPIC" }] }));
  await textStep("recommend", plain, BASE, TASK, Answer, () => [], ctx());
  const withOpts = recorder(() => ({ items: [{ n: 1, headline: "EPIC" }] }));
  await textStep("recommend", withOpts, BASE, TASK, Answer, () => [], ctx(), {
    ...opts,
    step: "recommend",
  });
  const [a, b] = [plain.calls[0], withOpts.calls[0]];
  assert.ok(a && b);
  assert.deepEqual(
    { s: b.system, p: b.prompt, j: b.schema },
    { s: a.system, p: a.prompt, j: a.schema },
  );
  assert.ok(!JSON.stringify(b.schema).includes('"kb"'));
});

test("openKbRun: nothing when the switch is off; on, the release is pinned in the shared library", () => {
  const root = mkdtempSync(join(tmpdir(), "kbroot-"));
  const files = kbFiles(root);
  const c = content();
  files.putJson("tags.json", { version: 1, tags: c.tags });
  files.putJson("dimension-tags.json", c.dimensionTags);
  files.putJson("checks.json", { checks: c.checks });
  files.putJson("sources.json", { sources: c.sources });
  files.putJson("entries/t.json", { file: "t", entries: c.entries });
  writeTextFile(join(root, "prompts", "analysis", "kb-rules.v1.md"), "RULES");
  const storage = workspaceStorage(mkdtempSync(join(tmpdir(), "ws-")));
  assert.equal(openKbRun(baseConfig(false), root, storage, "us"), undefined);
  const r = openKbRun(baseConfig(true), root, storage, "us");
  assert.ok(r);
  assert.equal(r.market, "US");
  assert.equal(r.rules, "RULES");
  assert.ok(storage.exists(snapshotKey(r.hash)), "an immutable snapshot of the release");
  assert.equal(r.capUsd, 0.5, "the $0.50 cap per report (D6)");
});

test("citations: only given handles; unverified entries only on test items; enforced rules never gone against", () => {
  const r = run(fixtureKb());
  const k = kbPart({
    ...opts,
    step: "recommend",
    run: r,
    system: BASE,
    task: TASK,
    schema: Answer,
    check: () => [],
  });
  assert.ok(!("blocked" in k));
  const picked = r.log.at(-1)?.picked ?? [];
  const handle = (id: string) => picked.find((p) => p.entry.id === id)?.handle ?? "";
  const est = handle("h-est");
  const enf = handle("gp-enf-1");
  const guid = handle("gp-guid-1");
  assert.ok(est && enf && guid, "the fixture selection holds these");
  const v = (kb: unknown) =>
    ({
      items: [
        { n: 1, headline: "EPIC" },
        { n: 2, headline: "RUN" },
      ],
      kb,
    }) as unknown as A;
  const probs = (kb: unknown) => k.check(v(kb));
  assert.deepEqual(
    probs({
      citations: [{ item: "position:1", handles: [est] }],
      againstGuidance: [],
      conflicts: [],
    }),
    [],
  );
  assert.match(
    probs({
      citations: [{ item: "position:1", handles: ["K99"] }],
      againstGuidance: [],
      conflicts: [],
    }).join(),
    /not given/,
  );
  assert.match(
    probs({
      citations: [],
      againstGuidance: [{ item: "position:1", handle: enf, reason: "r" }],
      conflicts: [],
    }).join(),
    /ENFORCED/,
  );
  assert.deepEqual(
    probs({
      citations: [],
      againstGuidance: [
        { item: "position:1", handle: guid, reason: "portrait converts better here" },
      ],
      conflicts: [],
    }),
    [],
  );
  const f = k.finish(
    v({
      citations: [{ item: "position:1", handles: [est] }],
      againstGuidance: [
        { item: "position:1", handle: guid, reason: "portrait converts better here" },
      ],
      conflicts: [],
    }),
  );
  assert.equal(
    (f.value as Record<string, unknown>).kb,
    undefined,
    "the kb field is removed from the answer",
  );
  const marks = marksOf(r, f.record);
  assert.ok(marks?.kbCites["position:1"]?.length);
  assert.match(
    marks?.kbNotes["position:1"]?.[0] ?? "",
    /goes against Google Play's own advice, which is not a rule/,
  );
});

test("enforced rules: a recommendation that breaks one is repaired, and rejected by code if it still breaks it", async () => {
  const r = run(fixtureKb());
  const bad = recorder(() => ({
    items: [
      { n: 1, headline: "DOWNLOAD NOW" },
      { n: 2, headline: "x" },
    ],
    kb: { citations: [], againstGuidance: [], conflicts: [] },
  }));
  const out = await textStep("recommend", bad, BASE, TASK, Answer, () => [], ctx(r), {
    ...opts,
    step: "recommend",
  });
  assert.equal(out.value, null);
  assert.match(out.problems.join(), /breaks an enforced store rule/);
  assert.equal(bad.calls.length, 3, "two repairs");
  const one = recorder(() => ({
    items: [{ n: 1, headline: "EPIC" }],
    kb: { citations: [], againstGuidance: [], conflicts: [] },
  }));
  const short = await textStep("recommend", one, BASE, TASK, Answer, () => [], ctx(r), {
    ...opts,
    step: "recommend",
  });
  assert.equal(short.value, null, "1 image is below Google Play's 2 to 8");
  const ok = recorder(() => ({
    items: [
      { n: 1, headline: "EPIC" },
      { n: 2, headline: "Try the best new roguelike" },
    ],
    kb: { citations: [], againstGuidance: [], conflicts: [] },
  }));
  assert.ok(
    (
      await textStep("recommend", ok, BASE, TASK, Answer, () => [], ctx(r), {
        ...opts,
        step: "recommend",
      })
    ).value,
  );
});

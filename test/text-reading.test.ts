import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analysisKey, currentPipeline } from "../src/analysis/pipeline.ts";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import {
  LEAN_FULL_ANALYSIS,
  PROMPT_FILES,
  PROMPT_VERSIONS,
  renderAnalysisPrompt,
} from "../src/analysis/prompts.ts";
import { isUsable, readRecords } from "../src/analysis/records.ts";
import { runAnalysis } from "../src/analysis/run.ts";
import { toJsonSchema } from "../src/analysis/schema.ts";
import { leanDeckSchema } from "../src/analysis/schema-lean.ts";
import { projectPaths } from "../src/config/load.ts";
import { savePick } from "../src/core/selection.ts";
import { fakeProvider } from "./helpers/fake-provider.ts";
import { DECKS, PICK, providers } from "./helpers/imported.ts";
import { tempProject } from "./helpers/project.ts";

const REPO = join(import.meta.dirname, "..");
const TAXONOMY = {
  id: "t",
  version: "1",
  screenTypes: [{ id: "gameplay", label: "Gameplay", subtypes: [] }],
  definitions: {},
  subtypeLabels: {},
};
const RULES = [
  /ONE entry per visually separate text block/,
  /Start a new block whenever any of these changes/,
  /keep them as two blocks/,
  /the same spaces and the same punctuation/,
  /a line break between two words becomes a single space/,
  /a line break inside a split word adds no space/,
  /ALWAYS screenshot-layer text/,
  /used as a showcase/,
  /before "!" or "\?"/,
  /never listed in texts/,
  /rarity or grade labels \(such as "Legendary"\)/,
];

test("both answer shapes carry the text-reading rules", () => {
  for (const lean of [false, true]) {
    const { text } = renderAnalysisPrompt(REPO, join(tmpdir(), "ssr-text-reading"), TAXONOMY, lean);
    for (const re of RULES) assert.match(text, re, `${lean ? "lean" : "full"}: ${re}`);
    assert.doesNotMatch(text, /line breaks become a single space\)/, "the joining rule is gone");
  }
  assert.equal(PROMPT_FILES.fullAnalysis, "full-analysis.v8");
  assert.equal(LEAN_FULL_ANALYSIS.file, "full-analysis.v9");
  // The earlier files stay on disk: saved answers point to them by content hash.
  for (const f of ["full-analysis.v6", "full-analysis.v7"])
    assert.ok(existsSync(join(REPO, "prompts", "analysis", `${f}.md`)), f);
  const js = JSON.stringify(toJsonSchema(leanDeckSchema(TAXONOMY)));
  assert.match(js, /one separate text block, exactly as drawn/);
});

test("the answer shape and contract versions are unchanged, so analysis keys stay the same", () => {
  assert.equal(PROMPT_VERSIONS.fullAnalysis, "full-analysis.v4");
  assert.equal(LEAN_FULL_ANALYSIS.version, "full-analysis.v5");
  const old = readFileSync(join(REPO, "prompts", "analysis", "full-analysis.v6.md"), "utf8");
  const now = readFileSync(join(REPO, "prompts", "analysis", "full-analysis.v8.md"), "utf8");
  const fields = (t: string) => [...t.matchAll(/^\s*- (\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(
    fields(now).filter((f) => f !== "texts"),
    fields(old).filter((f) => f !== "texts"),
  );
});

test("records saved with the earlier prompt stay current; only new images get the new rules", async () => {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  const saved = PROMPT_FILES.fullAnalysis;
  PROMPT_FILES.fullAnalysis = "full-analysis.v6";
  const before = currentPipeline(loaded.config);
  try {
    await runAnalysis(loaded, buildAnalysisPlan(loaded, "pilot"), providers());
  } finally {
    PROMPT_FILES.fullAnalysis = saved;
  }
  const paths = projectPaths(loaded);
  const pilotIds = [...readRecords(paths).keys()];
  assert.ok(pilotIds.length > 0);
  assert.equal(analysisKey(currentPipeline(loaded.config)), analysisKey(before));
  for (const r of readRecords(paths).values()) assert.ok(isUsable(r), r.imageId);
  assert.equal(buildAnalysisPlan(loaded, "pilot").counts.full, 0, "nothing is redone");

  const core = buildAnalysisPlan(loaded, "core");
  const fresh = core.items.filter((i) => i.tier === "full").map((i) => i.imageId);
  assert.ok(fresh.length > 0);
  assert.ok(
    fresh.every((id) => !pilotIds.includes(id)),
    "saved images are not planned again",
  );
  // A drawn space before "!" is kept verbatim from the answer to the saved record.
  const producer = fakeProvider({
    model: "claude-fable-5-1",
    read: () => ({ screenType: "gameplay", headline: "Big Win !" }),
  });
  await runAnalysis(loaded, core, { ...providers(), producer, reviewer: null });
  const imageCalls = producer.calls.filter((c) => c.images.length > 0);
  assert.ok(imageCalls.length > 0);
  for (const c of imageCalls) assert.match(c.system.text, /Reading marketing text/);
  for (const id of fresh) {
    const r = readRecords(paths).get(id);
    assert.ok(isUsable(r), id);
    assert.deepEqual(
      r?.final?.marketingLayer.texts.map((t) => t.text),
      ["Big Win !"],
    );
    assert.equal(r?.final?.headline, "Big Win !");
  }
});

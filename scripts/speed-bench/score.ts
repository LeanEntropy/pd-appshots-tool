/**
 * Free part of the speed benchmark: scores both arms against the answer key, checks the
 * downstream inputs and the measured colours, and writes results.json plus the judging page.
 */
import { measureColours } from "../../src/analysis/colour-measure.ts";
import { colourFamily } from "../../src/analysis/colours.ts";
import type { CallLog } from "../../src/analysis/call.ts";
import { type AnalysisRecord, readRecords } from "../../src/analysis/records.ts";
import { modelCopy } from "../../src/analysis/run-chunk.ts";
import { projectPaths } from "../../src/config/load.ts";
import { openImageDb } from "../../src/store/imagedb.ts";
import type { ArmResult } from "./arms.ts";
import { fullIds, IMAGES, keyRecords, load, need, readOut, readSpend, writeOut } from "./common.ts";
import { area, corePlan, diffPaths, downstream } from "./downstream.ts";
import { type FieldScore, scoreReading } from "./fields.ts";
import { writePage } from "./page.ts";

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2) : 0;
};

function speed(calls: CallLog[], wallMs: number, images: number) {
  const cost = calls.map((c) => c.costUsd ?? 0);
  return {
    images,
    calls: calls.length,
    medianSeconds: med(calls.map((c) => (c.usage?.durationMs ?? 0) / 1000)),
    medianWallSeconds: med(calls.map((c) => (c.usage?.wallMs ?? 0) / 1000)),
    medianCostUsd: med(cost),
    totalCostUsd: cost.reduce((a, b) => a + b, 0),
    medianOutputTokens: med(calls.map((c) => c.usage?.outputTokens ?? 0)),
    medianCacheRead: med(calls.map((c) => c.usage?.cacheReadTokens ?? 0)),
    medianCacheWrite: med(calls.map((c) => c.usage?.cacheWriteTokens ?? 0)),
    repeatedAnswers: calls.filter((c) => (c.usage?.turns ?? 0) > 3).length,
    armWallSeconds: wallMs / 1000,
    imagesPerMinute: wallMs ? images / (wallMs / 60000) : 0,
  };
}

async function main(): Promise<void> {
  need();
  const loaded = load();
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const ids = fullIds(loaded);
  const key = keyRecords(loaded, ids);
  const spike = readOut<{ call: CallLog }>("spike.json");
  const arms = {
    new: readOut<ArmResult>("arm-new.json"),
    control: readOut<ArmResult>("arm-control.json"),
  };
  if (!arms.new || !arms.control || !spike) throw new Error("run spike, new and control first");
  const newCalls = [spike.call, ...arms.new.calls];
  const paired = ids.filter((id) => arms.control?.readings[id] && arms.new?.readings[id]);

  // 1. Field scores
  const scores: Record<string, { new: FieldScore[] | null; control: FieldScore[] | null }> = {};
  for (const id of ids) {
    const r = key.get(id) as AnalysisRecord;
    const game = r.identity?.game ?? r.appId;
    const f = r.final as NonNullable<AnalysisRecord["final"]>;
    const n = arms.new.readings[id];
    const c = arms.control.readings[id];
    scores[id] = {
      new: n ? scoreReading(f, n, game) : null,
      control: c ? scoreReading(f, c, game) : null,
    };
  }
  const errs = (arm: "new" | "control", field: string, only: string[]) =>
    only.filter((id) => scores[id]?.[arm]?.find((s) => s.field === field && !s.ok)).length;
  const fieldNames = [...new Set(Object.values(scores).flatMap((s) => (s.new ?? []).map((x) => `${x.group}|${x.field}`)))];
  const table = fieldNames.map((gf) => {
    const [group, field] = gf.split("|") as [string, string];
    const seen = ids.filter((id) => scores[id]?.new?.some((s) => s.field === field)).length;
    return {
      group,
      field,
      seen,
      newErrorsAll: errs("new", field, ids),
      newErrorsPaired: errs("new", field, paired),
      controlErrorsPaired: errs("control", field, paired),
    };
  });

  // 2. Cases needing a human (gate 1): a critical field where the new answer differs from the
  // saved one. Standard fields are decided by counts (gate 2) and need no judgement.
  const cases = ids.flatMap((id) =>
    (scores[id]?.new ?? []).flatMap((s) => {
      const c = scores[id]?.control?.find((x) => x.field === s.field);
      if (s.group !== "critical" || s.ok) return [];
      return [{ id, field: s.field, group: s.group, key: s.key, new: s.got, control: c ? c.got : null }];
    }),
  );
  // Gate 1: a critical field where New is wrong and Control (paired) is right.
  const gate1 = cases.filter(
    (x) => x.group === "critical" && x.control !== null && scores[x.id]?.control?.find((s) => s.field === x.field)?.ok,
  );
  // Gate 2: per standard/number field, New's errors ≤ Control's + 1 on the paired images.
  const gate2 = table.filter((t) => t.group !== "critical" && t.newErrorsPaired > t.controlErrorsPaired + 1);

  // 3. Downstream inputs on the paired images.
  const plan = corePlan(loaded);
  const all = new Map<string, AnalysisRecord>();
  for (const [id, r] of readRecords(paths)) all.set(id, r);
  const swap = (arm: ArmResult) => {
    const m = new Map(all);
    for (const id of paired) {
      const r = m.get(id);
      const f = arm.readings[id];
      if (r && f) m.set(id, { ...r, final: f });
    }
    return m;
  };
  const dKey = downstream(loaded, plan, all, db, paired);
  const dNew = downstream(loaded, plan, swap(arms.new), db, paired);
  const dCtl = downstream(loaded, plan, swap(arms.control), db, paired);
  const newDiff = diffPaths(dKey, dNew);
  const ctlDiff = new Set(diffPaths(dKey, dCtl));
  const unexplained = newDiff.filter((p) => !ctlDiff.has(p));
  const verdict = (d: Record<string, unknown>) => (d.fit as { verdict?: unknown }).verdict;
  const downstreamOut = {
    newDiffPaths: newDiff.length,
    controlDiffPaths: ctlDiff.size,
    unexplained: unexplained.length,
    unexplainedAreas: [...new Set(unexplained.map(area))],
    unexplainedSample: unexplained.slice(0, 40),
    verdict: { key: verdict(dKey), new: verdict(dNew), control: verdict(dCtl) },
  };

  // 4. Measured colours vs the key's colour families.
  let agree = 0;
  let total = 0;
  const colourRows: unknown[] = [];
  for (const id of ids) {
    const r = key.get(id) as AnalysisRecord;
    const f = r.final as NonNullable<AnalysisRecord["final"]>;
    const img = await modelCopy(paths, db, id);
    const m = await measureColours(img.bytes(), f, r.updatedAt);
    const pairs: [string, string | null, string | null][] = [
      ["screen", colourFamily(f.screenshot.mainColours[0]?.name ?? "", f.screenshot.mainColours[0]?.hex ?? ""), m.screen[0]?.name ?? null],
    ];
    if (f.marketingLayer.present && f.marketingLayer.mainColours[0])
      pairs.push(["layer", colourFamily(f.marketingLayer.mainColours[0].name, f.marketingLayer.mainColours[0].hex), m.layer[0]?.name ?? null]);
    f.marketingLayer.backgroundMasks.forEach((b, i) => {
      pairs.push([`mask ${i + 1}`, colourFamily(b.colourName, b.colourHex), m.masks[i]?.family ?? null]);
    });
    for (const [what, k, got] of pairs) {
      total++;
      if (k === got) agree++;
      colourRows.push({ id: id.slice(0, 10), what, key: k, measured: got });
    }
  }

  const sNew = speed(newCalls, arms.new.wallMs + (spike.call.usage?.wallMs ?? 0), ids.length);
  const sCtl = speed(arms.control.calls, arms.control.wallMs, paired.length);
  const results = {
    images: IMAGES,
    paired: paired.map((x) => x.slice(0, 10)),
    spentUsd: readSpend().usd,
    speed: { new: sNew, control: sCtl, newWarmMedianCostUsd: med(arms.new.calls.map((c) => c.costUsd ?? 0)) },
    table,
    gates: {
      critical: { pass: gate1.length === 0, failures: gate1 },
      standard: { pass: gate2.length === 0, failures: gate2 },
      downstream: { pass: unexplained.length === 0, ...downstreamOut },
      colours: { agreement: total ? agree / total : 0, pass: total > 0 && agree / total >= 0.8, rows: colourRows },
      speed: {
        medianSeconds: sNew.medianSeconds <= 22,
        costPerImage: sNew.medianCostUsd <= 0.12,
        throughput: sNew.imagesPerMinute >= 2.5 * sCtl.imagesPerMinute,
        noDoubleFailure: Object.keys(arms.new.failed).length === 0,
      },
    },
    cases,
  };
  writeOut("results.json", results);
  await writePage(loaded, results, key, arms.new, arms.control);
  console.log(JSON.stringify({ gates: { ...results.gates, colours: { agreement: results.gates.colours.agreement } }, speed: results.speed }, null, 1));
}

await main();

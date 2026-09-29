/**
 * Go/no-go gates of the layout benchmark (plan-layout-wireframes section 7) from scores.json.
 * Baseline for time and cost: docs/analysis-speed-measurements.md (full analysis, median of 86
 * calls: $0.154, 28 s wall, 21 s writing, 1,816 output tokens). No paired run (user decision).
 * Usage: npx tsx scripts/layout-bench/gates.ts
 */
import { edgeError } from "./metrics.ts";
import { readOut, writeOut } from "./common.ts";

const BASE = { usd: 0.154, wallS: 28, outTokens: 1816 };
const PRICE = { out: 50e-6, cacheRead: 0.25e-6, cacheWrite: 20e-6 };

// biome-ignore lint/suspicious/noExplicitAny: benchmark JSON read back as written by score.ts
type Any = any;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

function main(): void {
  const s = readOut<Any>("scores.json");
  if (!s) throw new Error("Run score.ts first.");
  const imgs = (s.images as Any[]).filter((i) => i.measured);
  // Gate 1: each part.
  const f1 = mean(imgs.map((i) => i.measured.f1.mean));
  const place = mean(imgs.map((i) => i.measured.placementError));
  const texts = imgs.flatMap((i) => i.measured.texts as Any[]);
  const cer = mean(texts.map((t) => t.cer));
  const geo = imgs.flatMap((i) =>
    (i.measured.parts as Any[]).filter((p) => p.what !== "coverage").map((p) => ({ image: i.name, ...p })),
  );
  const within = geo.filter((p) => (p.what.endsWith("tilt") ? p.err <= 1 : p.err <= 1.5));
  const g1 = {
    elementsF1: r(f1),
    placementError: r(place, 2),
    textCharacterError: r(cer),
    geometryWithinTolerance: `${within.length} of ${geo.length}`,
    pass: f1 >= 0.7 && place <= 6 && cer <= 0.1 && within.length >= 0.8 * geo.length,
  };
  // Gate 2: totals.
  const totals = imgs.map((i) => ({ image: i.name, modelOnly: r(i.modelOnly.total, 1), measured: r(i.measured.total, 1) }));
  const g2 = { totals, mean: r(mean(totals.map((t) => t.measured)), 1), pass: mean(totals.map((t) => t.measured)) >= 75 && totals.every((t) => t.measured >= 60) };
  // Gate 3: core reading unchanged against the saved records.
  const core = imgs.map((i) => ({ image: i.name, baselineMadeAt: i.baseline?.madeAt, differences: i.baseline?.coreDiff ?? ["no baseline"] }));
  const g3 = { core, pass: core.every((c) => !c.differences.length) };
  // Gate 4: cost and time.
  const per = imgs.map((i) => {
    const u = (i.usage as Any[])[0] ?? {};
    const addedOut = i.layoutOutputTokens as number;
    const blockTokens = Math.round(((s.prompt.blockChars as number) + 4201) / 4);
    return {
      image: i.name,
      costUsd: r(i.costUsd),
      wallS: r((u.wallMs ?? 0) / 1000, 1),
      outputTokens: u.outputTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      layoutOutputTokens: addedOut,
      addedUsd: r(addedOut * PRICE.out + blockTokens * PRICE.cacheRead),
      addedS: r(addedOut * i.secondsPerOutputToken, 1),
      // The same call as if its cache had been warm (the first call paid the one-time write).
      warmUsd: r(i.costUsd - Math.max(0, (u.cacheWriteTokens ?? 0) - 2586) * (PRICE.cacheWrite - PRICE.cacheRead)),
    };
  });
  const g4 = {
    baseline: BASE,
    perImage: per,
    addedUsdMean: r(mean(per.map((p) => p.addedUsd))),
    addedSecondsMean: r(mean(per.map((p) => p.addedS)), 1),
    vsBaseline: {
      costMean: r(mean(per.map((p) => p.costUsd)) - BASE.usd),
      costMeanWarm: r(mean(per.map((p) => p.warmUsd)) - BASE.usd),
      wallMean: r(mean(per.map((p) => p.wallS)) - BASE.wallS, 1),
      outputTokensMean: Math.round(mean(per.map((p) => p.outputTokens)) - BASE.outTokens),
    },
    pass: false,
  };
  g4.pass = g4.addedUsdMean <= 0.07 && g4.addedSecondsMean <= 25;
  // Gate 5: valid answers, repairs, cap.
  const g5 = { images: imgs.map((i) => ({ image: i.name, calls: i.calls, counts: i.counts, problems: i.layoutProblems })), pass: imgs.length === 4 && imgs.every((i) => !i.layoutProblems.length && i.counts.inGame <= 8 && i.counts.marketing <= 8) };
  // Gate 6: the measuring tool never makes a value worse than the model's by more than 2 points.
  const worse: Any[] = [];
  for (const i of imgs) {
    const m = i.modelOnly.parts as Any[];
    for (const p of i.measured.parts as Any[]) {
      const b = m.find((x) => x.what === p.what);
      if (b && p.err - b.err > 2) worse.push({ image: i.name, what: p.what, model: r(b.err, 2), measured: r(p.err, 2) });
    }
  }
  const boxes: Any[] = [];
  for (const i of imgs) {
    const key = readOut<Any>(`answer-keys/${i.name}.json`);
    for (const me of (i.measure.elements as Any[]).filter((e) => e.box && e.role !== "band")) {
      const model = [...i.layout.inGame, ...i.layout.marketing].find((e: Any) => e.id === me.id);
      const matched = [...(key.inGame as Any[]), ...(key.marketing as Any[])].filter((k) => k.role === me.role);
      const k = matched.sort((a, b) => edgeError(a.box, model.box) - edgeError(b.box, model.box))[0];
      if (!k) continue;
      const row = { image: i.name, id: me.id, role: me.role, model: r(edgeError(k.box, model.box), 2), measured: r(edgeError(k.box, me.box), 2) };
      boxes.push(row);
      if (row.measured - row.model > 2) worse.push({ ...row, what: "snapped box" });
    }
  }
  const g6 = { snappedBoxes: boxes, worse, pass: !worse.length };
  // Gate 7: experimental measurements against the key.
  const g7 = { rows: imgs.map((i) => ({ image: i.name, glyphMeasured: i.measure.experimental.headlineGlyphPercent, glyphKey: i.key.glyph, contrastMeasured: i.measure.experimental.headlineContrast, contrastKey: i.key.contrast })), validated: false };
  const gates = { g1, g2, g3, g4, g5, g6, g7 };
  writeOut("results.json", { spentUsd: s.spentUsd, gates, go: g1.pass && g2.pass && g3.pass && g4.pass && g5.pass && g6.pass });
  for (const [k, v] of Object.entries(gates)) console.log(k, "pass" in v ? v.pass : "(report)", JSON.stringify(v).slice(0, 400));
}

main();

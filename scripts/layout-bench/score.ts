/**
 * Free part of the layout benchmark: measuring tool on the 4 answers, accuracy score against the
 * frozen answer keys (model-only and after measurement), and the go/no-go gates.
 * Usage: BENCH_ROOT=<scratch>/layout-root npx tsx scripts/layout-bench/score.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { StoredObject } from "../../src/analysis/call.ts";
import type { AnalysisRecord } from "../../src/analysis/records.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";
import { readLayout } from "../../src/layout/checks.ts";
import { applyMeasure, type LayoutMeasure, measureLayout } from "../../src/layout/measure/index.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { workspaceStorage } from "../../src/storage/index.ts";
import { BENCH_ROOT, IMAGES, need, OUT, readOut, readSpend, writeOut } from "./common.ts";
import { type AnswerKey, boxEdge, cer, edgeError, elementText, lin, matchLayer } from "./metrics.ts";
import type { BenchRun } from "./run.ts";

type Meaning = Record<string, boolean>;

function scoreImage(key: AnswerKey, layout: Layout, core: ImageAnalysis, m: LayoutMeasure | null, meaning: Meaning) {
  const aspect = key.height / key.width;
  const L = m ? applyMeasure(layout, m) : layout;
  const inG = matchLayer(key.inGame, L.inGame, aspect);
  const mk = matchLayer(key.marketing, L.marketing, aspect);
  const f1 = (inG.f1 + mk.f1) / 2;
  const matches = [...inG.matches, ...mk.matches];
  const place = matches.length
    ? matches.reduce((s, x) => s + edgeError(x.key.box, x.got.box), 0) / matches.length
    : 12;
  const texts: { role: string; key: string; got: string; cer: number; meaning: boolean | null }[] = [];
  for (const k of key.marketing.filter((e) => ["headline", "subline", "logo"].includes(e.role))) {
    const g = mk.matches.find((x) => x.key.id === k.id)?.got ?? L.marketing.find((e) => e.role === k.role);
    const got = g ? elementText(g, L, core) : "";
    const id = `${key.name}:${k.id}`;
    texts.push({ role: k.role, key: k.text ?? "", got, cer: cer(k.text ?? "", got), meaning: id in meaning ? (meaning[id] as boolean) : null });
  }
  const textPts = texts.length
    ? texts.reduce((s, t) => s + 15 * lin(t.cer, 0.05, 0.3) + 5 * (t.meaning ? 1 : 0), 0) / texts.length
    : 20;
  // Measurements: band tilt and edges, coverage.
  const parts: { what: string; key: number; got: number; err: number; score: number; measured: boolean }[] = [];
  for (const b of key.measurements.bands) {
    const g = mk.matches.find((x) => x.key.id === b.id)?.got;
    const me = m?.elements.find((e) => e.id === g?.id);
    const tilt = g ? g.tiltDeg : 0;
    parts.push({ what: `${b.id} tilt`, key: b.tiltDeg, got: tilt, err: Math.abs(tilt - b.tiltDeg), score: g ? lin(Math.abs(tilt - b.tiltDeg), 1, 5) : 0, measured: !!me?.tiltDeg });
    for (const side of ["top", "bottom"] as const) {
      const kb = b[side];
      if (!kb) continue;
      const measured = me?.[side] ?? null;
      const e = measured ?? (g ? boxEdge(g, side, aspect) : null);
      const err = e ? (Math.abs(e.left - kb.left) + Math.abs(e.right - kb.right)) / 2 : 99;
      parts.push({ what: `${b.id} ${side} edge`, key: (kb.left + kb.right) / 2, got: e ? (e.left + e.right) / 2 : -1, err, score: lin(err, 1.5, 6), measured: !!measured });
    }
  }
  const cov = m ? m.coverageUpTo : layout.composition.overlaySharePercent;
  const covErr = Math.abs(cov - key.measurements.coveragePercent);
  parts.push({ what: "coverage", key: key.measurements.coveragePercent, got: cov, err: covErr, score: lin(covErr, 3, 12), measured: !!m });
  const measPts = (20 * parts.reduce((s, p) => s + p.score, 0)) / parts.length;
  const f = L.composition.focal;
  const kf = key.composition.focal;
  const diag = Math.hypot(100, 100 * aspect);
  const fd = Math.hypot(f.x - kf.x, (f.y - kf.y) * aspect) / diag;
  const roleOf = (id: string | undefined, els: { id: string; role: string }[]) => els.find((e) => e.id === id)?.role;
  const firstOk =
    roleOf(L.composition.readingOrder[0], [...L.inGame, ...L.marketing]) ===
    roleOf(key.composition.readingOrder[0], [...key.inGame, ...key.marketing]);
  const compPts = 7 * lin(fd, 0.1, 0.3) + (firstOk ? 3 : 0);
  const pts = { elements: 30 * f1, placement: 20 * lin(place, 3, 12), text: textPts, measurements: measPts, composition: compPts };
  const total = Object.values(pts).reduce((a, b) => a + b, 0);
  return { f1: { inGame: inG.f1, marketing: mk.f1, mean: f1 }, placementError: place, texts, parts, focalDistance: fd, firstOk, pts, total };
}

function coreSame(a: ImageAnalysis, b: ImageAnalysis) {
  const diff: string[] = [];
  if (a.screenshot.screenType !== b.screenshot.screenType) diff.push(`screen type ${b.screenshot.screenType} -> ${a.screenshot.screenType}`);
  if (a.screenshot.composition !== b.screenshot.composition) diff.push(`composition ${b.screenshot.composition} -> ${a.screenshot.composition}`);
  if (a.marketingLayer.present !== b.marketingLayer.present) diff.push("marketing layer present");
  if (a.headline !== b.headline) diff.push(`headline "${b.headline}" -> "${a.headline}"`);
  return diff;
}

async function main(): Promise<void> {
  need();
  const run = readOut<BenchRun>("run.json");
  if (!run) throw new Error("Run run.ts first.");
  const meaning = readOut<Meaning>("meaning.json") ?? {};
  const store = workspaceStorage(join(BENCH_ROOT, "workspace"));
  const spend = readSpend();
  const images = [];
  for (const im of IMAGES) {
    const r = run.images.find((x) => x.imageId === im.id);
    const key = JSON.parse(readFileSync(join(OUT, "answer-keys", `${im.name}.json`), "utf8")) as AnswerKey;
    if (!r?.reading) {
      images.push({ name: im.name, failed: r?.failed ?? "not run" });
      continue;
    }
    const raw = (r.output as { images: { layout?: unknown }[] }).images[0]?.layout;
    const got = readLayout(raw, r.reading);
    const orig = [...store.list("library/images/orig")].find((k) => k.includes(im.id)) as string;
    const measure = got.layout
      ? await measureLayout(store.getBytes(orig) as Buffer, got.layout, { imageId: im.id, layoutKey: "bench" })
      : null;
    const base = [...store.list(`library/analysis/${im.id}`)]
      .map((k) => store.getJson(k) as AnalysisRecord)
      .find((x) => x?.final);
    const baseObj = base?.producer ? (store.getJson(`library/objects/full-analysis/${base.producer.object}.json`) as StoredObject | undefined) : undefined;
    const own = (r as { calls?: typeof spend.calls }).calls ?? [];
    const calls = own.length ? own : spend.calls.filter((c) => c.imageIds.includes(im.id));
    const layoutChars = JSON.stringify(raw ?? null).length;
    const answerChars = JSON.stringify(r.output).length;
    const out = calls.reduce((s, c) => s + (c.usage?.outputTokens ?? 0), 0);
    const secs = calls.reduce((s, c) => s + (c.usage?.durationMs ?? 0), 0) / 1000;
    images.push({
      name: im.name,
      imageId: im.id,
      why: im.why,
      calls: calls.length,
      costUsd: calls.reduce((s, c) => s + (c.costUsd ?? 0), 0),
      usage: calls.map((c) => c.usage),
      layoutShareOfAnswer: layoutChars / answerChars,
      layoutOutputTokens: Math.round((out * layoutChars) / answerChars),
      secondsPerOutputToken: out ? secs / out : 0,
      baseline: base?.final ? { costUsd: baseObj?.costUsd ?? null, usage: baseObj?.usage ?? null, answerChars: JSON.stringify(baseObj?.output ?? "").length, coreDiff: coreSame(r.reading, base.final), final: base.final, madeAt: base.updatedAt } : null,
      layoutProblems: got.problems,
      counts: got.layout ? { inGame: got.layout.inGame.length, marketing: got.layout.marketing.length } : null,
      layout: got.layout,
      measure,
      modelOnly: got.layout ? scoreImage(key, got.layout, r.reading, null, meaning) : null,
      measured: got.layout ? scoreImage(key, got.layout, r.reading, measure, meaning) : null,
      key: { glyph: key.measurements.headlineGlyphPercent, contrast: key.measurements.headlineContrast },
    });
  }
  writeOut("scores.json", { spentUsd: spend.usd, prompt: run.prompt, images });
  for (const i of images)
    if ("measured" in i && i.measured && i.modelOnly)
      console.log(`${i.name}: model ${i.modelOnly.total.toFixed(1)} measured ${i.measured.total.toFixed(1)}`, JSON.stringify(i.measured.pts));
}

await main();

/** Field-by-field scoring of one reading against the answer key (plan section 9). */
import { categoryOf, FULL_SCREEN_ART } from "../../src/analysis/categories.ts";
import { artMessage, showsLogo } from "../../src/analysis/image-tags.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";

export type Group = "critical" | "standard" | "numbers";

export interface FieldScore {
  field: string;
  group: Group;
  ok: boolean;
  key: string;
  got: string;
}

type Box = { x: number; y: number; w: number; h: number };

export const norm = (s: string) =>
  s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[“”"'’‘]/g, "").trim();

export function cer(a: string, b: string): number {
  const x = [...norm(a)];
  const y = [...norm(b)];
  if (!x.length && !y.length) return 0;
  const d = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    let prev = d[0] as number;
    d[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const tmp = d[j] as number;
      d[j] = Math.min((d[j] as number) + 1, (d[j - 1] as number) + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return (d[y.length] as number) / Math.max(x.length, y.length);
}

export function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

const list = (xs: string[]) => [...xs].sort().join(", ");

/** Each key text matched with the arm's closest text (character error ≤ 5%). */
function textMatches(key: ImageAnalysis, got: ImageAnalysis) {
  const used = new Set<number>();
  const pairs = key.marketingLayer.texts.map((t) => {
    let best = -1;
    let bestErr = 1;
    got.marketingLayer.texts.forEach((g, i) => {
      const e = cer(t.text, g.text);
      if (!used.has(i) && e < bestErr) {
        best = i;
        bestErr = e;
      }
    });
    if (best >= 0 && bestErr <= 0.05) used.add(best);
    return { key: t, got: bestErr <= 0.05 ? got.marketingLayer.texts[best] : undefined };
  });
  const extra = got.marketingLayer.texts.filter((_, i) => !used.has(i));
  return { pairs, extra };
}

export function scoreReading(key: ImageAnalysis, got: ImageAnalysis, game: string): FieldScore[] {
  const out: FieldScore[] = [];
  const add = (field: string, group: Group, k: unknown, g: unknown, ok?: boolean) => {
    const ks = typeof k === "string" ? k : JSON.stringify(k);
    const gs = typeof g === "string" ? g : JSON.stringify(g);
    out.push({ field, group, ok: ok ?? ks === gs, key: ks, got: gs });
  };
  const ks = key.screenshot;
  const gs = got.screenshot;
  const km = key.marketingLayer;
  const gm = got.marketingLayer;
  // Critical
  add("category", "critical", categoryOf(key), categoryOf(got));
  add("marketing layer present", "critical", km.present, gm.present);
  const t = textMatches(key, got);
  const missing = t.pairs.filter((p) => !p.got).map((p) => p.key.text);
  add(
    "marketing texts",
    "critical",
    // Each text block in quotes, so a different split into blocks is visible.
    km.texts.map((x) => x.text).sort(),
    gm.texts.map((x) => x.text).sort(),
    !missing.length && !t.extra.length,
  );
  add("headline", "critical", key.headline, got.headline, cer(key.headline, got.headline) <= 0.05);
  add("game logo tag", "critical", showsLogo(key, game), showsLogo(got, game));
  if (categoryOf(key) === FULL_SCREEN_ART || categoryOf(got) === FULL_SCREEN_ART)
    add("art message", "critical", artMessage(key, game), artMessage(got, game));
  add(
    "text languages",
    "critical",
    list([...new Set(km.texts.map((x) => x.language))]),
    list([...new Set(gm.texts.map((x) => x.language))]),
  );
  // Standard
  add("subtype", "standard", ks.subtype, gs.subtype);
  add("capture types", "standard", list(ks.captures.map((c) => c.screenType)), list(gs.captures.map((c) => c.screenType)));
  add("capture orientation", "standard", list(ks.captures.map((c) => c.orientation)), list(gs.captures.map((c) => c.orientation)));
  add("capture framing", "standard", list(ks.captures.map((c) => c.framing)), list(gs.captures.map((c) => c.framing)));
  add(
    "text roles",
    "standard",
    list(t.pairs.map((p) => p.key.role)),
    list(t.pairs.map((p) => p.got?.role ?? "(missing)")),
  );
  add("mask count", "standard", km.backgroundMasks.length, gm.backgroundMasks.length);
  add("mask shapes", "standard", list(km.backgroundMasks.map((m) => m.shape)), list(gm.backgroundMasks.map((m) => m.shape)));
  add("mask locations", "standard", list(km.backgroundMasks.map((m) => m.location)), list(gm.backgroundMasks.map((m) => m.location)));
  add("element kinds", "standard", list(km.elements.map((e) => e.kind)), list(gm.elements.map((e) => e.kind)));
  add("relation to screen", "standard", km.relationToScreen, gm.relationToScreen);
  // Numbers
  add("coverage", "numbers", km.coveragePercent, gm.coveragePercent, Math.abs(km.coveragePercent - gm.coveragePercent) <= 10);
  add("capture share", "numbers", ks.captureAreaPercent, gs.captureAreaPercent, Math.abs(ks.captureAreaPercent - gs.captureAreaPercent) <= 10);
  const ka = ks.captures.map((c) => c.areaPercent).sort((a, b) => b - a);
  const ga = gs.captures.map((c) => c.areaPercent).sort((a, b) => b - a);
  add("capture areas", "numbers", ka, ga, ka.length === ga.length && ka.every((v, i) => Math.abs(v - (ga[i] ?? 0)) <= 10));
  const tIou = t.pairs.filter((p) => p.got).map((p) => iou(p.key.region, (p.got as typeof p.key).region));
  if (tIou.length)
    add("text boxes (IoU ≥ 0.5)", "numbers", tIou.length, tIou.map((v) => v.toFixed(2)), tIou.every((v) => v >= 0.5));
  if (km.backgroundMasks.length && gm.backgroundMasks.length) {
    const mIou = km.backgroundMasks.map((m) => Math.max(...gm.backgroundMasks.map((g) => iou(m.region, g.region))));
    add("mask boxes (IoU ≥ 0.5)", "numbers", mIou.length, mIou.map((v) => v.toFixed(2)), mIou.every((v) => v >= 0.5));
  }
  return out;
}

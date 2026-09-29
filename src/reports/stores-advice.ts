import { PLAY_METRICS, playSetup } from "../analysis/play-experiments.ts";
import { appleRule } from "../appstore/apple-rules.ts";
import { PPO_METRIC, ppoSetup } from "../appstore/ppo.ts";
import type { TrafficLevel } from "../settings/schema.ts";
import { comparable } from "./stores-data.ts";
import type { PairResult, StorePattern, StoreRec, StoreTest } from "./stores-types.ts";
import type { MarketRef } from "./types.ts";

/**
 * Recommendations and A/B tests per store from the computed differences (plan-app-store 7.2 and
 * 7.3), by code: each one names its evidence (n of m games, or our own images) and one concrete
 * action. App Store advice never breaks an enforced rule (Guideline 2.3.3 first); App Store tests
 * are Product Page Optimization tests, Google Play tests are store listing experiments.
 */
export interface AdviceContext {
  markets: readonly MarketRef[];
  projectMarkets: readonly MarketRef[];
  traffic: (gl: string) => TrafficLevel;
  appleLang: (m: MarketRef) => string;
}

const list = (xs: readonly (string | number)[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)] as number) : 0;
};

export function storesAdvice(
  pairs: readonly PairResult[],
  patterns: readonly StorePattern[],
  x: AdviceContext,
): { recommendations: StoreRec[]; tests: StoreTest[] } {
  const recs: Omit<StoreRec, "priority">[] = [];
  const tests: StoreTest[] = [];
  const ours = pairs.filter((r) => r.ours && comparable(r));
  const label = (gl: string) => x.markets.find((m) => m.gl === gl)?.label ?? gl.toUpperCase();
  // 1. Enforced rule: every App Store image must show the game in use (Guideline 2.3.3).
  const art = ours.filter((r) => r.appleArt.length);
  if (art.length)
    recs.push({
      store: "appstore",
      title: "Replace title-art-only images on the App Store",
      why: `${list(art.map((r) => `${r.country}: position ${list(r.appleArt)}`))} ${art.length === 1 && art[0]?.appleArt.length === 1 ? "is" : "are"} title art only. Apple: "${appleRule("2.3.3").quote}"`,
      action:
        "Use a real gameplay capture with the logo over it, keeping the same message, in each of those positions.",
      rule: "Guideline 2.3.3",
      asset: "new",
    });
  for (const r of ours) {
    const them = pairs.filter((p) => p.gl === r.gl && !p.ours && comparable(p));
    const m = median(them.map((p) => p.count.apple));
    // 2. Fewer App Store images than competitors usually show.
    if (them.length >= 3 && r.count.apple <= m - 2)
      recs.push({
        store: "appstore",
        title: `Show more images on the App Store in ${r.country}`,
        why: `We show ${r.count.apple}; the ${them.length} competitors show ${m} (median). Apple allows up to 10, and the first 1 to 3 can appear in search results.`,
        action:
          r.count.play > r.count.apple
            ? `Add ${m - r.count.apple} of our Google Play screens not on the App Store yet, reshaped to the App Store format.`
            : `Add ${m - r.count.apple} new game screens, each showing one feature in use.`,
        rule: null,
        asset: r.count.play > r.count.apple ? "reuse" : "new",
      });
  }
  // 3. Where most competitors do it differently on the App Store (patterns, 3+ games).
  for (const p of patterns.filter((q) => q.pattern && q.ours === "different")) {
    const evidence = `${p.n} of ${p.of} competitors in ${p.country} ${p.statement}; ${p.oursNote}.`;
    if (p.id === "reshape")
      recs.push({
        store: "appstore",
        title: `Reshape our shared screens to the App Store format in ${p.country}`,
        why: evidence,
        action:
          "Recapture or extend each shared screen to the iPhone 6.9-inch shape (for example 1290 × 2796) instead of reusing the Google Play crop.",
        rule: null,
        asset: "reuse",
      });
    else if (p.id === "lead-play" && !art.length)
      recs.push({
        store: "appstore",
        title: `Lead with game screens on the App Store in ${p.country}`,
        why: evidence,
        action: "Move a gameplay capture with a benefit headline into positions 1 to 3.",
        rule: null,
        asset: "reuse",
      });
    else if (p.id === "adapt" || p.id === "text") {
      const m = x.markets.find((q) => q.gl === p.gl);
      if (!m || tests.some((t) => t.store === "appstore" && t.title.includes(p.country))) continue;
      const setup = ppoSetup([x.appleLang(m)], 2, x.traffic(p.gl));
      tests.push({
        store: "appstore",
        title: `App Store-made first images in ${p.country}`,
        hypothesis:
          p.id === "adapt"
            ? "Most competitors made pictures for the App Store instead of reusing Google Play's; images made for the taller iPhone page may convert App Store visitors better."
            : "Most competitors change the words on screens both stores share; text written for the App Store visitor may convert better.",
        evidence,
        control: "Our current App Store images, unchanged.",
        treatments: [
          p.id === "adapt"
            ? "Positions 1 to 3 remade for the App Store: full-height gameplay captures, one benefit headline each, logo on position 1."
            : "The same screens with App Store headlines: shorter, one benefit each, local language.",
          "The same as the first treatment, positions 1 to 3 in another order (the strongest battle first).",
        ].slice(0, setup.variants),
        metric: `${PPO_METRIC.name}: ${PPO_METRIC.meaning}`,
        setup: { line: setup.line, notes: setup.notes },
      });
    }
  }
  // 4. Our own pictures that only one store shows: test them on the other store.
  for (const r of ours) {
    const only = r.rows.filter((w) => w.apple?.mark === "new").map((w) => w.n);
    const m = x.markets.find((q) => q.gl === r.gl);
    if (!only.length || !m || tests.some((t) => t.store === "play")) continue;
    const setup = playSetup([m], x.markets, x.projectMarkets, x.traffic, false);
    tests.push({
      store: "play",
      title: `Our App Store-only pictures on Google Play in ${r.country}`,
      hypothesis:
        "Pictures we made for the App Store are not on Google Play; if they carry a clearer benefit, they may convert Google Play visitors too.",
      evidence: `App Store position ${list(only)} in ${label(r.gl)} ${only.length === 1 ? "has" : "have"} no Google Play counterpart.`,
      control: "Our current Google Play images, unchanged.",
      treatments: [
        `Our Google Play set with the App Store picture${only.length === 1 ? "" : "s"} at position ${list(only)} in place of the Google Play one${only.length === 1 ? "" : "s"}, in the Google Play shape.`,
      ],
      metric: `${PLAY_METRICS.installs.name}: ${PLAY_METRICS.installs.meaning}`,
      setup: { line: setup.line, notes: setup.notes },
    });
  }
  const order = { "Guideline 2.3.3": 0 } as Record<string, number>;
  const recommendations = recs
    .sort((a, b) => (order[a.rule ?? ""] ?? 1) - (order[b.rule ?? ""] ?? 1))
    .map((r, i) => ({ ...r, priority: i + 1 }));
  return { recommendations, tests: tests.slice(0, 4) };
}

/** The bottom line in points (open by default): the verdict, what differs, what to do. */
export function storesSummary(
  pairs: readonly PairResult[],
  patterns: readonly StorePattern[],
  recs: readonly StoreRec[],
): { verdict: string; points: string[]; actions: string[] } {
  const ours = pairs.filter((r) => r.ours && comparable(r));
  const reuse = (r: PairResult) =>
    `${Math.round(r.reuseShare * r.count.apple)} of ${r.count.apple} App Store images proven to reuse Google Play screens${r.unconfirmed ? ` (${r.unconfirmed} more probably do: not checked yet)` : ""}`;
  const verdict = ours.length
    ? `Our pages: ${list(ours.map((r) => `${r.country}, ${reuse(r)}`))}.`
    : "Our game has no App Store page to compare in these countries.";
  // Pictures matched by fingerprint only are not counted until checked (free, in the approval).
  const open = pairs.filter(comparable).reduce((n, r) => n + r.unconfirmed, 0);
  const points = [
    ...ours.map(
      (r) =>
        `**${r.country}**: ${r.count.play} images on Google Play, ${r.count.apple} on the App Store; order ${r.order === "same" ? "kept" : r.order === "reordered" ? "changed" : "not comparable"}; ${r.reshaped} reshaped.`,
    ),
    ...patterns
      .filter((p) => p.pattern)
      .slice(0, 3)
      .map(
        (p) =>
          `**${p.n} of ${p.of} competitors** in ${p.country} ${p.statement}${p.ours === "different" ? " (we do not)" : ""}.`,
      ),
  ];
  if (open)
    points.push(
      `**${open} App Store ${open === 1 ? "image is" : "images are"}** probably a Google Play screen in another shape, not checked yet: press Review and approve and answer Same screen (free) so the comparison counts ${open === 1 ? "it" : "them"}.`,
    );
  return { verdict, points, actions: recs.slice(0, 3).map((r) => r.title) };
}

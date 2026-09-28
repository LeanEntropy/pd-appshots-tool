import type { Provider, VisionCall, VisionResult } from "../../src/analysis/providers.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";

export function reading(
  imageRef: string,
  screenType: string,
  headline: string,
  layer = true,
): ImageAnalysis {
  return {
    imageRef,
    screenshot: {
      composition: "single_full_capture",
      screenType,
      subtype: "",
      captures: [
        {
          orientation: "portrait",
          screenType,
          subtype: "",
          region: { x: 0, y: 10, w: 100, h: 85 },
          areaPercent: 85,
          framing: "full_bleed",
          description: "test",
        },
      ],
      description: "test",
      action: "fighting",
      atmosphere: "epic",
      mainColours: [{ name: "blue", hex: "#1f6fd0" }],
      captureAreaPercent: 85,
    },
    marketingLayer: layer
      ? {
          present: true,
          coveragePercent: 15,
          backgroundMasks: [
            {
              shape: "band",
              colourName: "yellow",
              colourHex: "#f7d704",
              location: "top",
              region: { x: 0, y: 0, w: 100, h: 15 },
            },
          ],
          texts: [
            {
              role: "headline",
              text: headline || "PLAY",
              language: "en",
              colour: "white #ffffff",
              strokeColour: "black",
              fontStyle: "heavy sans",
              size: "large",
              position: "top",
              region: { x: 5, y: 2, w: 90, h: 10 },
            },
          ],
          elements: [],
          mainColours: [{ name: "yellow", hex: "#f7d704" }],
          relationToScreen: "describes",
        }
      : {
          present: false,
          coveragePercent: 0,
          backgroundMasks: [],
          texts: [],
          elements: [],
          mainColours: [],
          relationToScreen: "none",
        },
    headline,
    confidence: 0.9,
    notes: "",
  };
}

export interface FakeOptions {
  family?: Provider["family"];
  /** Model name as the provider reports it (default "fake-model"). */
  model?: string;
  /** Screen type and headline per image path. */
  read: (path: string) => { screenType: string; headline: string };
  /** Make deck calls (more than one image) fail validation this many times. */
  badDeckCalls?: number;
  costUsd?: number;
  /** Findings severity the fake recommendation reviewer returns (default: none). */
  reviewSeverity?: "major" | "minor";
}

function recommendations(n: number) {
  return {
    rationale: "test",
    positions: Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      screenType: "gameplay",
      subtype: "battle",
      source: "new capture",
      screenshot: {
        orientation: "portrait",
        whatToCapture: "a boss fight",
        action: "fighting",
        atmosphere: "epic",
        mainColours: "blue",
      },
      marketingLayer: {
        present: true,
        proportion: "full screenshot, small layer",
        backgroundMask: { shape: "band", colour: "yellow #f7d704", location: "top" },
        texts: [
          {
            role: "headline",
            text: "EPIC BOSSES",
            colour: "white",
            strokeColour: "black",
            fontStyle: "heavy sans",
            size: "large",
            position: "top",
          },
        ],
        elements: [],
      },
      logo: { show: i === 0, why: "test" },
      why: "test",
    })),
  };
}

/** The computed key points sent with the pattern check (so the fake returns the same count). */
function keyPointsIn(prompt: string): unknown[] {
  const line = prompt.split("\n").find((l) => l.startsWith("{") && l.includes('"keyPoints"'));
  try {
    return (JSON.parse(line ?? "{}") as { keyPoints?: unknown[] }).keyPoints ?? [];
  } catch {
    return [];
  }
}

/** One valid A/B test from the first gap in the prompt (the gaps JSON line), for the fake. */
function abAnswer(prompt: string) {
  const line = prompt.split("\n").find((l) => l.startsWith('[{"id":"E'));
  const gaps = JSON.parse(line ?? "[]") as {
    id: string;
    n: number;
    of: number;
    countries: string[];
    positions: number[] | string;
    ourPositionsThatDiffer: number[];
  }[];
  const n = Number(/Our deck has (\d+) screenshots/.exec(prompt)?.[1] ?? 3);
  const g = gaps[0];
  if (!g) return { tests: [] };
  const at = g.ourPositionsThatDiffer[0] ?? (Array.isArray(g.positions) ? g.positions[0] : 1) ?? 1;
  const slot = (p: number) => ({
    position: p,
    fromOurPosition: p,
    changes: p === at ? ["screen", "text"] : [],
    orientation: "portrait",
    composition: "single full capture",
    screen: p === at ? "a boss fight in the middle" : "as today",
    band: "yellow band #f7d704 at top",
    headline: p === at ? "EPIC BOSSES" : "",
    extras: "none",
  });
  const variant = {
    summary: "one screenshot",
    slots: Array.from({ length: n }, (_, i) => slot(i + 1)),
  };
  return {
    tests: [
      {
        title: "Battle first",
        hypothesis: "Showing battle first should lift installs.",
        evidence: [{ id: g.id, n: g.n, of: g.of }],
        variable: "screenshot",
        countries: g.countries,
        metric: "installs",
        variant,
        secondVariant: null,
        impact: { size: "medium", reason: "position 1 is seen by every visitor" },
        orderReason: "",
      },
    ],
  };
}

/** A provider that answers from a lookup instead of calling a model. Records every call. */
export function fakeProvider(o: FakeOptions): Provider & { calls: VisionCall[] } {
  const calls: VisionCall[] = [];
  let bad = o.badDeckCalls ?? 0;
  const ok = (output: unknown): VisionResult => ({
    ok: true,
    output,
    costUsd: o.costUsd ?? 0.1,
    error: null,
  });
  return {
    family: o.family ?? "anthropic",
    model: o.model ?? "fake-model",
    calls,
    async call(c): Promise<VisionResult> {
      calls.push(c);
      if (c.prompt.startsWith("Interpret"))
        return ok({
          summary: "s",
          keyPatterns: [],
          oursSummary: "o",
          verdictText: "v",
          shortAnswer: "s",
          keyPoints: keyPointsIn(c.prompt).map((_, i) => `point ${i + 1}`),
        });
      if (c.prompt.startsWith("Write the recommendations") || c.prompt.startsWith("Revise")) {
        const m = /between (\d+) and/.exec(c.prompt);
        return ok(recommendations(Number(m?.[1] ?? 3)));
      }
      if (c.prompt.startsWith("Write the A/B tests")) return ok(abAnswer(c.prompt));
      if (c.prompt.startsWith("Review these")) {
        const findings = o.reviewSeverity
          ? [{ position: 1, severity: o.reviewSeverity, issue: "i", suggestion: "s" }]
          : [];
        return ok({ verdict: findings.length ? "changes" : "ok", findings });
      }
      if (c.images.length > 1 && bad > 0) {
        bad--;
        return ok({ images: [] });
      }
      if (c.prompt.startsWith("Settle")) {
        const decisions = c.images.map((i) => ({
          imageRef: i.ref,
          chosen: "first",
          ...o.read(i.image.localPath ?? ""),
          subtype: "",
          composition: "single_full_capture",
          marketingLayerPresent: true,
          reason: "test",
        }));
        return ok({ decisions });
      }
      const images = c.images.map((i) => {
        const r = o.read(i.image.localPath ?? "");
        return reading(i.ref, r.screenType, r.headline);
      });
      return ok({ images });
    },
  };
}

import type { Provider, VisionCall, VisionResult } from "../../src/analysis/providers.ts";
import type { ImageAnalysis } from "../../src/analysis/schema.ts";

export function reading(imageRef: string, screenType: string, headline: string): ImageAnalysis {
  return {
    imageRef,
    screenType,
    subtype: "",
    captureDescription: "test",
    hasMarketingLayer: true,
    composition: "full_bleed_capture",
    bands: [],
    headline,
    textBlocks: [],
    callouts: [],
    decorations: [],
    relationToScreen: "describes",
    occlusionPercent: 10,
    confidence: 0.9,
    notes: "",
  };
}

export interface FakeOptions {
  family?: Provider["family"];
  /** Screen type and headline per image path. */
  read: (path: string) => { screenType: string; headline: string };
  /** Make deck calls (more than one image) fail validation this many times. */
  badDeckCalls?: number;
  costUsd?: number;
}

/** A provider that answers from a lookup instead of calling a model. Records every call. */
export function fakeProvider(o: FakeOptions): Provider & { calls: VisionCall[] } {
  const calls: VisionCall[] = [];
  let bad = o.badDeckCalls ?? 0;
  return {
    family: o.family ?? "anthropic",
    model: "fake-model",
    calls,
    async call(c): Promise<VisionResult> {
      calls.push(c);
      if (c.images.length > 1 && bad > 0) {
        bad--;
        return { ok: true, output: { images: [] }, costUsd: o.costUsd ?? 0.1, error: null };
      }
      if (c.prompt.startsWith("Settle")) {
        const decisions = c.images.map((i) => ({
          imageRef: i.ref,
          chosen: "first",
          ...o.read(i.path),
          subtype: "",
          reason: "test",
        }));
        return { ok: true, output: { decisions }, costUsd: o.costUsd ?? 0.1, error: null };
      }
      const images = c.images.map((i) => {
        const r = o.read(i.path);
        return reading(i.ref, r.screenType, r.headline);
      });
      return { ok: true, output: { images }, costUsd: o.costUsd ?? 0.1, error: null };
    },
  };
}

import type { ImageAnalysis } from "../../src/analysis/schema.ts";
import type { Layout } from "../../src/layout/schema.ts";

/** A valid layout for a fake reading: one scene per capture, a band and a headline on top. */
export function fakeLayout(a: ImageAnalysis): Layout {
  const caps = a.screenshot.captures.length;
  const m = a.marketingLayer;
  const el = {
    tiltDeg: 0,
    textEn: null,
    note: "",
  };
  return {
    inGame: [
      {
        id: "S1",
        role: "main-scene",
        box: { x: 0, y: 10, w: 100, h: 85 },
        z: 0,
        capture: caps ? 0 : null,
        textRef: null,
        text: null,
        covers: [],
        ...el,
      },
    ],
    marketing: m.present
      ? [
          {
            id: "M1",
            role: "band",
            box: { x: 0, y: 0, w: 100, h: 15 },
            z: 0,
            capture: null,
            textRef: null,
            text: null,
            covers: ["S1"],
            ...el,
          },
          {
            id: "M2",
            role: "headline",
            box: { x: 5, y: 2, w: 90, h: 10 },
            z: 1,
            capture: null,
            textRef: m.texts.length ? 0 : null,
            text: null,
            covers: [],
            ...el,
            textEn: m.texts[0]?.text ?? null,
          },
        ]
      : [],
    composition: {
      focal: { x: 50, y: 7, id: m.present ? "M2" : "S1" },
      readingOrder: m.present ? ["M2", "S1"] : ["S1"],
      overlaySharePercent: m.present ? 15 : 0,
      summary: "A full capture with a band on top.",
      focus: { kind: "battle", words: "a boss fight" },
      marketingCovers: m.present ? "the top strip; the battle stays visible" : "",
      focusMatch: m.present
        ? { verdict: "match", reason: "the headline names the fight" }
        : { verdict: "no marketing layer", reason: "" },
    },
  };
}

/** A valid layout for the finished reading the layout call was given (its second line). */
export function layoutFor(prompt: string): Layout {
  const r = JSON.parse(prompt.split("\n")[1] ?? "{}") as {
    captures: unknown[];
    marketingLayer: { present: boolean; texts: { text: string }[] };
  };
  return fakeLayout({
    screenshot: { captures: r.captures },
    marketingLayer: r.marketingLayer,
  } as unknown as ImageAnalysis);
}

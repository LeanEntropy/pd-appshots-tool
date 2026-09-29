import type { CountryAdvice } from "../../src/analysis/country-advice-schema.ts";
import type { LayerDiff } from "../../src/analysis/layer-diff-schema.ts";
import type { Provider, VisionCall } from "../../src/analysis/providers.ts";
import { fakeProvider } from "./fake-provider.ts";

/**
 * A fake for every model of a country report's batch: the screenshot analysis (as the usual
 * fake), the text-layer comparison, the words-used grouping, the country advice, its second
 * opinion and the A/B tests. Records every call; no model is ever called.
 */
export interface ReportFakeOptions {
  /** The text comparison says the screen under the text is different. */
  differentScreen?: boolean;
  /** The local headline the text comparison reads. */
  local?: string;
  costUsd?: number;
}

function layerAnswer(prompt: string, o: ReportFakeOptions): LayerDiff {
  const json = prompt.split("\n").find((l) => l.startsWith("{")) ?? "{}";
  const anchor = JSON.parse(json) as { texts?: { role: string; text: string }[] };
  const local = o.local ?? "バトル開始";
  const texts = (anchor.texts ?? []).map((t, i) => ({
    role: t.role as LayerDiff["texts"][number]["role"],
    anchorText: t.text,
    localText: i === 0 ? local : t.text,
    backTranslation: i === 0 ? "battle start" : t.text,
    language: i === 0 ? "ja" : "en",
    change: (i === 0 ? "translated" : "kept") as LayerDiff["texts"][number]["change"],
    notes: "",
  }));
  return {
    sameScreen: !o.differentScreen,
    sameScreenReason: o.differentScreen ? "another screen" : "",
    texts: o.differentScreen ? [] : texts,
    genreTerms: [],
    band: { change: "none", colourName: "", colourHex: "unknown", notes: "" },
    elements: { change: "none", notes: "" },
    headline: o.differentScreen ? "" : (texts[0]?.localText ?? ""),
    wordingNotes: "",
  };
}

function conceptAnswer(prompt: string) {
  const texts = prompt
    .split("\n")
    .map((l) => /^\d+\. (.*)$/.exec(l)?.[1])
    .filter((t): t is string => !!t);
  const has = (w: string) => texts.some((t) => t.includes(w));
  const terms = ["バトル", "戦闘", "PLAY"].filter(has);
  const pick = terms.length ? terms : texts.slice(0, 1);
  return {
    concepts: [
      {
        id: "battle",
        label: "battle",
        gloss: "fighting",
        terms: pick.map((term) => ({ term, kind: "other", note: "" })),
      },
    ],
  };
}

function adviceAnswer(prompt: string): CountryAdvice {
  const m = /Recommend (\d+) to (\d+) images/.exec(prompt);
  const n = Number(m?.[1] ?? 1);
  const facts = prompt
    .split("\n")
    .map((l) => /^(C\d+): /.exec(l)?.[1])
    .filter((x): x is string => !!x);
  return {
    shortAnswer: "Translate the first image: most competitors here do.",
    actions: facts.length
      ? [
          {
            action: "Translate the headline of image 1",
            why: "most competitors here translate",
            evidence: [facts[0] as string],
            positions: [1],
            impact: "medium",
          },
        ]
      : [],
    deck: Array.from({ length: n }, (_, i) => ({
      position: i + 1,
      fromMainPosition: 0,
      change: "translate",
      screen: "the boss fight",
      headline: "バトル開始",
      backTranslation: "battle start",
      subline: "",
      band: "yellow band at the top",
      logo: { show: i === 0, why: "the opening image carries the logo" },
      wordingNotes: "",
      why: "most competitors translate",
    })),
    terms: [{ concept: "battle", use: "バトル", avoid: "", why: "the common word here" }],
    keepFromMain: "the order",
  };
}

export function reportFake(
  o: ReportFakeOptions = {},
): Provider & { calls: VisionCall[]; kinds: string[] } {
  const base = fakeProvider({
    read: () => ({ screenType: "gameplay", headline: "PLAY" }),
    costUsd: o.costUsd ?? 0.01,
  });
  const kinds: string[] = [];
  const ok = (output: unknown) => ({ ok: true, output, costUsd: o.costUsd ?? 0.01, error: null });
  return {
    family: "anthropic",
    model: "fake-model",
    calls: base.calls,
    kinds,
    async call(c: VisionCall) {
      const p = c.prompt;
      if (p.startsWith("Compare the marketing layer")) {
        kinds.push("layer");
        base.calls.push(c);
        // Like a model, it answers only what the schema asks (band and elements may be left out).
        const asked = (c.schema as { properties?: Record<string, unknown> }).properties ?? {};
        const { band, elements, ...rest } = layerAnswer(p, o);
        return ok({
          ...rest,
          ...("band" in asked ? { band } : {}),
          ...("elements" in asked ? { elements } : {}),
        });
      }
      if (p.startsWith("Group the words")) {
        kinds.push("concept");
        base.calls.push(c);
        return ok(conceptAnswer(p));
      }
      if (
        p.startsWith("Write the country advice") ||
        p.startsWith("Write the country advice again")
      ) {
        kinds.push("advice");
        base.calls.push(c);
        return ok(adviceAnswer(p));
      }
      if (p.startsWith("Review these country")) {
        kinds.push("advice-review");
        base.calls.push(c);
        return ok({ verdict: "ok", findings: [] });
      }
      kinds.push(p.startsWith("Write the A/B tests") ? "ab" : c.images.length ? "image" : "text");
      return base.call(c);
    },
  };
}

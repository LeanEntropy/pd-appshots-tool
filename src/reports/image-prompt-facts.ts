import { definitionOf } from "../analysis/categories.ts";
import type { CountryAdvice } from "../analysis/country-advice-schema.ts";
import { layerStructure } from "../analysis/layer-structure.ts";
import { isUsable, readRecord } from "../analysis/records.ts";
import type { OrderRow, ReportData } from "../analysis/report-data.ts";
import type { ImageAnalysis } from "../analysis/schema.ts";
import { logoOf, type Recommendations } from "../analysis/synthesis-schema.ts";
import type { ProjectPaths } from "../config/load.ts";
import { focusView } from "../layout/focus.ts";
import type { Layout } from "../layout/schema.ts";
import { layoutStatus, readOlderLayout } from "../layout/store.ts";
import type { ImageFacts, OursFacts, PromptSlot, SlotSpec } from "./image-prompt-types.ts";

/**
 * The facts of an image prompt, by code from the saved report data, analyses and layouts (no AI
 * call): what each competitor shows at a position, what ours is and what is wrong with it, and
 * the recommended spec (with the country's own line when the report wrote one).
 */
type RecPosition = Recommendations["positions"][number];
type AdviceRow = CountryAdvice["deck"][number];

const human = (s: string) => s.replace(/_/g, " ");
const labelOf = (d: ReportData) => (k: string) => d.labels?.[k] ?? human(k);

function layoutOf(paths: ProjectPaths, r: Parameters<typeof layoutStatus>[1]): Layout | null {
  try {
    const s = layoutStatus(paths, r);
    return (
      s.file?.layout ??
      (s.status === "outdated" ? (readOlderLayout(paths, r)?.file.layout ?? null) : null)
    );
  } catch {
    return null;
  }
}

const ART = new Set(["title_image", "loading_screen", "key_art", "feature_image"]);

/** Screenshot + layer / art + layer / plain art, and a landscape image holding portrait captures. */
export function structureOf(f: ImageAnalysis, orientation: string): string {
  const s = f.screenshot;
  const layer = f.marketingLayer.present;
  // A captured title or loading screen is art too (title screen / full-screen art is one category).
  if (
    s.composition === "pure_art" ||
    (s.composition === "single_full_capture" && ART.has(s.screenType))
  )
    return layer ? "art + marketing layer" : "full-screen art, no added layer";
  const banner =
    orientation === "landscape" && s.captures.some((c) => c.orientation === "portrait")
      ? " (a wide promotional banner holding portrait captures)"
      : "";
  const base =
    s.composition === "multiple_captures"
      ? `${s.captures.length} in-game screenshots in one image`
      : s.composition === "capture_in_marketing_art"
        ? "in-game screenshot placed inside marketing art"
        : "in-game screenshot";
  const plus = layer && s.composition !== "capture_in_marketing_art" ? " + marketing layer" : "";
  return `${base}${plus}${banner}`;
}

/** One image, described by code from its row, its analysis and its layout. */
export function imageFacts(paths: ProjectPaths, row: OrderRow, name: string): ImageFacts {
  const r = row.imageId ? readRecord(paths, row.imageId) : undefined;
  const f = isUsable(r) ? r.final : null;
  const layout = r && f ? layoutOf(paths, r) : null;
  const fv = layout && f ? focusView(layout, f) : null;
  const marketing = Array.isArray(layout?.marketing) ? layout.marketing : [];
  const head = f?.marketingLayer.texts.find((t) => t.role === "headline");
  const mask = f?.marketingLayer.backgroundMasks[0];
  const tilt = marketing.find((e) => e.role === "band" && Math.abs(e.tiltDeg) >= 2)?.tiltDeg ?? 0;
  const cut = marketing.find((e) => e.role === "cut-out");
  const side = (x: number) => (x < 33 ? "left" : x > 55 ? "right" : "centre");
  return {
    name,
    screen: row.screen || "not analysed yet",
    orientation: row.orientation,
    size: [
      r?.identity?.image
        ? `${r.identity.image.width} x ${r.identity.image.height} px`
        : (row.size?.replace("x", " x ").concat(" px") ?? ""),
      row.ratio && row.ratio !== "unknown" ? row.ratio : "",
    ]
      .filter(Boolean)
      .join(", "),
    // The report's layer structure (screenshot + layer / art + layer / all art), with how the
    // image holds its captures (multi-capture, banner) from the analysis.
    structure: f
      ? [
          definitionOf(layerStructure(f))?.label,
          /in one image|inside marketing art|banner/.test(structureOf(f, row.orientation))
            ? structureOf(f, row.orientation)
            : "",
        ]
          .filter(Boolean)
          .join(": ") || structureOf(f, row.orientation)
      : "",
    layout: row.composition,
    layer: row.layer,
    logo: row.logo ?? null,
    headline: row.headline,
    // A headline drawn on two lines is two boxes: their English is read in order.
    headlineEn: marketing
      .filter((e) => e.role === "headline" && e.textEn)
      .map((e) => e.textEn)
      .join(" "),
    headlineStyle: head ? `${head.size}, at the ${human(head.position)}` : "",
    headlineFont: head ? `${head.fontStyle}, ${head.colour}` : "",
    band: mask
      ? `${human(mask.shape)} (${mask.colourName}) at the ${mask.location}${tilt ? `, tilted ${Math.abs(Math.round(tilt))} degrees` : ""}`
      : "",
    cutOut: cut
      ? `cut-out ${cut.note || "character"} on the ${side(cut.box.x + cut.box.w / 2)}`
      : "",
    focus: fv?.focus ?? "",
    focusMatch: fv?.verdict ? fv.match : "",
    description: f?.screenshot.description ?? "",
  };
}

function oursFacts(paths: ProjectPaths, d: ReportData, row: OrderRow, name: string): OursFacts {
  const base = imageFacts(paths, row, name);
  const v = d.oursVs?.positions.find((x) => x.position === row.position);
  const issues = [
    ...(v && v.verdict !== "following" ? v.reasons : []),
    ...(/^mismatch/.test(base.focusMatch)
      ? [`The marketing message does not match what the screen shows (${base.focusMatch}).`]
      : []),
    ...(d.recProblems ?? []).filter((p) => p.startsWith(`position ${row.position}:`)),
  ];
  return {
    ...base,
    verdict: v ? `${v.verdict}${v.reasons.length ? ` (${v.reasons.join("; ")})` : ""}` : "",
    issues,
  };
}

export function specFromRec(p: RecPosition, label: (k: string) => string): SlotSpec {
  const s = p.screenshot;
  const m = p.marketingLayer;
  return {
    screen: `${label(p.screenType)}${p.subtype ? ` / ${label(p.subtype)}` : ""}`,
    screenType: p.screenType,
    source: p.source,
    orientation: s.orientation,
    whatToCapture: s.whatToCapture,
    action: s.action,
    atmosphere: s.atmosphere,
    mainColours: s.mainColours,
    layerPresent: m.present,
    layout: m.proportion,
    mask: [m.backgroundMask.shape, m.backgroundMask.colour, m.backgroundMask.location]
      .map((x) => x.trim().replace(/\.+$/, ""))
      .filter(Boolean)
      .join("; "),
    texts: m.texts.map((t) => ({
      role: t.role,
      text: t.text,
      style: `${t.size} ${t.fontStyle}; fill ${t.colour}; outline ${t.strokeColour}; at the ${human(t.position)}`,
    })),
    elements: m.elements.map((e) => `${e.what}, at ${e.position}, pose ${e.pose}, ${e.colour}`),
    logo: logoOf(p),
    why: p.why,
    local: null,
  };
}

/** A country deck row on top of the main deck's spec (or alone for a new picture). */
function specFromAdvice(
  a: AdviceRow,
  main: RecPosition | undefined,
  label: (k: string) => string,
): SlotSpec {
  const local = {
    headline: a.headline,
    english: a.backTranslation,
    subline: a.subline,
    band: a.band === "none" ? "" : a.band,
    notes: a.wordingNotes,
  };
  const base = main ? specFromRec(main, label) : null;
  const fresh = !base || a.change === "new-picture";
  return {
    ...(base ?? {
      screen: "a new picture for this country",
      screenType: "",
      source: "new capture",
      orientation: "portrait",
      action: "",
      atmosphere: "",
      mainColours: "",
      layerPresent: !!a.headline,
      layout: "",
      mask: a.band,
      texts: a.headline
        ? [{ role: "headline", text: a.backTranslation || a.headline, style: "" }]
        : [],
      elements: [],
      why: "",
    }),
    whatToCapture: fresh ? a.screen : (base?.whatToCapture ?? a.screen),
    logo: a.logo,
    why: [a.why, base?.why].filter(Boolean).join(" Main deck: "),
    local,
  };
}

export interface SlotInputs {
  advice?: CountryAdvice | null;
  /** The main country's recommendations (the base of a country's deck). */
  mainRecs?: Recommendations | null;
  /** Only these positions (the image page); default: the recommended deck. */
  positions?: number[];
}

/** One prompt slot per recommended position (or per asked position), in store order. */
export function promptSlots(paths: ProjectPaths, d: ReportData, x: SlotInputs = {}): PromptSlot[] {
  const label = labelOf(d);
  const recs = d.ai?.recommendations ?? null;
  const main = x.mainRecs ?? recs;
  const deck = x.advice?.deck ?? [];
  const ours = d.games.find((g) => g.ours);
  const positions =
    x.positions ??
    (deck.length
      ? deck.map((r) => r.position)
      : (recs?.positions.map((p) => p.position) ?? ours?.rows.map((r) => r.position) ?? []));
  return [...new Set(positions)]
    .sort((a, b) => a - b)
    .map((position) => {
      const a = deck.find((r) => r.position === position);
      const rec = recs?.positions.find((p) => p.position === position);
      const spec = a
        ? specFromAdvice(
            a,
            main?.positions.find((p) => p.position === a.fromMainPosition),
            label,
          )
        : rec
          ? specFromRec(rec, label)
          : null;
      const competitors = d.games
        .filter((g) => !g.ours)
        .flatMap((g) => {
          const row = g.rows.find((r) => r.position === position);
          return row?.imageId && row.state !== "excluded" ? [imageFacts(paths, row, g.name)] : [];
        });
      const our = ours?.rows.find((r) => r.position === position);
      const o = our ? oursFacts(paths, d, our, ours?.name ?? "ours") : null;
      if (o) o.issues.push(...formatGaps(o, competitors));
      return { position, competitors, ours: o, spec };
    });
}

/**
 * Orientation and layer structure against most competitors here (user, 2026-10-29: such a
 * difference is always said, never read as "following").
 */
function formatGaps(o: ImageFacts, cs: readonly ImageFacts[]): string[] {
  const out: string[] = [];
  for (const [what, key] of [
    ["Orientation", "orientation"],
    ["Layer structure", "structure"],
  ] as const) {
    const vals = cs.map((c) => c[key]).filter(Boolean);
    const n = new Map<string, number>();
    for (const v of vals) n.set(v, (n.get(v) ?? 0) + 1);
    const [top, count] = [...n].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    if (o[key] && top && count * 2 > vals.length && o[key] !== top)
      out.push(
        `${what} differs: ${count} of ${vals.length} competitors use ${top} here; ours is ${o[key]}.`,
      );
  }
  return out;
}

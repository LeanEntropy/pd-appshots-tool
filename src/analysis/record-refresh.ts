import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { ImageDb } from "../store/imagedb.ts";
import { normaliseText } from "./compare.ts";
import { type ImageIdentity, identityBuilder } from "./identity.ts";
import { type ImageFacts, imageFacts } from "./image-facts.ts";
import { type AnalysisRecord, readRecords, writeRecord } from "./records.ts";
import type { ImageAnalysis } from "./schema.ts";

/**
 * Deterministic taxonomy mapping, versioned apart from the analysis schema: old "key art"
 * readings become the user's terms when the evidence is clear, and a title image counts as the
 * in-game title screen (user, 2026-09-28), without any model call.
 */
export const TAXONOMY_MAPPING = "key-art-title-screen.v3";

export interface MappedFrom {
  /** The model's original classification, kept so a newer mapping can start from it. */
  screenType: string;
  subtype: string;
  rule: string;
  /** The model's own composition and captures, when a mapping changed them. */
  original?: Pick<ImageAnalysis["screenshot"], "composition" | "captures" | "captureAreaPercent">;
}

/** key_art with no in-game capture: logo or game title → title image; other callout text → feature image. */
export function mapKeyArt(
  a: ImageAnalysis,
  game: string,
): { final: ImageAnalysis; mappedFrom: MappedFrom | null } {
  const s = a.screenshot;
  const m = a.marketingLayer;
  if (s.screenType !== "key_art") return { final: a, mappedFrom: null };
  const noCapture = s.captures.length === 0 || s.composition === "pure_art";
  if (!noCapture) return { final: a, mappedFrom: null };
  const title = normaliseText(game);
  // Only the game's own logo or title counts (not a publisher or partner logo).
  const names = (x: string) => !!title && normaliseText(x).includes(title);
  const logo =
    s.subtype === "title_logo" ||
    m.elements.some(
      (e) => e.kind === "logo" && (names(e.what) || /game (logo|title)/i.test(e.what)),
    ) ||
    m.texts.some((t) => names(t.text));
  const to = (screenType: string, subtype: string, rule: string) => ({
    final: {
      ...a,
      screenshot: { ...s, screenType, subtype },
    },
    mappedFrom: { screenType: s.screenType, subtype: s.subtype, rule },
  });
  if (logo)
    return to(
      "title_image",
      "logo_with_art",
      `${TAXONOMY_MAPPING}: no capture, shows the game logo or title`,
    );
  if (m.texts.length) {
    const sub = s.subtype === "character_showcase" ? "character_showcase" : "feature_callout";
    return to(
      "feature_image",
      sub,
      `${TAXONOMY_MAPPING}: no capture, callout text without the logo`,
    );
  }
  return { final: a, mappedFrom: null };
}

/**
 * A title image is usually the in-game title screen shown when the game opens: it becomes one
 * full in-game capture of type title_image (subtype title_screen) instead of pure art.
 */
export function mapTitleScreen(
  a: ImageAnalysis,
  orientation: "portrait" | "landscape" | "square",
): { final: ImageAnalysis; mappedFrom: MappedFrom | null } {
  const s = a.screenshot;
  if (s.screenType !== "title_image" || s.subtype === "title_screen")
    return { final: a, mappedFrom: null };
  const own = s.captures.length === 1 && s.captures[0]?.screenType === "title_image";
  if (s.composition !== "pure_art" && !own) return { final: a, mappedFrom: null };
  // A title capture the model already saw keeps its own framing, area and composition.
  const screenshot = own
    ? {
        ...s,
        subtype: "title_screen",
        captures: [{ ...(s.captures[0] as (typeof s.captures)[number]), subtype: "title_screen" }],
      }
    : {
        ...s,
        subtype: "title_screen",
        composition: "single_full_capture" as const,
        captureAreaPercent: 100,
        captures: [
          {
            orientation,
            screenType: "title_image",
            subtype: "title_screen",
            region: { x: 0, y: 0, w: 100, h: 100 },
            areaPercent: 100,
            framing: "full_bleed" as const,
            description: "the in-game title screen (a title image counts as an in-game screen)",
          },
        ],
      };
  return {
    final: { ...a, screenshot },
    mappedFrom: {
      screenType: s.screenType,
      subtype: s.subtype,
      rule: `${TAXONOMY_MAPPING}: a title image counts as the in-game title screen`,
      original: {
        composition: s.composition,
        captures: s.captures,
        captureAreaPercent: s.captureAreaPercent,
      },
    },
  };
}

/** Adds the identity block and the taxonomy mapping. Idempotent; called on every write. */
export function refreshRecord(
  r: AnalysisRecord,
  identityOf: (r: AnalysisRecord, facts: ImageFacts | null) => ImageIdentity,
  taxonomy: string,
  facts: ImageFacts | null = null,
): AnalysisRecord {
  const identity = identityOf(r, facts);
  const out: AnalysisRecord = { ...r, identity, taxonomy, mapping: TAXONOMY_MAPPING };
  if (!r.final || (r.mappedFrom && r.mapping === TAXONOMY_MAPPING)) return out;
  // Start from the model's own classification, so a changed mapping is applied afresh.
  const base: ImageAnalysis = r.mappedFrom
    ? {
        ...r.final,
        screenshot: {
          ...r.final.screenshot,
          ...(r.mappedFrom.original ?? {}),
          screenType: r.mappedFrom.screenType,
          subtype: r.mappedFrom.subtype,
        },
      }
    : r.final;
  const m = mapKeyArt(base, identity.game);
  const t = mapTitleScreen(
    m.final,
    identity.image?.orientation ?? facts?.orientation ?? "portrait",
  );
  const mappedFrom = m.mappedFrom
    ? t.mappedFrom
      ? {
          ...m.mappedFrom,
          rule: `${m.mappedFrom.rule}; ${t.mappedFrom.rule}`,
          original: t.mappedFrom.original,
        }
      : m.mappedFrom
    : t.mappedFrom;
  return { ...out, final: t.final, mappedFrom };
}

/** Record writer that refreshes identity and mapping first (shared lookups for a whole run). */
export function recordWriter(loaded: LoadedConfig, db?: ImageDb) {
  const paths = projectPaths(loaded);
  const t = loadTaxonomy(loaded).taxonomy;
  const store = db ?? ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);
  const identityOf = identityBuilder(paths, store, loaded.config);
  return async (r: AnalysisRecord): Promise<AnalysisRecord> => {
    const facts = await imageFacts(paths, store, r.imageId);
    const out = refreshRecord(r, identityOf, `${t.id}@${t.version}`, facts);
    writeRecord(paths, out);
    return out;
  };
}

/** Backfill: rewrites every saved record with its identity and mapping. No AI call. */
export async function refreshAllRecords(
  loaded: LoadedConfig,
): Promise<{ records: number; mapped: string[] }> {
  const write = recordWriter(loaded);
  const mapped: string[] = [];
  let n = 0;
  for (const r of readRecords(projectPaths(loaded)).values()) {
    const out = await write(r);
    n++;
    if (out.mappedFrom && !r.mappedFrom)
      mapped.push(
        `${out.identity?.game} #${out.position}: ${out.mappedFrom.screenType} → ${out.final?.screenshot.screenType}`,
      );
  }
  return { records: n, mapped };
}

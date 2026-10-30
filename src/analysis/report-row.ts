import type { DeckManifest } from "../store/manifest.ts";
import { asCounted } from "./categories.ts";
import { orientationOf, ratioLabel } from "./image-facts.ts";
import type { ArtMessage } from "./image-tags.ts";
import { COMPOSITION, captureLines } from "./info-text.ts";
import { layerStructure } from "./layer-structure.ts";
import { isUsable } from "./records.ts";
import type { ReportInputs } from "./report-data.ts";
import { rowTags } from "./report-sorting.ts";

/** One store position of one game, exactly as Google Play shows it. */
export interface OrderRow {
  position: number;
  imageId: string | null;
  thumb: string | null;
  file: string | null;
  screen: string;
  screenType: string | null;
  /** Report category (categories.ts) and tags; absent in reports saved before 2026-09-29. */
  category?: string | null;
  logo?: boolean | null;
  message?: ArtMessage | null;
  headline: string;
  orientation: string;
  /** Pixel ratio and layer structure (absent in reports saved before 2026-10-30). */
  ratio?: string;
  size?: string;
  layerStructure?: string | null;
  composition: string;
  captures: string[];
  layer: boolean | null;
  /** analysed | not double-checked | not analysed | excluded */
  state: string;
  note: string;
  repeatOf?: number;
}

/** One row of a game's order (report-data.ts). */
export function row(
  x: ReportInputs,
  slot: DeckManifest["slots"][number],
  excluded: string | null,
  game: string,
) {
  const id = slot.imageId;
  const img = id ? x.db.get(id) : undefined;
  const r = id ? x.records.get(id) : undefined;
  const f = isUsable(r) ? r.final : null;
  const c = f ? asCounted(f) : null;
  const state = excluded
    ? "excluded"
    : f
      ? r?.status === "unreviewed"
        ? "not double-checked"
        : "analysed"
      : "not analysed";
  const t = rowTags(f, game, x.label);
  const out: OrderRow = {
    position: slot.position,
    imageId: id,
    thumb: img?.thumb ?? null,
    file: img?.file ?? null,
    screen: t.screen,
    // The taxonomy type (a banner keeps the model's); `category` says it is a banner.
    screenType: r?.banner?.from.screenType ?? f?.screenshot.screenType ?? null,
    category: t.category,
    logo: t.logo,
    message: t.message,
    headline: f?.headline ?? "",
    orientation: orientationOf(slot.width, slot.height),
    ratio: ratioLabel(slot.width, slot.height),
    ...(slot.width && slot.height ? { size: `${slot.width}x${slot.height}` } : {}),
    layerStructure: f ? layerStructure(f) : null,
    composition: c
      ? (COMPOSITION[c.screenshot.composition] ?? x.label(c.screenshot.composition))
      : "",
    captures: c ? captureLines(c, r?.identity?.image, x.label) : [],
    layer: f ? f.marketingLayer.present : null,
    state,
    note: excluded ?? (f ? "" : r ? `${r.status}: ${r.problems.join("; ")}` : "not analysed yet"),
  };
  return out;
}

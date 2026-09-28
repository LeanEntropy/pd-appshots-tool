import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ProjectPaths } from "../config/load.ts";
import type { DeckManifest } from "../store/manifest.ts";
import { readJson, readJsonIfExists, safeName, writeJsonAtomic } from "../util/fsx.ts";
import { type Labeler, plainLabel } from "./labels.ts";
import { type AnalysisRecord, isUsable } from "./records.ts";
import { SCHEMA_VERSION } from "./schema.ts";

export interface OrderPosition {
  position: number;
  imageId: string | null;
  device: string;
}

export interface DerivedPosition {
  position: number;
  screenType: string | null;
  subtype: string;
  /** The image's own orientation, from its pixel size. */
  orientation: string | null;
  /** Composition, and each in-game capture's orientation as read by the model. */
  composition: string | null;
  captureOrientations: string[];
  marketingLayer: boolean | null;
}

/**
 * Store order of one game in one market on one date. The raw order (what the store showed) is
 * written before any analysis; the derived screen types are added separately as they complete.
 */
export interface OrderSnapshot {
  appId: string;
  name: string;
  gl: string;
  hl: string;
  date: string;
  fetchedAt: string;
  positions: OrderPosition[];
  derived: {
    schema: string;
    complete: boolean;
    updatedAt: string;
    positions: DerivedPosition[];
  } | null;
}

function orderDir(paths: ProjectPaths, appId: string, gl: string, hl: string): string {
  return join(paths.orders, safeName(appId), `${gl}-${safeName(hl)}`);
}

export function orderFile(
  paths: ProjectPaths,
  s: Pick<OrderSnapshot, "appId" | "gl" | "hl" | "date">,
) {
  return join(orderDir(paths, s.appId, s.gl, s.hl), `${s.date}.json`);
}

/** Writes the raw order for the deck's fetch date. Keeps derived data if the order is unchanged. */
export function snapshotOrder(
  paths: ProjectPaths,
  deck: DeckManifest,
  name: string,
): OrderSnapshot {
  const date = (deck.fetchedAt || new Date().toISOString()).slice(0, 10);
  const positions = deck.slots.map((s) => ({
    position: s.position,
    imageId: s.imageId,
    device: s.deviceClass,
  }));
  const file = orderFile(paths, { appId: deck.appId, gl: deck.gl, hl: deck.hl, date });
  const old = readJsonIfExists(file) as OrderSnapshot | undefined;
  const same = old && JSON.stringify(old.positions) === JSON.stringify(positions);
  const snap: OrderSnapshot = {
    appId: deck.appId,
    name,
    gl: deck.gl,
    hl: deck.hl,
    date,
    fetchedAt: deck.fetchedAt,
    positions,
    derived: same ? old.derived : null,
  };
  writeJsonAtomic(file, snap);
  return snap;
}

/** Adds screen types from the analysis records; complete when every position has a reading. */
export function enrichOrder(
  paths: ProjectPaths,
  snap: OrderSnapshot,
  records: ReadonlyMap<string, AnalysisRecord>,
): OrderSnapshot {
  const positions = snap.positions.map((p) => {
    const r = p.imageId ? records.get(p.imageId) : undefined;
    const f = isUsable(r) ? r.final : null;
    return {
      position: p.position,
      screenType: f?.screenshot.screenType ?? null,
      subtype: f?.screenshot.subtype ?? "",
      orientation: r?.identity?.image?.orientation ?? null,
      composition: f?.screenshot.composition ?? null,
      captureOrientations: f?.screenshot.captures.map((c) => c.orientation) ?? [],
      marketingLayer: f ? f.marketingLayer.present : null,
    };
  });
  const out: OrderSnapshot = {
    ...snap,
    derived: {
      schema: SCHEMA_VERSION,
      complete: positions.every((p) => p.screenType !== null),
      updatedAt: new Date().toISOString(),
      positions,
    },
  };
  writeJsonAtomic(orderFile(paths, snap), out);
  return out;
}

/** All saved snapshots of a game in a market, oldest first. */
export function orderHistory(paths: ProjectPaths, appId: string, gl: string, hl: string) {
  const dir = orderDir(paths, appId, gl, hl);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => readJson(join(dir, f)) as OrderSnapshot);
}

/** The date of the newest saved store order (YYYY-MM-DD), without reading the files; null if none. */
export function latestOrderDate(paths: ProjectPaths, appId: string, gl: string, hl: string) {
  const dir = orderDir(paths, appId, gl, hl);
  if (!existsSync(dir)) return null;
  const last = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .at(-1);
  return last ? last.slice(0, 10) : null;
}

/** Plain-language differences between two snapshots of the same deck. */
export function compareOrders(
  before: OrderSnapshot,
  after: OrderSnapshot,
  label: Labeler = plainLabel,
): string[] {
  const out: string[] = [];
  const pos = (s: OrderSnapshot, id: string | null) =>
    s.positions.find((p) => p.imageId === id)?.position;
  const typeAt = (s: OrderSnapshot, n: number) => {
    const t = s.derived?.positions.find((p) => p.position === n)?.screenType;
    return t ? label(t) : null;
  };
  for (const p of after.positions) {
    const was = pos(before, p.imageId);
    const now = typeAt(after, p.position);
    if (was === undefined) {
      const old = typeAt(before, p.position);
      out.push(
        `position ${p.position}: new image${now ? ` (${now}${old && old !== now ? `, was ${old}` : ""})` : ""}`,
      );
      continue;
    }
    if (was !== p.position) out.push(`image moved from position ${was} to ${p.position}`);
    const then = typeAt(before, was);
    if (then && now && then !== now)
      out.push(`image at position ${p.position} reclassified: ${then} to ${now}`);
  }
  for (const p of before.positions)
    if (pos(after, p.imageId) === undefined)
      out.push(`image at position ${p.position} was removed`);
  if (before.positions.length !== after.positions.length)
    out.push(`deck length ${before.positions.length} became ${after.positions.length}`);
  return out;
}

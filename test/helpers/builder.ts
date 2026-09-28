import { readFileSync } from "node:fs";
import sharp from "sharp";
import { writeRecord } from "../../src/analysis/records.ts";
import { SCHEMA_VERSION } from "../../src/analysis/schema.ts";
import { type LoadedConfig, projectPaths } from "../../src/config/load.ts";
import { savePick } from "../../src/core/selection.ts";
import { mainMarketRef } from "../../src/reports/main-market.ts";
import { syncPresetReports } from "../../src/reports/migrate.ts";
import { versionFileKey } from "../../src/reports/store.ts";
import { workspaceStorage } from "../../src/storage/index.ts";
import { openImageDb } from "../../src/store/imagedb.ts";
import { type DeckManifest, type DeckSlot, readDeck, writeDeck } from "../../src/store/manifest.ts";
import { reading } from "./fake-provider.ts";
import { picture, tempProject } from "./project.ts";

export const PICK = ["Capybara Go", "Mini Tales", "Heroll", "Archero 2", "Dicero"];

/** A project with US decks for ours (3) and five picked competitors (2 or 3 images each). */
export async function builderProject(): Promise<LoadedConfig> {
  const loaded = await tempProject({
    "Capybara Go": { phone: 3, tablet: 0 },
    "Mini Tales": { phone: 2, tablet: 0 },
    Heroll: { phone: 2, tablet: 0 },
    "Archero 2": { phone: 2, tablet: 0 },
    Dicero: { phone: 2, tablet: 0 },
    "Legend of Slime": { phone: 2, tablet: 0 },
  });
  savePick(loaded, idsOf(loaded, PICK), "cli");
  return loaded;
}

export const idsOf = (loaded: LoadedConfig, names: string[]) =>
  names.map((n) => loaded.config.competitors.find((c) => c.name === n)?.id ?? n);
export const idOf = (loaded: LoadedConfig, name: string) =>
  name === loaded.config.ourApp.name
    ? loaded.config.ourApp.id
    : (idsOf(loaded, [name])[0] as string);

/** The bytes of a game's US image at a position. */
export function usBytes(loaded: LoadedConfig, appId: string, position: number): Buffer {
  const paths = projectPaths(loaded);
  const d = readDeck(paths.decks, { appId, gl: "us", hl: "en" });
  const id = d?.slots.find((s) => s.position === position)?.imageId as string;
  const db = openImageDb(paths);
  return readFileSync(db.abs(db.get(id)?.file as string));
}

/** The same picture with a small change (a new text layer): other bytes, same perceptual hash. */
export async function newText(buf: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) data[(y * info.width + x) * info.channels] = 255;
  return sharp(data, { raw: info }).png().toBuffer();
}

export { picture };

/** Adds a deck in another country: images given as bytes, or "unavailable" (not sold there). */
export async function addDeck(
  loaded: LoadedConfig,
  name: string,
  gl: string,
  hl: string,
  images: Buffer[] | "unavailable",
  group: "ours" | "named" | "chart" = "named",
  chartRanks: Record<string, number> = {},
): Promise<void> {
  const paths = projectPaths(loaded);
  const appId = idOf(loaded, name);
  const db = openImageDb(paths);
  const slots: DeckSlot[] = [];
  for (const [i, img] of (images === "unavailable" ? [] : images).entries()) {
    const { record } = await db.ingest(
      img,
      { appId, gl, hl, position: i + 1 },
      `${appId}-${gl}-${i}`,
    );
    slots.push({
      position: i + 1,
      googleId: `${appId}-${gl}-${i}`,
      imageId: record.id,
      width: record.width,
      height: record.height,
      deviceClass: record.deviceClass,
      deviceConfidence: record.deviceConfidence,
      orientation: record.orientation,
    });
  }
  db.save();
  const d: DeckManifest = {
    appId,
    name,
    group,
    tier: group === "ours" ? "ours" : group === "chart" ? "chart" : "direct",
    gl,
    hl,
    chartRanks,
    status: images === "unavailable" ? "unavailable" : "ok",
    title: name,
    rawCount: slots.length,
    deckLength: slots.length,
    deviceMix: { phone: slots.length, tablet: 0, unknown: 0 },
    slots,
    fetchedAt: new Date().toISOString(),
  };
  writeDeck(paths.decks, d);
}

/** Usable analyses for every image of these games' decks in one country. */
export function analyse(loaded: LoadedConfig, names: string[], gl = "us", hl = "en"): void {
  const paths = projectPaths(loaded);
  for (const name of names) {
    const appId = idOf(loaded, name);
    for (const s of readDeck(paths.decks, { appId, gl, hl })?.slots ?? []) {
      if (!s.imageId) continue;
      writeRecord(paths, {
        imageId: s.imageId,
        schema: SCHEMA_VERSION,
        appId,
        gl,
        hl,
        position: s.position,
        status: "ok",
        final: reading(s.imageId, s.position === 1 ? "title_screen" : "gameplay_battle", "PLAY"),
        producer: null,
        reviewer: null,
        adjudication: null,
        differences: [],
        problems: [],
        runId: "2026-09-27T10-00-00-000Z-pilot",
        updatedAt: "2026-09-27T10:00:00.000Z",
      });
    }
  }
}

/** A Ready Pilot (or Full check) version with its recommendations (decision D1). */
export function readyReport(loaded: LoadedConfig, stage: "pilot" | "core"): void {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const run = `2026-09-27T1${stage === "pilot" ? 0 : 1}-00-00-000Z-${stage}`;
  s.putText(versionFileKey(paths, run, "report.md"), "# Report\n");
  s.putJson(versionFileKey(paths, run, "recommendations.json"), { positions: [] });
  syncPresetReports(s, paths, mainMarketRef(loaded));
}

export const TOKEN = "builder-token";
export const headers = { "Content-Type": "application/json", "X-SSR-Token": TOKEN };

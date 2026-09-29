import { join } from "node:path";
import { appleManifest, isAppleDecksDir, readAppleDeckFile } from "../appstore/platform.ts";
import type { DeckTarget } from "../core/targets.ts";
import { type DeviceClass, withDeckDeviceClasses } from "../play/screenshots.ts";
import { readJsonIfExists, safeName, writeJsonAtomic, writeJsonOnce } from "../util/fsx.ts";
import { stableHash } from "../util/hash.ts";

export interface DeckSlot {
  /** 1-based store position (store array order, never inferred). */
  position: number;
  googleId: string;
  /** Content id (sha256) in the project image database; null if the download failed. */
  imageId: string | null;
  width: number;
  height: number;
  deviceClass: DeviceClass;
  deviceConfidence: number;
  orientation: string;
}

export interface DeckManifest extends DeckTarget {
  status: "ok" | "unavailable" | "error";
  title?: string;
  /** Scraper array length before removing repeats. */
  rawCount: number;
  deckLength: number;
  deviceMix: Record<DeviceClass, number>;
  slots: DeckSlot[];
  fetchedAt: string;
  error?: string;
}

export function deckPath(decksDir: string, t: { appId: string; gl: string; hl: string }): string {
  return join(decksDir, safeName(t.appId), `${t.gl}-${safeName(t.hl)}.json`);
}

export function writeDeck(decksDir: string, deck: DeckManifest): string {
  writeJsonAtomic(deckPath(decksDir, deck), deck);
  return stableHash(deck);
}

export function readDeck(
  decksDir: string,
  t: { appId: string; gl: string; hl: string },
): DeckManifest | undefined {
  // The App Store view of the project (appstore/platform.ts): its own deck files, same shape.
  if (isAppleDecksDir(decksDir)) {
    const a = readAppleDeckFile(decksDir, t);
    return a && appleManifest(a);
  }
  const d = readJsonIfExists(deckPath(decksDir, t)) as DeckManifest | undefined;
  return d && withDeckClasses(d);
}

/** Device classes are decided per deck (phone set first, tablet sets appended), on every read. */
export function withDeckClasses(d: DeckManifest): DeckManifest {
  const slots = withDeckDeviceClasses(d.slots ?? []);
  const deviceMix = { phone: 0, tablet: 0, unknown: 0 };
  for (const s of slots) deviceMix[s.deviceClass]++;
  return { ...d, slots, deviceMix };
}

export interface RunManifest {
  runId: string;
  kind: "setup-download";
  createdAt: string;
  configPath: string;
  configHash: string;
  taxonomyHash: string;
  planHash: string;
  aiCalls: 0;
  imageCount: number;
  /** Full deck manifests at the time of the run, so any past view can be rebuilt. */
  decks: DeckManifest[];
  deckHashes: Record<string, string>;
  /** Deck keys downloaded by this run when it added to an earlier run's decks (plan 6.3). */
  added?: string[];
}

export function newRunId(kind: string, now = new Date()): string {
  return `${now.toISOString().replace(/[:.]/g, "-")}-${kind}`;
}

/** Immutable: fails if a manifest with this run id already exists. */
export function writeRunManifest(runsDir: string, m: RunManifest): string {
  const path = join(runsDir, m.runId, "manifest.json");
  writeJsonOnce(path, m);
  return path;
}

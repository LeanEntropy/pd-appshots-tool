import { join } from "node:path";
import type { DeckTarget } from "../core/targets.ts";
import type { DeviceClass } from "../play/screenshots.ts";
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
  return readJsonIfExists(deckPath(decksDir, t)) as DeckManifest | undefined;
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

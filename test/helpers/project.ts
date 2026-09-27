import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { type LoadedConfig, loadConfig, projectPaths } from "../../src/config/load.ts";
import { ImageDb } from "../../src/store/imagedb.ts";
import {
  type DeckManifest,
  type DeckSlot,
  newRunId,
  writeDeck,
  writeRunManifest,
} from "../../src/store/manifest.ts";

const REPO = join(import.meta.dirname, "..", "..");

/** A distinct small picture per seed (phone or tablet shape). */
export function picture(seed: number, tablet = false): Promise<Buffer> {
  const [w, h] = tablet ? [120, 160] : [90, 160];
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * (seed + 3) + seed * 97) % 251;
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  // Tablet pictures get a real iPad store size, so they are recognised as an appended iPad set.
  return (tablet ? img.resize(1536, 2048, { kernel: "nearest" }) : img).png().toBuffer();
}

/**
 * Temporary project: the Rogue Legend config with a temp workspace and US decks. Ours has 3
 * phone images; each listed competitor has the given phone and tablet counts.
 */
export async function tempProject(
  decks: Record<string, { phone: number; tablet: number }>,
): Promise<LoadedConfig> {
  const root = mkdtempSync(join(tmpdir(), "ssr-proj-"));
  mkdirSync(join(root, "configs"));
  cpSync(join(REPO, "prompts"), join(root, "prompts"), { recursive: true });
  cpSync(join(REPO, "taxonomies"), join(root, "taxonomies"), { recursive: true });
  const cfg: unknown = JSON.parse(
    readFileSync(join(REPO, "test", "fixtures", "config.json"), "utf8"),
  );
  writeFileSync(join(root, "configs", "t.json"), JSON.stringify(cfg));
  const loaded = loadConfig(join(root, "configs", "t.json"));
  const paths = projectPaths(loaded);
  const db = ImageDb.open(paths.imageDb, paths.imagesOrig, paths.imagesThumb);
  const all: DeckManifest[] = [];
  let seed = 1;
  const add = async (
    appId: string,
    name: string,
    group: "ours" | "named",
    phone: number,
    tablet: number,
  ) => {
    const slots: DeckSlot[] = [];
    for (let i = 0; i < phone + tablet; i++) {
      const img = await picture(seed++, i >= phone);
      const { record } = await db.ingest(
        img,
        { appId, gl: "us", hl: "en", position: i + 1 },
        `${appId}-${i}`,
      );
      slots.push({
        position: i + 1,
        googleId: `${appId}-${i}`,
        imageId: record.id,
        width: record.width,
        height: record.height,
        deviceClass: record.deviceClass,
        deviceConfidence: record.deviceConfidence,
        orientation: record.orientation,
      });
    }
    const d: DeckManifest = {
      appId,
      name,
      group,
      tier: group === "ours" ? "ours" : "direct",
      gl: "us",
      hl: "en",
      chartRanks: {},
      status: "ok",
      title: name,
      rawCount: slots.length,
      deckLength: slots.length,
      deviceMix: { phone, tablet, unknown: 0 },
      slots,
      fetchedAt: "",
    };
    writeDeck(paths.decks, d);
    all.push(d);
  };
  await add(loaded.config.ourApp.id, loaded.config.ourApp.name, "ours", 3, 0);
  for (const c of loaded.config.competitors) {
    const spec = decks[c.name];
    if (spec) await add(c.id, c.name, "named", spec.phone, spec.tablet);
  }
  db.save();
  writeRunManifest(paths.runs, {
    runId: newRunId("setup"),
    kind: "setup-download",
    createdAt: "",
    configPath: "",
    configHash: "",
    taxonomyHash: "",
    planHash: "",
    aiCalls: 0,
    imageCount: db.size,
    decks: all,
    deckHashes: {},
  });
  return loaded;
}

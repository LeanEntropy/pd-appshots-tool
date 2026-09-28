import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import sharp from "sharp";
import { fromRoot, type LoadedConfig, projectPaths } from "../config/load.ts";
import { baselineMarket } from "../core/targets.ts";
import { describeImage, hamming, type ImageFacts, NEAR_IDENTICAL_BITS } from "../store/identity.ts";
import { openImageDb } from "../store/imagedb.ts";
import { readDeck } from "../store/manifest.ts";
import { ensureDir, writeJsonAtomic } from "../util/fsx.ts";
import { findPsdPython, run } from "../util/proc.ts";

/** Provisional: up to this many differing bits (of 64) is reported as "possibly the same capture". */
export const POSSIBLE_CAPTURE_BITS = 16;

export type LocalMatch = "identical" | "near-identical" | "possibly-same-capture" | "no-match";

export interface LocalFileMatch {
  file: string;
  facts: ImageFacts;
  thumb: string;
  bestLivePosition: number | null;
  bestDistance: number | null;
  match: LocalMatch;
}

export function matchVerdict(sameBytes: boolean, distance: number): LocalMatch {
  if (sameBytes) return "identical";
  if (distance <= NEAR_IDENTICAL_BITS) return "near-identical";
  if (distance <= POSSIBLE_CAPTURE_BITS) return "possibly-same-capture";
  return "no-match";
}

function listImages(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listImages(p));
    else if ([".jpg", ".jpeg", ".png", ".webp"].includes(extname(name).toLowerCase())) out.push(p);
  }
  return out.sort();
}

export async function runOwnAssets(loaded: LoadedConfig, log: (s: string) => void): Promise<void> {
  const { config } = loaded;
  const own = config.ownAssets;
  if (!own) {
    log("Our own screenshots are not set up for this project (nothing to match).");
    return;
  }
  const paths = projectPaths(loaded);
  const base = baselineMarket(config);
  const live = readDeck(paths.decks, { appId: config.ourApp.id, gl: base.gl, hl: base.hl });
  if (live?.status !== "ok") {
    throw new Error("Our live store deck is not downloaded yet. Run the download step first.");
  }
  const db = openImageDb(paths);
  const liveImages = live.slots
    .map((s) => ({ position: s.position, rec: s.imageId ? db.get(s.imageId) : undefined }))
    .filter((x): x is { position: number; rec: NonNullable<typeof x.rec> } => !!x.rec);
  log(`Our live deck: ${live.deckLength} screenshots (${base.label}).`);

  const assetsDir = fromRoot(loaded, own.dir);
  const thumbDir = join(paths.own, "thumbs");
  ensureDir(thumbDir);
  const locals: LocalFileMatch[] = [];
  for (const file of existsSync(assetsDir) ? listImages(assetsDir) : []) {
    const buf = readFileSync(file);
    const facts = await describeImage(buf);
    const thumb = join(thumbDir, `${facts.sha256}.webp`);
    if (!existsSync(thumb))
      await sharp(buf).resize({ width: 240 }).webp({ quality: 80 }).toFile(thumb);
    let best: { position: number; distance: number; same: boolean } | null = null;
    for (const l of liveImages) {
      const d = hamming(facts.phash, l.rec.phash);
      const same = facts.sha256 === l.rec.sha256;
      if (!best || same || d < best.distance)
        best = { position: l.position, distance: same ? 0 : d, same };
      if (same) break;
    }
    locals.push({
      file: relative(loaded.root, file).split("\\").join("/"),
      facts,
      thumb: relative(paths.own, thumb).split("\\").join("/"),
      bestLivePosition: best?.position ?? null,
      bestDistance: best?.distance ?? null,
      match: best ? matchVerdict(best.same, best.distance) : "no-match",
    });
  }
  const n = (m: LocalMatch) => locals.filter((l) => l.match === m).length;
  log(
    `Local files: ${locals.length} found. Same as a live screenshot: ${n("identical") + n("near-identical")}. Possibly the same capture (unconfirmed): ${n("possibly-same-capture")}. No match: ${n("no-match")}. All are reference only, not counted or analysed.`,
  );

  let psd: { status: "read" | "skipped" | "failed"; detail: string; file?: string } = {
    status: "skipped",
    detail: "no PSD configured",
  };
  if (own.psd) {
    const psdFile = join(assetsDir, own.psd);
    const py = await findPsdPython(loaded.root);
    if (!existsSync(psdFile)) psd = { status: "skipped", detail: `PSD not found: ${psdFile}` };
    else if (!py) psd = { status: "skipped", detail: "psd-tools is not installed (optional)" };
    else {
      log("Reading the PSD (text, fonts, colours, layer groups). This can take a minute...");
      const out = join(paths.own, "psd-facts.json");
      const r = await run(py, [join(loaded.root, "tools", "psd", "psd_facts.py"), psdFile, out], {
        timeoutMs: 600_000,
      });
      psd =
        r.code === 0
          ? { status: "read", detail: r.stdout.trim(), file: "psd-facts.json" }
          : { status: "failed", detail: (r.stderr || r.stdout).trim().slice(-400) };
    }
  }
  log(`PSD: ${psd.status === "read" ? `read. ${psd.detail}` : `${psd.status} (${psd.detail})`}`);

  writeJsonAtomic(join(paths.own, "own-assets.json"), {
    createdAt: new Date().toISOString(),
    liveDeck: {
      gl: base.gl,
      hl: base.hl,
      deckLength: live.deckLength,
      imageIds: live.slots.map((s) => s.imageId),
    },
    thresholds: {
      nearIdenticalBits: NEAR_IDENTICAL_BITS,
      possibleCaptureBits: POSSIBLE_CAPTURE_BITS,
      provisional: true,
    },
    localFiles: locals,
    psd,
  });
}

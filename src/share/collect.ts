import { readSettings } from "../config/project.ts";
import { LIB, refsKey } from "../library/layout.ts";
import { readRefs } from "../library/refs.ts";
import { appSegment } from "../play/answers.ts";
import { libraryKey, projectKey, type Storage } from "../storage/index.ts";
import { fileSizes } from "../storage/share-files.ts";
import type { ShareKind } from "./format.ts";

/** One file a package would carry: its storage key, its name in the zip, and its size. */
export interface PackFile {
  key: string;
  name: string;
  bytes: number;
  /** Full-size originals and derived copies made from them: Full packages only. */
  fullOnly: boolean;
}

export interface Collected {
  files: PackFile[];
  images: number;
  /** Images whose full-size original is on this computer. */
  fullSize: number;
  analyses: number;
  reports: string[];
  appIds: string[];
  languages: string[];
}

/** Project folders left out: rebuilt by the tool, local to this computer, or not project data. */
const SKIP_PROJECT =
  /^(cache|views|pending|images|analysis|_before-library|same-screen|layer-diff|pixel-check)(\/|$)|^state\/(import(\.json|\/)|locks\/)|\/exports\/|\.bad-|\.tmp$|\.partial$|\.pdf$/;

const SHA = /^[0-9a-f]{64}$/;

/** A file to carry; its size is read later, for all files at once (missing ones drop out). */
function add(out: Map<string, PackFile>, _storage: Storage, key: string, fullOnly = false) {
  if (out.has(key)) return;
  const [ns, ...rest] = key.split("/");
  const name =
    ns === "library" ? `library/${rest.join("/")}` : `project/${rest.slice(1).join("/")}`;
  out.set(key, { key, name, bytes: -1, fullOnly });
}

const list = (storage: Storage, prefix: string) => {
  try {
    return [...storage.list(prefix)];
  } catch {
    return [];
  }
};

/**
 * Everything one project needs, from its refs to the images, facts and analyses they use (the
 * dependency closure of plan 12C, C2), with sizes. Light leaves out the full-size originals and
 * the copies derived from them; the thumbnails stay, so every page still shows every picture.
 */
export async function collectProject(storage: Storage, projectId: string): Promise<Collected> {
  const ctx = { projectId };
  const settings = readSettings(storage, ctx);
  if (!settings) throw new Error(`There is no project "${projectId}".`);
  if (!storage.exists(refsKey(ctx)))
    throw new Error("This project has no downloaded images yet, so there is nothing to share.");
  const refs = readRefs(storage, refsKey(ctx), projectId);
  const out = new Map<string, PackFile>();

  // The project's own folder, minus what is rebuilt or local.
  const base = `projects/${projectId}/`;
  for (const k of list(storage, projectKey(ctx)).sort()) {
    const rel = k.slice(base.length);
    if (!SKIP_PROJECT.test(rel)) add(out, storage, k);
  }

  // Per image: facts, thumbnail, analyses and cached checks; originals and copies (Full only).
  const shas = Object.keys(refs.images).filter((s) => SHA.test(s));
  // Each library folder is listed once and grouped by the image it is about.
  const grouped = (prefix: string) => {
    const m = new Map<string, string[]>();
    for (const k of list(storage, prefix)) {
      const sha = k.slice(prefix.length + 1, prefix.length + 65);
      m.set(sha, [...(m.get(sha) ?? []), k]);
    }
    return (sha: string) => m.get(sha) ?? [];
  };
  const img = (f: string) => grouped(libraryKey("images", f));
  const [orig, model, crops, pixels, thumbs] = [
    img("orig"),
    img("model"),
    img("crops"),
    img("pixels"),
    img("thumb"),
  ];
  const perImage = ["analysis", "attempts", "layer-diff", "pixel-check", "same-screen"].map(
    (f) => [f, grouped(libraryKey(f))] as const,
  );
  let fullSize = 0;
  let analyses = 0;
  const cited = new Set<string>();
  for (const sha of shas) {
    add(out, storage, LIB.facts(sha));
    for (const k of [...thumbs(sha), ...pixels(sha)]) add(out, storage, k);
    if (orig(sha).length) fullSize++;
    for (const k of [...orig(sha), ...model(sha), ...crops(sha)]) add(out, storage, k, true);
    for (const [folder, of] of perImage)
      for (const k of of(sha)) {
        add(out, storage, k);
        if (folder !== "analysis" || !k.endsWith(".json")) continue;
        const r = storage.getJson(k) as Record<string, { object?: unknown } | null> | undefined;
        if (r && "status" in r) analyses++;
        for (const part of ["producer", "reviewer", "adjudication"]) {
          const o = r?.[part]?.object;
          if (typeof o === "string" && /^[0-9a-f]{16,128}$/.test(o)) cited.add(o);
        }
      }
    for (const g of refs.images[sha]?.googleIds ?? []) add(out, storage, LIB.google(g));
  }

  // The per-image model answers those analyses cite (the second layer of reuse).
  for (const k of list(storage, libraryKey("objects")))
    if (cited.has(k.slice(k.lastIndexOf("/") + 1, -".json".length))) add(out, storage, k);

  // Store text and icons of every game in the project; word maps of its languages.
  const appIds = new Set<string>([settings.ourApp.id, ...settings.competitors.map((c) => c.id)]);
  for (const r of Object.values(refs.images)) for (const s of r.sources) appIds.add(s.appId);
  for (const appId of appIds) {
    for (const k of list(storage, libraryKey("store-text", appSegment(appId))))
      add(out, storage, k);
    const idx = libraryKey("icons", "apps", `${appSegment(appId)}.json`);
    add(out, storage, idx);
    const icon = (storage.exists(idx) ? storage.getJson(idx) : undefined) as
      | { sha?: string }
      | undefined;
    if (icon?.sha && SHA.test(icon.sha)) add(out, storage, libraryKey("icons", `${icon.sha}.webp`));
  }
  const languages = [...new Set(settings.markets.map((m) => m.hl))];
  for (const hl of languages)
    for (const k of list(storage, libraryKey("concept-maps", hl))) add(out, storage, k);

  const reports: string[] = [];
  for (const k of list(storage, projectKey(ctx, "reports", "defs"))) {
    const d = storage.getJson(k) as { name?: unknown } | undefined;
    if (typeof d?.name === "string") reports.push(d.name);
  }
  const sizes = await fileSizes(storage, [...out.keys()]);
  const files: PackFile[] = [];
  for (const f of out.values()) {
    const bytes = sizes.get(f.key);
    if (bytes !== undefined) files.push({ ...f, bytes });
  }
  return {
    files,
    images: shas.length,
    fullSize,
    analyses,
    reports: reports.sort(),
    appIds: [...appIds],
    languages,
  };
}

/** The files of one kind of package. */
export function filesFor(c: Collected, kind: ShareKind): PackFile[] {
  return kind === "full" ? c.files : c.files.filter((f) => !f.fullOnly);
}

/** Exact sizes of both options, before anything is built (plan 12C, C1). */
export function estimate(c: Collected) {
  const sum = (fs: PackFile[]) => fs.reduce((n, f) => n + f.bytes, 0);
  const light = filesFor(c, "light");
  return {
    light: { bytes: sum(light), files: light.length },
    full: { bytes: sum(c.files), files: c.files.length },
    images: c.images,
    fullSize: c.fullSize,
    analyses: c.analyses,
    reports: c.reports,
  };
}

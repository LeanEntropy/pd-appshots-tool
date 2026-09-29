import { readRecord } from "../analysis/records.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import type { ImageUse } from "../library/image-uses.ts";
import { readFacts } from "../library/imagedb.ts";
import { countryName, roleIn } from "../library/project-decks.ts";
import { pairKey } from "../reports/anchors.ts";
import { readDifferentPairs } from "../reports/match-check.ts";
import { pixelLookup, pixelSettings } from "../reports/pixel-pairs.ts";
import type { Storage } from "../storage/index.ts";
import { pixelCandidate, pixelVerdict } from "../store/pixel-diff.ts";
import { readSameScreen, sameScreenCandidate, sameScreenKey } from "../store/same-screen.ts";

/**
 * "Where it is used" on the image page, all by code from saved results (plan 2.2 item 6).
 * Candidates are bounded (the same game's other country pages, the same deck); each check has
 * three states and a missing result is "not checked yet", never "no match".
 */
export type CheckState = "matched" | "checked, no match" | "not checked yet";

export interface WhereRow {
  label: string;
  href: string;
  current?: boolean;
  state?: CheckState;
  note?: string;
}

export interface WhereUsed {
  here: WhereRow[];
  newText: WhereRow[];
  /** Candidates checked with no match (counted, not listed). */
  newTextNoMatch: number;
  sameScreen: WhereRow[];
  sameScreenNoMatch: number;
  others: WhereRow[];
}

export interface Ctx {
  project: string;
  app: string;
  gl: string;
  hl: string;
  pos: number;
}

export function imageHref(sha: string, c: Partial<Ctx>): string {
  const q = new URLSearchParams();
  if (c.project) q.set("project", c.project);
  if (c.app) q.set("app", c.app);
  if (c.gl) q.set("gl", c.gl);
  if (c.hl) q.set("hl", c.hl);
  if (c.pos) q.set("pos", String(c.pos));
  const s = q.toString();
  return `/image/${encodeURIComponent(sha)}${s ? `?${s}` : ""}`;
}

const MAX_CANDIDATES = 100;
const at = (u: ImageUse) => `${countryName(u.gl)} #${u.position}`;
const ctxOf = (project: string, u: ImageUse): Ctx => ({
  project,
  app: u.appId,
  gl: u.gl,
  hl: u.hl,
  pos: u.position,
});

export interface WhereInput {
  storage: Storage;
  loaded: LoadedConfig;
  sha: string;
  uses: ReadonlyMap<string, ImageUse[]>;
  current: Ctx;
  names: ReadonlyMap<string, string>;
  projectName: (id: string) => string;
  otherConfig: (id: string) => LoadedConfig | null;
}

export function whereUsed(w: WhereInput): WhereUsed {
  const { storage, loaded, sha, current } = w;
  const id = current.project;
  const mine = (w.uses.get(sha) ?? []).filter((u) => u.projectId === id);
  const game = (appId: string) => w.names.get(appId) ?? appId;
  const isCurrent = (u: ImageUse) =>
    u.appId === current.app &&
    u.gl === current.gl &&
    u.hl === current.hl &&
    u.position === current.pos;
  const here: WhereRow[] = [...mine]
    .sort((a, b) => Number(isCurrent(b)) - Number(isCurrent(a)))
    .map((u) => ({
      label: `${game(u.appId)}: ${at(u)}`,
      href: imageHref(sha, ctxOf(id, u)),
      ...(isCurrent(u) ? { current: true, note: "this one" } : { note: "identical file" }),
    }));
  // Every other picture of the project, by game and page (for the bounded candidates).
  const all: { sha: string; u: ImageUse }[] = [];
  for (const [s, list] of w.uses)
    if (s !== sha) for (const u of list) if (u.projectId === id) all.push({ sha: s, u });
  const me = readFacts(storage, sha);
  const paths = projectPaths(loaded);
  // Same picture, new text: the same game on its other country pages.
  const newText: WhereRow[] = [];
  let newTextNoMatch = 0;
  const pages = new Set(mine.map((u) => `${u.gl}|${u.hl}`));
  const different = readDifferentPairs(loaded);
  const settings = pixelSettings(loaded.config);
  const seen = new Set<string>();
  const cands = all.filter(
    (x) =>
      x.u.appId === current.app &&
      !pages.has(`${x.u.gl}|${x.u.hl}`) &&
      !seen.has(x.sha) &&
      seen.add(x.sha),
  );
  for (const c of cands.slice(0, MAX_CANDIDATES)) {
    const f = readFacts(storage, c.sha);
    if (!me || !f || !pixelCandidate(me, f)) continue;
    const records = new Map(
      [readRecord(paths, sha), readRecord(paths, c.sha)].flatMap((r) =>
        r ? [[r.imageId, r] as const] : [],
      ),
    );
    const look = pixelLookup(loaded, records);
    const r = look(c.sha, sha) ?? look(sha, c.sha);
    const state: CheckState = !r
      ? "not checked yet"
      : pixelVerdict(r, settings) !== "different" && !different.has(pairKey(sha, c.sha))
        ? "matched"
        : "checked, no match";
    if (state === "checked, no match") newTextNoMatch++;
    else
      newText.push({
        // One row per picture, naming every page it is on.
        label: `${game(c.u.appId)}: ${all
          .filter((x) => x.sha === c.sha && x.u.appId === current.app)
          .map((x) => at(x.u))
          .join(", ")}`,
        href: imageHref(c.sha, ctxOf(id, c.u)),
        state,
      });
  }
  // Same screen uploaded twice: other slots of the same deck.
  const sameScreen: WhereRow[] = [];
  let sameScreenNoMatch = 0;
  const deck = all.filter(
    (x) => x.u.appId === current.app && x.u.gl === current.gl && x.u.hl === current.hl,
  );
  for (const c of deck.slice(0, MAX_CANDIDATES)) {
    const f = readFacts(storage, c.sha);
    if (!me || !f) continue;
    const a = { id: sha, phash: me.phash, width: me.width, height: me.height };
    const b = { id: c.sha, phash: f.phash, width: f.width, height: f.height };
    if (!sameScreenCandidate(a, b)) continue;
    const r = readSameScreen(storage, sameScreenKey(paths, sha, c.sha));
    const state: CheckState = !r ? "not checked yet" : r.same ? "matched" : "checked, no match";
    if (state === "checked, no match") sameScreenNoMatch++;
    else
      sameScreen.push({
        label: `${at(c.u)}`,
        href: imageHref(c.sha, ctxOf(id, c.u)),
        state,
        note: `${f.width} × ${f.height}`,
      });
  }
  // Other projects that use the picture, and the game's role there.
  const others: WhereRow[] = [];
  const byProject = new Map<string, ImageUse[]>();
  for (const u of w.uses.get(sha) ?? [])
    if (u.projectId !== id) byProject.set(u.projectId, [...(byProject.get(u.projectId) ?? []), u]);
  for (const [pid, list] of byProject) {
    const first = list[0] as ImageUse;
    const cfg = w.otherConfig(pid);
    const role = cfg ? roleIn(cfg.config, first.appId) : "";
    others.push({
      label: `${w.projectName(pid)}: ${list.map(at).join(", ")}`,
      href: imageHref(sha, ctxOf(pid, first)),
      ...(role ? { note: role } : {}),
    });
  }
  return { here, newText, newTextNoMatch, sameScreen, sameScreenNoMatch, others };
}

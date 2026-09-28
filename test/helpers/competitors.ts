import { loadProject } from "../../src/config/project.ts";
import { buildTargets, deckKey } from "../../src/core/targets.ts";
import type { Listing } from "../../src/play/client.ts";
import type { StoreDeps } from "../../src/steps/add-competitor.ts";
import { runDownload } from "../../src/steps/download.ts";
import { computePlanHash, type DownloadPlan } from "../../src/steps/preview.ts";
import { projectKey } from "../../src/storage/index.ts";
import { picture } from "./project.ts";
import { OURS, wizardServer } from "./wizard.ts";

const u = (id: string) => `https://play-lh.googleusercontent.com/${id}`;

/** Screenshots per game and country; "shared" is the same picture in two games. */
export const SHOTS: Record<string, Record<string, string[]>> = {
  [OURS]: { us: [u("o1"), u("o2")], jp: [u("o1")] },
  "com.habby.capybara": { us: [u("c1"), u("shared")], jp: [u("c1")] },
  "com.dxx.firenow": { us: [u("f1"), u("shared")], jp: [u("f2")] },
  "com.jp.only": { jp: [u("j1")] },
};

/** Google Play store pages and image bytes, answered locally; counts image downloads. */
export function fakeStore() {
  const fetched: string[] = [];
  const seeds = new Map<string, number>();
  const deps: StoreDeps = {
    measure: false,
    listing: async (appId, gl, hl): Promise<Listing> => {
      const s = SHOTS[appId]?.[gl];
      const base = { appId, gl, hl, fetchedAt: new Date().toISOString() };
      return s
        ? { ...base, status: "ok", title: appId, rawCount: s.length, screenshots: s }
        : { ...base, status: "unavailable", rawCount: 0, screenshots: [] };
    },
    fetchImage: async (url) => {
      fetched.push(url);
      const id = url.replace(/=s0$/, "");
      if (!seeds.has(id)) seeds.set(id, seeds.size + 1);
      return picture(seeds.get(id) ?? 0);
    },
  };
  return { deps, fetched };
}

/**
 * A finished project (ours plus Capybara Go, United States and Japan) in the shared library,
 * downloaded once, served by the tool's server with the local Google Play.
 */
export async function downloadedProject() {
  const store = fakeStore();
  const w = await wizardServer(undefined, store.deps);
  const made = await w.post("/api/projects", { appId: OURS, name: "Rogue Legend" });
  const id = made.body.id as string;
  await w.post(`/p/${id}/api/settings`, {
    competitors: [{ id: "com.habby.capybara", tier: "direct" }],
    markets: [{ gl: "jp", hl: "en" }],
    charts: { enabled: false, depth: 10 },
  });
  const fin = await w.post(`/p/${id}/api/settings/finish`, {});
  if (fin.status !== 200) throw new Error(JSON.stringify(fin.body));
  // In the shared library from the first download on.
  w.storage.putJson(projectKey({ projectId: id }, "refs.json"), {
    version: 1,
    projectId: id,
    images: {},
  });
  const loaded = loadProject(id, { root: w.root });
  const targets = buildTargets(loaded.config, []);
  const listings: Record<string, Listing> = {};
  for (const t of targets)
    listings[deckKey(t)] = await (store.deps.listing as NonNullable<StoreDeps["listing"]>)(
      t.appId,
      t.gl,
      t.hl,
    );
  const plan = {
    createdAt: new Date().toISOString(),
    configHash: loaded.hash,
    planHash: computePlanHash(loaded.hash, targets, listings),
    targets,
    listings,
  } as DownloadPlan;
  await runDownload(loaded, plan, () => {}, store.deps);
  store.fetched.length = 0;
  return { w, id, store };
}

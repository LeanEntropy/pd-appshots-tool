import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { readSettings, settingsKey } from "../config/project.ts";
import { ProjectSettingsSchema } from "../config/project-schema.ts";
import { enqueueStore, storeStatus } from "../jobs/index.ts";
import { downloadGame } from "../steps/add-competitor.ts";
import {
  addableCountries,
  type CountriesPlan,
  checkCountries,
  countriesPlanProblem,
  countriesPreview,
  readCountriesPlan,
  withCountries,
} from "../steps/add-countries.ts";
import { runDeckView } from "../steps/deck-view.ts";
import { projectKey } from "../storage/index.ts";
import { latestRun } from "../view/model.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext } from "./app-context.ts";
import { send, writeRequest } from "./http-util.ts";
import { oneAtATime } from "./routes-setup.ts";

/**
 * Adding countries to a project from the Report tab (a multi-country suggestion, "What next?" or
 * the builder): GET the picker (Google Play countries not in the project, with their language),
 * POST add (saved to the project's settings), POST check (their store pages only, free), GET the
 * approval numbers, POST download (only images not in the shared library). Nothing paid runs.
 */
const BASE = "/api/project-countries";
const JOB_APP = "countries";
const bad = (m: string): ApiResponse => ({ status: 400, body: { problems: [m] } });
const conflict = (m: string): ApiResponse => ({ status: 409, body: { problems: [m] } });
const UNREADABLE = "The page sent a request the tool cannot read. Reload the page.";
const FIXED =
  "This project's settings come from a config file, so its countries cannot be changed here.";

const GlsBody = z.strictObject({
  gls: z
    .array(z.string().regex(/^[a-z]{2}$/))
    .min(1)
    .max(40),
});
const DownloadBody = z.strictObject({ planHash: z.string().regex(/^[a-f0-9]{64}$/) });

export function getPicker(app: AppContext, loaded: LoadedConfig): ApiResponse {
  const paths = projectPaths(loaded);
  const s = readSettings(app.storage, paths);
  const job = storeStatus(app.storage, paths);
  const run = latestRun(paths.runs);
  const markets = loaded.config.markets.map((m) => ({ gl: m.gl, hl: m.hl, label: m.label }));
  return {
    status: 200,
    body: {
      countries: markets,
      addable: s ? addableCountries(app.countries(), s) : [],
      fixed: !s,
      // Added to the project, but with no store page downloaded yet.
      notDownloaded: run ? markets.filter((m) => !run.decks.some((d) => d.gl === m.gl)) : [],
      job: job?.appId === JOB_APP ? job : null,
    },
  };
}

/** Saves the ticked countries to the project's settings (their usual language). */
export function postAdd(app: AppContext, loaded: LoadedConfig, raw: unknown): ApiResponse {
  const p = GlsBody.safeParse(raw);
  if (!p.success) return bad(UNREADABLE);
  const paths = projectPaths(loaded);
  const s = readSettings(app.storage, paths);
  if (!s) return conflict(FIXED);
  if (storeStatus(app.storage, paths)?.state === "running")
    return conflict("This project is reading Google Play now. Add countries when it finishes.");
  const r = withCountries(app.countries(), s, p.data.gls);
  if ("problem" in r) return bad(r.problem);
  const next = ProjectSettingsSchema.parse({ ...r.settings, updatedAt: new Date().toISOString() });
  app.storage.putJson(settingsKey(paths), next);
  const names = r.added.map((gl) => next.markets.find((m) => m.gl === gl)?.label ?? gl);
  return {
    status: 200,
    body: {
      added: r.added,
      countries: next.markets,
      message: `Added ${names.join(", ")} to the project. Next: its store pages are checked (free).`,
    },
  };
}

/** Starts reading the new countries' store pages (no images, no AI) as a store job. */
export function postCheck(app: AppContext, loaded: LoadedConfig, raw: unknown): ApiResponse {
  const p = GlsBody.safeParse(raw);
  if (!p.success) return bad(UNREADABLE);
  const { gls } = p.data;
  if (!gls.every((gl) => loaded.config.markets.some((m) => m.gl === gl)))
    return conflict("These countries are not in the project. Reload the page.");
  if (!latestRun(projectPaths(loaded).runs))
    return conflict("Download the project first, then add countries.");
  const r = enqueueStore(
    loaded,
    {
      kind: "store-check",
      appId: JOB_APP,
      planHash: [...gls].sort().join(","),
      frozenInput: null,
      message: "Checking the store pages in the new countries",
    },
    async (progress) => {
      await checkCountries(loaded, gls, progress, app.storeDeps);
    },
    { names: app.names },
  );
  return r.ok
    ? { status: 202, body: { jobId: r.jobId } }
    : { status: r.status, body: { problems: [r.problem] } };
}

export function getPreview(loaded: LoadedConfig): ApiResponse {
  const plan = readCountriesPlan(loaded);
  if (!plan) return conflict("Check the store pages of the new countries first.");
  return { status: 200, body: { preview: countriesPreview(loaded, plan) } };
}

/** Starts the approved download: only images not in the shared library; other decks are kept. */
export function postDownload(app: AppContext, loaded: LoadedConfig, raw: unknown): ApiResponse {
  const p = DownloadBody.safeParse(raw);
  if (!p.success) return bad(UNREADABLE);
  const { planHash } = p.data;
  const plan = readCountriesPlan(loaded);
  if (!plan) return conflict("Check the store pages of the new countries first.");
  if (plan.planHash !== planHash)
    return conflict("The store check changed since you saw these numbers. Look at them again.");
  const problem = countriesPlanProblem(loaded, plan);
  if (problem) return conflict(problem);
  const paths = projectPaths(loaded);
  const last = storeStatus(app.storage, paths);
  if (last?.kind === "download" && last.planHash === planHash && last.state === "finished")
    return conflict("These countries are downloaded already. Reload the page.");
  const frozen = projectKey(paths, "state", "approved", `download-${planHash}.json`);
  app.storage.putJsonOnce(frozen, plan);
  const r = enqueueStore(
    loaded,
    { kind: "download", appId: JOB_APP, planHash, frozenInput: frozen, message: "Downloading" },
    async (progress) => {
      const approved = app.storage.getJson(frozen) as CountriesPlan;
      const what = "Downloading the images of the new countries";
      progress(0, 0, what);
      const done = await downloadGame(
        loaded,
        approved,
        (n, t) => progress(n, t, what),
        app.storeDeps,
      );
      progress(1, 1, "Building the deck pages");
      try {
        runDeckView(loaded);
      } catch (e) {
        console.error("Deck pages after adding countries:", e);
      }
      if (done.failed.length || approved.incomplete.length)
        throw new Error(
          `${done.downloaded} images downloaded, but ${done.failed.length ? `${done.failed.length} could not be downloaded` : "some store pages could not be read"}. What was downloaded is kept. Check the store again to fetch what is missing.`,
        );
    },
    { names: app.names },
  );
  return r.ok
    ? { status: 202, body: { jobId: r.jobId } }
    : { status: r.status, body: { problems: [r.problem] } };
}

/** The routes above; false when the path is not one of them. */
export async function countriesRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  if (!rest.startsWith(BASE)) return false;
  const id = projectPaths(loaded).projectId;
  if (req.method === "GET") {
    const r =
      rest === BASE
        ? getPicker(app, loaded)
        : rest === `${BASE}/preview`
          ? getPreview(loaded)
          : rest === `${BASE}/job`
            ? { status: 200, body: { job: storeStatus(app.storage, projectPaths(loaded)) } }
            : null;
    if (!r) return false;
    send(res, r.status, r.body);
    return true;
  }
  const posts: Record<string, (b: unknown) => Promise<ApiResponse>> = {
    [`${BASE}/add`]: (b) => oneAtATime(id, async () => postAdd(app, loaded, b)),
    [`${BASE}/check`]: async (b) => postCheck(app, loaded, b),
    [`${BASE}/download`]: async (b) => postDownload(app, loaded, b),
  };
  const post = posts[rest];
  if (!post || req.method !== "POST") return false;
  const w = await writeRequest(req, res, app.token);
  if (!w) return true;
  const r = await post(w.body);
  send(res, r.status, r.body);
  return true;
}

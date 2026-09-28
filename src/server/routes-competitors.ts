import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { enqueueStore, storeStatus } from "../jobs/index.ts";
import { PACKAGE_ID } from "../play/input.ts";
import {
  checkGame,
  downloadGame,
  gamePlanProblem,
  gamePreview,
  readGamePlan,
} from "../steps/add-competitor.ts";
import { runDeckView } from "../steps/deck-view.ts";
import type { DownloadPlan } from "../steps/preview.ts";
import { projectKey } from "../storage/index.ts";
import { latestRun } from "../view/model.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext } from "./app-context.ts";
import {
  getCompetitors,
  IdBody,
  postAddCompetitor,
  postRemoveCompetitor,
} from "./competitors-api.ts";
import { send, writeRequest } from "./http-util.ts";
import { oneAtATime } from "./routes-setup.ts";

const bad = (m: string): ApiResponse => ({ status: 400, body: { problems: [m] } });
const conflict = (m: string): ApiResponse => ({ status: 409, body: { problems: [m] } });

function competitorName(loaded: LoadedConfig, id: string): string | null {
  return loaded.config.competitors.find((c) => c.id === id)?.name ?? null;
}

/** Starts reading one added game's store pages (no images, no AI) as a store job. */
export function postCheck(app: AppContext, loaded: LoadedConfig, raw: unknown): ApiResponse {
  const p = IdBody.safeParse(raw);
  if (!p.success) return bad("The page sent a request the tool cannot read. Reload the page.");
  const { id } = p.data;
  const name = competitorName(loaded, id);
  if (!name) return conflict("This game is not in the project any more. Reload the page.");
  if (!latestRun(projectPaths(loaded).runs))
    return conflict("Download the project first, then add competitors.");
  const r = enqueueStore(
    loaded,
    {
      kind: "store-check",
      appId: id,
      planHash: "",
      frozenInput: null,
      message: `Checking the store pages of ${name}`,
    },
    async (progress) => {
      await checkGame(loaded, id, progress, app.storeDeps);
    },
    { names: app.names },
  );
  return r.ok
    ? { status: 202, body: { jobId: r.jobId } }
    : { status: r.status, body: { problems: [r.problem] } };
}

/** The approval numbers of the game's saved store check. */
export function getPreview(loaded: LoadedConfig, q: URLSearchParams): ApiResponse {
  const id = q.get("id") ?? "";
  if (!PACKAGE_ID.test(id)) return bad("Which game? Reload the page.");
  const plan = readGamePlan(loaded, id);
  if (!plan) return conflict("Check the store for this game first.");
  return { status: 200, body: { preview: gamePreview(loaded, plan, id) } };
}

const DownloadBody = z.strictObject({
  id: z.string().regex(PACKAGE_ID),
  planHash: z.string().regex(/^[a-f0-9]{64}$/),
});

/**
 * Starts the approved download of one game: from an immutable copy of the approved preview,
 * only images not in the shared library yet; the workspace keeps every other deck.
 */
export function postDownload(app: AppContext, loaded: LoadedConfig, raw: unknown): ApiResponse {
  const p = DownloadBody.safeParse(raw);
  if (!p.success) return bad("The page sent a request the tool cannot read. Reload the page.");
  const { id, planHash } = p.data;
  const name = competitorName(loaded, id);
  const plan = readGamePlan(loaded, id);
  if (!name || !plan) return conflict("Check the store for this game first.");
  if (plan.planHash !== planHash)
    return conflict("The store check changed since you saw these numbers. Look at them again.");
  const problem = gamePlanProblem(loaded, plan, id);
  if (problem) return conflict(problem);
  const paths = projectPaths(loaded);
  // One approval downloads once: a replayed request after it finished starts nothing.
  const last = storeStatus(app.storage, paths);
  if (last?.kind === "download" && last.planHash === planHash && last.state === "finished")
    return conflict(`${name} is downloaded already. Reload the page.`);
  const frozen = projectKey(paths, "state", "approved", `download-${planHash}.json`);
  app.storage.putJsonOnce(frozen, plan);
  const r = enqueueStore(
    loaded,
    { kind: "download", appId: id, planHash, frozenInput: frozen, message: `Downloading ${name}` },
    async (progress) => {
      const approved = app.storage.getJson(frozen) as DownloadPlan;
      progress(0, 0, `Downloading the images of ${name}`);
      const done = await downloadGame(
        loaded,
        approved,
        (n, total) => progress(n, total, `Downloading the images of ${name}`),
        app.storeDeps,
      );
      progress(1, 1, "Building the deck pages");
      try {
        runDeckView(loaded);
      } catch (e) {
        // The workspace page is built live; the offline pages can be rebuilt later.
        console.error("Deck pages after adding a competitor:", e);
      }
      // What was fetched is kept; the job says plainly that something is missing.
      if (done.failed.length || approved.incomplete.length)
        throw new Error(
          `${name}: ${done.downloaded} images downloaded, but ${done.failed.length ? `${done.failed.length} could not be downloaded` : "some store pages could not be read"}. What was downloaded is kept. Press Check the store to fetch what is missing.`,
        );
    },
    { names: app.names },
  );
  return r.ok
    ? { status: 202, body: { jobId: r.jobId } }
    : { status: r.status, body: { problems: [r.problem] } };
}

/**
 * The Competitors tab's routes for a project that is set up: its competitor list, add and
 * remove, and the store check and download of an added game. False when not one of them.
 */
export async function competitorsRoute(
  app: AppContext,
  loaded: LoadedConfig,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!rest.startsWith("/api/competitors")) return false;
  const id = projectPaths(loaded).projectId;
  if (req.method === "GET") {
    const r =
      rest === "/api/competitors"
        ? getCompetitors(app, loaded)
        : rest === "/api/competitors/job"
          ? { status: 200, body: { job: storeStatus(app.storage, projectPaths(loaded)) } }
          : rest === "/api/competitors/preview"
            ? getPreview(loaded, url.searchParams)
            : null;
    if (!r) return false;
    send(res, r.status, r.body);
    return true;
  }
  const posts: Record<string, (b: unknown) => Promise<ApiResponse>> = {
    "/api/competitors/add": (b: unknown) => oneAtATime(id, () => postAddCompetitor(app, loaded, b)),
    "/api/competitors/remove": (b: unknown) =>
      oneAtATime(id, async () => postRemoveCompetitor(app, loaded, b)),
    "/api/competitors/check": async (b: unknown) => postCheck(app, loaded, b),
    "/api/competitors/download": async (b: unknown) => postDownload(app, loaded, b),
  };
  const post = posts[rest];
  if (!post || req.method !== "POST") return false;
  const w = await writeRequest(req, res, app.token);
  if (!w) return true;
  const r = await post(w.body);
  send(res, r.status, r.body);
  return true;
}

import { z } from "zod";
import {
  coreOrder,
  type LoadedConfig,
  projectPaths,
  readRunConfig,
  writeRunConfig,
} from "../config/load.ts";
import { readSettings, settingsKey } from "../config/project.ts";
import { type ProjectSettings, ProjectSettingsSchema } from "../config/project-schema.ts";
import { storeStatus } from "../jobs/index.ts";
import { fetchIcon } from "../play/icon.ts";
import { PACKAGE_ID } from "../play/input.ts";
import { latestRun } from "../view/model.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext } from "./app-context.ts";
import { playFailure, referenceWarning } from "./routes-play.ts";

/**
 * Adding and removing competitors of a project that is set up already, from the Competitors
 * tab (plan 1.4). The same checks as the new-project steps: no duplicate, not our own game, the
 * game's details from Google Play (never from the page). A new game is not added to the core
 * pick; a removed one leaves the pick, and its images and analyses stay in the shared library.
 */

const bad = (m: string): ApiResponse => ({ status: 400, body: { problems: [m] } });
const conflict = (m: string): ApiResponse => ({ status: 409, body: { problems: [m] } });
const UNREADABLE = "The page sent a change the tool cannot read. Reload the page.";
const RACE = "Another change was saved at the same time. Reload the page.";

export const AddBody = z.strictObject({
  id: z.string().regex(PACKAGE_ID),
  tier: z.enum(["direct", "same_audience", "reference"]),
});
export const IdBody = z.strictObject({ id: z.string().regex(PACKAGE_ID) });

function write(app: AppContext, s: ProjectSettings): ProjectSettings {
  const next = ProjectSettingsSchema.parse({ ...s, updatedAt: new Date().toISOString() });
  app.storage.putJson(settingsKey({ projectId: s.id }), next);
  return next;
}

/** The project's competitors, each with whether its screenshots are downloaded. */
export function getCompetitors(app: AppContext, loaded: LoadedConfig): ApiResponse {
  const paths = projectPaths(loaded);
  const s = readSettings(app.storage, paths);
  if (!s) return { status: 404, body: { problems: ["There is no such project."] } };
  const run = latestRun(paths.runs);
  const pick = coreOrder(loaded, paths);
  return {
    status: 200,
    body: {
      ourAppId: s.ourApp.id,
      competitors: s.competitors.map((c) => {
        const decks = run?.decks.filter((d) => d.appId === c.id && d.group === "named") ?? [];
        // Complete: every store page was read and every screenshot is on disk.
        const complete = decks.every(
          (d) => d.status !== "error" && d.slots.every((x) => x.imageId),
        );
        return {
          ...c,
          downloaded: decks.length > 0 && complete,
          incomplete: decks.length > 0 && !complete,
          inPick: pick.includes(c.id),
        };
      }),
      job: storeStatus(app.storage, paths),
    },
  };
}

/** Adds a competitor at the end of the list, unticked for the core check. */
export async function postAddCompetitor(
  app: AppContext,
  loaded: LoadedConfig,
  raw: unknown,
): Promise<ApiResponse> {
  const p = AddBody.safeParse(raw);
  if (!p.success) return bad(UNREADABLE);
  const { id, tier } = p.data;
  const paths = projectPaths(loaded);
  const before = readSettings(app.storage, paths);
  if (!before) return { status: 404, body: { problems: ["There is no such project."] } };
  if (id === before.ourApp.id) return bad("That is your own game. Add the games you compete with.");
  if (before.competitors.some((c) => c.id === id)) return bad("That game is in your list already.");
  if (before.competitors.length >= 60)
    return bad("A project can have at most 60 competitors. Remove one first.");
  let found: Awaited<ReturnType<AppContext["play"]["detailsAnywhere"]>>;
  try {
    // Not on Google Play in the US: read in the first project country where it exists.
    found = await app.play.detailsAnywhere(id, before.markets);
  } catch (e) {
    return playFailure(e);
  }
  const d = found.app;
  const iconFile = await fetchIcon(app.storage, paths, d.appId, d.icon, app.fetcher);
  const s = readSettings(app.storage, paths);
  if (!s || s.updatedAt !== before.updatedAt) return conflict(RACE);
  // The pick stays as it is: without a saved pick every competitor would count as picked.
  if (!readRunConfig(paths))
    writeRunConfig(paths, {
      coreCompetitors: coreOrder(loaded, paths),
      source: "page",
      updatedAt: new Date().toISOString(),
    });
  const competitor = {
    id,
    name: d.title,
    ...(d.developer ? { developer: d.developer } : {}),
    ...(d.genreId ? { genreId: d.genreId } : {}),
    tier,
    ...(iconFile ? { iconFile } : {}),
    addedAt: new Date().toISOString(),
    ...(found.reference ? { reference: found.reference } : {}),
  };
  write(app, { ...s, competitors: [...s.competitors, competitor] });
  return {
    status: 200,
    body: {
      competitor,
      warnings: found.reference ? [referenceWarning(found.reference)] : [],
      message: `${d.title} added to the project. It is not in your core pick; tick it after the download.`,
    },
  };
}

/** Removes a competitor from the project and the pick. Nothing is deleted. */
export function postRemoveCompetitor(
  app: AppContext,
  loaded: LoadedConfig,
  raw: unknown,
): ApiResponse {
  const p = IdBody.safeParse(raw);
  if (!p.success) return bad(UNREADABLE);
  const { id } = p.data;
  const paths = projectPaths(loaded);
  const s = readSettings(app.storage, paths);
  if (!s) return { status: 404, body: { problems: ["There is no such project."] } };
  const gone = s.competitors.find((c) => c.id === id);
  if (!gone) return conflict("That game is not in this project any more. Reload the page.");
  if (s.competitors.length === 1)
    return bad("A project needs at least one competitor. Add another one first.");
  const job = storeStatus(app.storage, paths);
  if (job?.state === "running" && job.appId === id)
    return conflict(`${gone.name} is being read from Google Play right now. Remove it afterwards.`);
  const pick = coreOrder(loaded, paths);
  const inPick = pick.includes(id);
  // The pick first: if the tool stops between the two writes, the game is only unticked.
  const rc = readRunConfig(paths);
  if (rc && inPick) {
    const { confirmed: _cleared, ...rest } = rc;
    writeRunConfig(paths, {
      ...rest,
      coreCompetitors: pick.filter((x) => x !== id),
      source: "page",
      updatedAt: new Date().toISOString(),
    });
  }
  write(app, { ...s, competitors: s.competitors.filter((c) => c.id !== id) });
  return {
    status: 200,
    body: {
      removed: id,
      wasInPick: inPick,
      message: `${gone.name} removed from this project${inPick ? " and from your core pick" : ""}. Its screenshots and analyses stay in the shared library, so adding it back later downloads and analyses nothing again.`,
    },
  };
}

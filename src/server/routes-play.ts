import { z } from "zod";
import { defaultMarkets } from "../config/countries.ts";
import { readSettings, settingsKey } from "../config/project.ts";
import { type ProjectSettings, ProjectSettingsSchema } from "../config/project-schema.ts";
import { readRegistry, slugFor, upsertEntry } from "../config/registry.ts";
import { fetchIcon } from "../play/icon.ts";
import { PACKAGE_ID, parsePlayInput } from "../play/input.ts";
import { type PlayDetails, PlayProblem } from "../play/lookup.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext } from "./app-context.ts";

const STATUS: Record<PlayProblem["kind"], number> = {
  unavailable: 404,
  "no-hits": 404,
  "no-answer": 503,
  unexpected: 502,
};

/** A Play failure as a plain-language answer; anything else is rethrown (a real bug). */
export function playFailure(e: unknown): ApiResponse {
  if (e instanceof PlayProblem) return { status: STATUS[e.kind], body: { problems: [e.message] } };
  throw e;
}

const bad = (message: string): ApiResponse => ({ status: 400, body: { problems: [message] } });

const Query = z.string().trim().min(1).max(500);

/** The card the wizard shows before the user confirms a game. */
export function card(d: PlayDetails) {
  const warnings: string[] = [];
  if (!d.isGame)
    warnings.push(
      `This app is listed under ${d.genre || "a category that is not a game"}, not a game category. Charts will be switched off.`,
    );
  return { ...d, warnings };
}

/**
 * Details for a link or package ID. Our own game is accepted only this way: picking the wrong
 * own game is costly, so a name is not enough (plan 1.2, step 1).
 */
export async function getLookup(app: AppContext, q: URLSearchParams): Promise<ApiResponse> {
  const text = Query.safeParse(q.get("q") ?? "");
  if (!text.success) return bad("Paste the link from your game's Google Play page.");
  const input = parsePlayInput(text.data);
  if (input.kind === "bad") return bad(input.message);
  if (input.kind === "search")
    return bad(
      "Paste the link from your game's Google Play page (or its package ID). A name is not enough to be sure it is the right game.",
    );
  try {
    const d = await app.play.details(input.appId, q.get("soft") ? "background" : "interactive");
    return { status: 200, body: { app: card(d) } };
  } catch (e) {
    return playFailure(e);
  }
}

/** A competitor: a link or ID gives its card at once; a name gives the top matches. */
export async function getSearch(app: AppContext, q: URLSearchParams): Promise<ApiResponse> {
  const text = Query.safeParse(q.get("q") ?? "");
  if (!text.success) return bad("Type a game's name, or paste its Google Play link.");
  const input = parsePlayInput(text.data);
  if (input.kind === "bad") return bad(input.message);
  // "Survivor.io" looks like a package ID: tried as one first, then searched as a name.
  const bare = input.kind === "id" && !/^[a-z]+:|\//i.test(text.data);
  try {
    if (input.kind === "id") {
      try {
        return { status: 200, body: { app: card(await app.play.details(input.appId)) } };
      } catch (e) {
        if (!(bare && e instanceof PlayProblem && e.kind === "unavailable")) throw e;
      }
    }
    return { status: 200, body: { hits: await app.play.search(text.data) } };
  } catch (e) {
    return playFailure(e);
  }
}

export function getCountries(app: AppContext): ApiResponse {
  return { status: 200, body: app.countries() };
}

const CreateBody = z.strictObject({
  appId: z.string().regex(PACKAGE_ID),
  name: z.string().trim().min(1).max(100),
});

/**
 * Step 1 confirmed: the project exists from now on, as "Setting up" (plan 1.2). The game's
 * details are read again here (from the cache), never taken from the page.
 */
export async function postProject(app: AppContext, raw: unknown): Promise<ApiResponse> {
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success)
    return bad("Look up your game with its Google Play link, then give the project a name.");
  let d: PlayDetails;
  try {
    d = await app.play.details(parsed.data.appId);
  } catch (e) {
    return playFailure(e);
  }
  const now = new Date().toISOString();
  const id = slugFor(parsed.data.name, app.storage.listProjectIds());
  const ctx = { projectId: id };
  const settings: ProjectSettings = ProjectSettingsSchema.parse({
    schemaVersion: 1,
    id,
    name: parsed.data.name,
    createdAt: now,
    updatedAt: now,
    ourApp: {
      id: d.appId,
      name: d.title,
      ...(d.developer ? { developer: d.developer } : {}),
      ...(d.genreId ? { genreId: d.genreId } : {}),
    },
    competitors: [],
    markets: defaultMarkets(app.countries()),
    charts: { enabled: d.isGame, collection: "GROSSING", depth: 10 },
    category: d.isGame ? d.genreId : "auto",
    setupStep: 2,
  });
  if (!app.storage.putJsonOnce(settingsKey(ctx), settings))
    return {
      status: 409,
      body: { problems: ["A project with this name was just created. Try again."] },
    };
  const entry = {
    id,
    name: settings.name,
    ourAppId: d.appId,
    createdAt: now,
    lastOpenedAt: now,
    archived: false,
  };
  upsertEntry(app.storage, entry);
  // The project is saved before the icon is fetched: a slow or failed icon never loses it.
  const iconFile = await fetchIcon(app.storage, ctx, d.appId, d.icon, app.fetcher);
  if (!iconFile) return { status: 201, body: { id, settings } };
  const latest = readSettings(app.storage, ctx) ?? settings;
  const withIcon = { ...latest, ourApp: { ...latest.ourApp, iconFile } };
  app.storage.putJson(settingsKey(ctx), withIcon);
  const e = readRegistry(app.storage).projects.find((p) => p.id === id);
  upsertEntry(app.storage, { ...(e ?? entry), iconFile });
  return { status: 201, body: { id, settings: withIcon } };
}

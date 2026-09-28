import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { checkMarkets } from "../config/countries.ts";
import { configFromSettings, loadDefaults, readSettings, settingsKey } from "../config/project.ts";
import { isDraft, type ProjectSettings, ProjectSettingsSchema } from "../config/project-schema.ts";
import { markOpened, readRegistry, upsertEntry } from "../config/registry.ts";
import { fetchIcon } from "../play/icon.ts";
import { PACKAGE_ID } from "../play/input.ts";
import type { PlayDetails } from "../play/lookup.ts";
import { projectKey } from "../storage/index.ts";
import { wizardHtml } from "../view/wizard-html.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext, Loaded } from "./app-context.ts";
import { redirect, send, sendHtml, writeRequest } from "./http-util.ts";
import { playFailure } from "./routes-play.ts";

/** Soft rules: shown as warnings, never blocking (plan 4, soft rules). */
export function warnings(s: ProjectSettings, minCompetitors = 5): string[] {
  const out: string[] = [];
  const n = s.competitors.length;
  if (n < minCompetitors)
    out.push(
      `The core check needs at least ${minCompetitors} competitors whose whole English decks fit. You have ${n}.`,
    );
  if (s.charts.enabled === false && !(s.ourApp.genreId ?? "").startsWith("GAME"))
    out.push("Your game is not listed in a game category, so the top-grossing charts are off.");
  return out;
}

const Patch = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  competitors: z
    .array(
      z.strictObject({
        id: z.string().regex(PACKAGE_ID),
        tier: z.enum(["direct", "same_audience", "reference"]),
      }),
    )
    .max(60)
    .optional(),
  markets: z
    .array(z.strictObject({ gl: z.string().regex(/^[a-z]{2}$/), hl: z.string().min(2).max(10) }))
    .max(40)
    .optional(),
  charts: z
    .strictObject({ enabled: z.boolean(), depth: z.number().int().min(1).max(50) })
    .optional(),
  setupStep: z.number().int().min(1).max(5).optional(),
});

const bad = (m: string): ApiResponse => ({ status: 400, body: { problems: [m] } });

function save(app: AppContext, s: ProjectSettings): ProjectSettings {
  const next = ProjectSettingsSchema.parse({ ...s, updatedAt: new Date().toISOString() });
  app.storage.putJson(settingsKey({ projectId: s.id }), next);
  const e = readRegistry(app.storage).projects.find((p) => p.id === s.id);
  if (e && e.name !== next.name) upsertEntry(app.storage, { ...e, name: next.name });
  return next;
}

/**
 * Autosave of the new-project steps. Every change is checked (duplicates, our own game, the
 * country list) and written at once. New competitors are looked up first (from the cache), then
 * the settings are re-read and written in one go, so a slow lookup never overwrites a newer save.
 */
export async function postSettings(
  app: AppContext,
  id: string,
  raw: unknown,
): Promise<ApiResponse> {
  const p = Patch.safeParse(raw);
  if (!p.success) return bad("The page sent a change the tool cannot read. Reload the page.");
  const before = readSettings(app.storage, { projectId: id });
  if (!before) return { status: 404, body: { problems: ["There is no such project."] } };
  if (!isDraft(before))
    return {
      status: 409,
      body: {
        problems: [
          "This project is set up already. Changing its settings arrives in a later update.",
        ],
      },
    };
  const found = new Map<string, PlayDetails>();
  if (p.data.competitors) {
    const seen = new Set<string>();
    for (const c of p.data.competitors) {
      if (c.id === before.ourApp.id)
        return bad("That is your own game. Add the games you compete with.");
      if (seen.has(c.id)) return bad("That game is in your list already.");
      seen.add(c.id);
      if (before.competitors.some((x) => x.id === c.id)) continue;
      try {
        found.set(c.id, await app.play.details(c.id));
      } catch (e) {
        return playFailure(e);
      }
    }
  }
  const s = readSettings(app.storage, { projectId: id }) ?? before;
  if (!isDraft(s)) return bad("This project was just finished. Reload the page.");
  const next: ProjectSettings = { ...s };
  if (p.data.name) next.name = p.data.name;
  if (p.data.competitors) {
    const now = new Date().toISOString();
    next.competitors = [];
    for (const c of p.data.competitors) {
      const had = s.competitors.find((x) => x.id === c.id);
      if (had) {
        next.competitors.push({ ...had, tier: c.tier });
        continue;
      }
      const d = found.get(c.id) ?? (await app.play.details(c.id));
      const iconFile = await fetchIcon(
        app.storage,
        { projectId: id },
        d.appId,
        d.icon,
        app.fetcher,
      );
      next.competitors.push({
        id: c.id,
        name: d.title,
        ...(d.developer ? { developer: d.developer } : {}),
        ...(d.genreId ? { genreId: d.genreId } : {}),
        tier: c.tier,
        ...(iconFile ? { iconFile } : {}),
        addedAt: now,
      });
    }
  }
  if (p.data.markets) {
    const m = checkMarkets(app.countries(), p.data.markets);
    if ("problem" in m) return bad(m.problem);
    next.markets = m.markets;
  }
  if (p.data.charts) {
    const isGame = (s.ourApp.genreId ?? "").startsWith("GAME");
    if (p.data.charts.enabled && !isGame)
      return bad("Charts need your game to be in a game category on Google Play.");
    next.charts = { ...s.charts, ...p.data.charts };
  }
  if (p.data.setupStep) next.setupStep = p.data.setupStep;
  // Written from the latest settings: re-read after every await above.
  const latest = readSettings(app.storage, { projectId: id });
  if (latest && latest.updatedAt !== s.updatedAt)
    return {
      status: 409,
      body: { problems: ["Another change was saved at the same time. Reload the page."] },
    };
  const saved = save(app, next);
  return { status: 200, body: { settings: saved, warnings: warnings(saved) } };
}

/** Step 5, "Create project": the project becomes runnable and lands on its next step. */
export function postFinish(app: AppContext, id: string): ApiResponse {
  const s = readSettings(app.storage, { projectId: id });
  if (!s) return { status: 404, body: { problems: ["There is no such project."] } };
  if (!isDraft(s)) return { status: 200, body: { href: `/p/${id}/` } };
  if (!s.competitors.length) return bad("Add at least one competitor first.");
  const { setupStep: _done, ...rest } = s;
  try {
    configFromSettings(rest, loadDefaults(app.root));
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e));
  }
  save(app, rest);
  return { status: 200, body: { href: `/p/${id}/` } };
}

const ICON = /^\/icons\/([A-Za-z0-9.@-]{1,200}\.png)$/;

/**
 * The wizard's routes for one project: the setup page, reading and autosaving its settings, and
 * its icons while it is a draft. Returns false when the path is not one of them.
 */
export async function setupRoute(
  app: AppContext,
  id: string,
  found: Loaded,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const get = req.method === "GET";
  const draft = "draft" in found;
  if (draft && get && (rest === "/" || rest === "")) {
    redirect(res, `/p/${id}/setup`);
    return true;
  }
  if (rest === "/setup" && get) {
    if (!draft) redirect(res, `/p/${id}/`);
    else {
      markOpened(app.storage, id);
      sendHtml(res, wizardHtml(app.token, found.draft.name));
    }
    return true;
  }
  if (rest === "/api/settings" && get) {
    const s = readSettings(app.storage, { projectId: id });
    send(res, 200, { settings: s, warnings: s ? warnings(s) : [] });
    return true;
  }
  if ((rest === "/api/settings" || rest === "/api/settings/finish") && req.method === "POST") {
    const w = await writeRequest(req, res, app.token);
    if (!w) return true;
    const r = rest === "/api/settings" ? await postSettings(app, id, w.body) : postFinish(app, id);
    send(res, r.status, r.body);
    return true;
  }
  const icon = draft && get ? ICON.exec(rest) : null;
  if (icon?.[1]) {
    const bytes = app.storage.getBytes(projectKey({ projectId: id }, "icons", icon[1]));
    if (!bytes) send(res, 404, { problems: ["Not found."] });
    else {
      res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
      res.end(bytes);
    }
    return true;
  }
  return false;
}

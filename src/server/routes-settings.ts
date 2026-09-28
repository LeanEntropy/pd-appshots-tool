import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { loadDefaults, readSettings, settingsKey } from "../config/project.ts";
import { type ProjectSettings, ProjectSettingsSchema } from "../config/project-schema.ts";
import type { Config } from "../config/schema.ts";
import { consequences, textUsdPerUse, usdRange } from "../settings/consequences.ts";
import { changeField, fieldViews } from "../settings/overrides.ts";
import { AI_STEPS, type AiStep, GROUPS, STEP_LABELS } from "../settings/schema.ts";
import { stableHash } from "../util/hash.ts";
import { settingsPage } from "../view/settings-analysis.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext, Loaded } from "./app-context.ts";
import { redirect, send, sendHtml, writeRequest } from "./http-util.ts";

/**
 * The Settings page of a project (plan-reports 5B): GET /settings (the page),
 * GET /api/analysis-settings (its values) and POST /api/analysis-settings (one change, saved at
 * once; a change with a cost first answers with its consequences and a confirmation key, and
 * is saved only when the page sends it again with that key. The key covers the saved settings,
 * the change and the consequences shown, so a confirmation never applies to numbers that changed
 * in between (another tab, another save): those are shown again instead).
 */
const Body = z.strictObject({
  field: z.string().min(1).max(80),
  value: z.unknown().optional(),
  reset: z.literal(true).optional(),
  confirm: z.string().max(80).optional(),
});

const LATER =
  "Not used yet: this step arrives with the country reports. Your choice is kept for it.";
const NOTES: Partial<Record<AiStep, string>> = {
  textLayer: LATER,
  patterns:
    "Written by the recommendations model (one writer does both today). Its own second opinion arrives with the reports update; today the recommendations' second opinion checks the combined text.",
  countryAdvice: LATER,
  conceptMap: LATER,
  abTests:
    "Writes the A/B tests at the top of the Pilot and Full check reports; code checks every test's evidence. Its own second opinion is not built yet: the switch is kept for it.",
};

function stepCost(c: Config, step: AiStep): string {
  if (step === "screenshotAnalysis")
    return `about ${usdRange(c.estimates.fullAnalysisUsdPerImage)} per image; the same again per image for the second opinion`;
  if (step === "textLayer")
    return `about ${usdRange(c.estimates.layerDiffUsdPerImage)} per image; the same again per image for the second opinion`;
  return `about ${usdRange(textUsdPerUse(c))} per use; the same again for the second opinion`;
}

export function settingsView(s: ProjectSettings, config: Config, root: string) {
  return {
    name: s.name,
    groups: GROUPS,
    steps: AI_STEPS.map((step) => ({
      step,
      label: STEP_LABELS[step],
      cost: stepCost(config, step),
      ...(NOTES[step] ? { note: NOTES[step] } : {}),
    })),
    fields: fieldViews(s, loadDefaults(root), config),
  };
}

const chains = new Map<string, Promise<unknown>>();

/** Changes of one project are saved one after another, never two at once. */
function oneAtATime<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
  const run = (chains.get(id) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => {});
  chains.set(id, tail);
  void tail.then(() => {
    if (chains.get(id) === tail) chains.delete(id);
  });
  return run;
}

const FIXED =
  "This project's settings come from a config file, so they cannot be changed on this page.";

export function postAnalysisSettings(app: AppContext, id: string, raw: unknown): ApiResponse {
  const b = Body.safeParse(raw);
  if (!b.success || (b.data.reset !== true && !("value" in b.data)))
    return {
      status: 400,
      body: { problems: ["The page sent a change the tool cannot read. Reload the page."] },
    };
  const s = readSettings(app.storage, { projectId: id });
  if (!s) return { status: 409, body: { problems: [FIXED] } };
  const found = app.load(id);
  if (!found || "draft" in found)
    return { status: 409, body: { problems: ["Finish setting up this project first."] } };
  const d = loadDefaults(app.root);
  const change = b.data.reset ? { reset: true as const } : { value: b.data.value };
  const r = changeField(s, d, b.data.field, change);
  if ("problem" in r) return { status: 400, body: { problems: [r.problem] } };
  const cons = consequences(found.loaded, r.after);
  const confirmKey = stableHash({ s, field: b.data.field, change, cons }).slice(0, 32);
  if (cons.length && b.data.confirm !== confirmKey)
    return {
      status: 200,
      body: {
        needsConfirm: true,
        field: r.field.label,
        consequences: cons,
        confirmKey,
        ...(b.data.confirm ? { changedMeanwhile: true } : {}),
      },
    };
  const next = ProjectSettingsSchema.parse({ ...r.settings, updatedAt: new Date().toISOString() });
  app.storage.putJson(settingsKey({ projectId: id }), next);
  return {
    status: 200,
    body: {
      saved: true,
      message: b.data.reset
        ? `${r.field.label}: back to the default. Saved.`
        : `${r.field.label}: saved.`,
      view: settingsView(next, r.after, app.root),
    },
  };
}

/** The Settings page's routes; false when the path is not one of them. */
export async function settingsRoute(
  app: AppContext,
  id: string,
  found: Loaded,
  rest: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const get = req.method === "GET";
  if (rest === "/settings" && get) {
    if ("draft" in found) redirect(res, `/p/${id}/setup`);
    else {
      const s = readSettings(app.storage, { projectId: id });
      const view = s ? settingsView(s, found.loaded.config, app.root) : null;
      sendHtml(res, settingsPage(id, app.names(id), view, app.token, FIXED));
    }
    return true;
  }
  if (rest !== "/api/analysis-settings") return false;
  if (get) {
    const s = readSettings(app.storage, { projectId: id });
    if (!s || "draft" in found) send(res, 409, { problems: [FIXED] });
    else send(res, 200, settingsView(s, found.loaded.config, app.root));
    return true;
  }
  if (req.method === "POST") {
    const w = await writeRequest(req, res, app.token);
    if (!w) return true;
    const r = await oneAtATime(id, () => postAnalysisSettings(app, id, w.body));
    send(res, r.status, r.body);
    return true;
  }
  return false;
}

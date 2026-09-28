import { z } from "zod";
import { listConfigFiles, loadConfig } from "../config/load.ts";
import { readSettings, settingsKey } from "../config/project.ts";
import { ProjectSettingsSchema } from "../config/project-schema.ts";
import { readRegistry, upsertEntry } from "../config/registry.ts";
import { list } from "../jobs/index.ts";
import { describeImport } from "../library/import/describe.ts";
import { runImport } from "../library/import/run-import.ts";
import { hasLegacyData } from "../library/import/survey.ts";
import { projectKey } from "../storage/index.ts";
import type { ApiResponse } from "./api.ts";
import type { AppContext } from "./app-context.ts";

/** Projects for the home screen: registry entries with their cached summary and counts. */
export function getProjects(app: AppContext): ApiResponse {
  const reg = readRegistry(app.storage);
  const projects = reg.projects.map((p) => {
    let counts = { competitors: 0, countries: 0 };
    try {
      const s = readSettings(app.storage, { projectId: p.id });
      if (s) counts = { competitors: s.competitors.length, countries: s.markets.length };
    } catch {}
    return { ...p, ...counts };
  });
  projects.sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) || b.lastOpenedAt.localeCompare(a.lastOpenedAt),
  );
  return { status: 200, body: { projects } };
}

/** What runs in each lane now, with project names, for the "Working now" strip. */
export function getJobs(app: AppContext): ApiResponse {
  const lanes = list(app.storage).map((l) => ({ ...l, name: app.names(l.projectId) }));
  return { status: 200, body: { lanes } };
}

const ArchiveBody = z.strictObject({ archived: z.boolean() });

/** Archive hides a project's card; nothing is deleted (plan D5). */
export function postArchive(app: AppContext, id: string, raw: unknown): ApiResponse {
  const parsed = ArchiveBody.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { problems: ["The request was not clear."] } };
  const s = readSettings(app.storage, { projectId: id });
  const e = readRegistry(app.storage).projects.find((p) => p.id === id);
  if (!s || !e) return { status: 404, body: { problems: ["There is no such project."] } };
  const next = ProjectSettingsSchema.parse({
    ...s,
    archived: parsed.data.archived,
    updatedAt: new Date().toISOString(),
  });
  app.storage.putJson(settingsKey({ projectId: id }), next);
  upsertEntry(app.storage, { ...e, archived: parsed.data.archived });
  return { status: 200, body: { archived: parsed.data.archived } };
}

interface Found {
  configFile: string;
  id: string;
  name: string;
  images: number;
  analyses: number;
}

let importing: { id: string; state: "running" | "done" | "failed"; text: string } | null = null;

/** Projects made before the shared library, found on disk and offered for import (never automatic). */
export function legacyProjects(app: AppContext): Found[] {
  const out: Found[] = [];
  for (const file of listConfigFiles(app.root)) {
    try {
      const c = loadConfig(file).config;
      const ctx = { projectId: c.project };
      if (app.storage.exists(settingsKey(ctx)) || !hasLegacyData(app.storage, ctx)) continue;
      const db = app.storage.getJson(projectKey(ctx, "images", "db.json")) as
        | { images?: Record<string, unknown> }
        | undefined;
      let analyses = 0;
      for (const k of app.storage.list(projectKey(ctx, "analysis")))
        if (k.endsWith(".json")) analyses++;
      out.push({
        configFile: file,
        id: c.project,
        name: c.ourApp.name,
        images: Object.keys(db?.images ?? {}).length,
        analyses,
      });
    } catch {}
  }
  return out;
}

export function getImport(app: AppContext): ApiResponse {
  return {
    status: 200,
    body: {
      found: legacyProjects(app).map(({ configFile: _f, ...f }) => f),
      importing,
    },
  };
}

const ImportBody = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]{1,60}$/),
  dryRun: z.boolean().optional(),
});

/**
 * The Import button: a dry run (reads only) shows what will happen; the real import runs only
 * on the user's explicit request, in the background, holding the library and lane locks.
 */
export async function postImport(app: AppContext, raw: unknown): Promise<ApiResponse> {
  const parsed = ImportBody.safeParse(raw);
  if (!parsed.success) return { status: 400, body: { problems: ["The request was not clear."] } };
  const found = legacyProjects(app).find((f) => f.id === parsed.data.id);
  if (!found) return { status: 404, body: { problems: ["There is no such project to import."] } };
  if (parsed.data.dryRun) {
    const r = await runImport({ root: app.root, configPath: found.configFile, apply: false });
    return { status: 200, body: { text: describeImport(r) } };
  }
  if (importing?.state === "running")
    return { status: 409, body: { problems: ["An import is running already."] } };
  importing = { id: found.id, state: "running", text: "Importing: checking every image…" };
  const current = importing;
  void runImport({ root: app.root, configPath: found.configFile, apply: true, verifyHashes: true })
    .then((r) => {
      current.state =
        r.status === "imported" || r.status === "already-imported" ? "done" : "failed";
      current.text = describeImport(r);
    })
    .catch((e: unknown) => {
      current.state = "failed";
      current.text = e instanceof Error ? e.message : String(e);
    });
  return { status: 202, body: { importing } };
}

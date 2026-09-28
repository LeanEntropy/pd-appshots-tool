import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadProject } from "../../src/config/project.ts";
import { runImport } from "../../src/library/import/run-import.ts";
import { startAppServer } from "../../src/server/app-server.ts";
import { files, legacyProject } from "./imported.ts";

export const TOKEN = "set-token";

export interface FieldView {
  id: string;
  kind: string;
  group: string;
  value: unknown;
  defaultValue: unknown;
  changed: boolean;
  choices?: { value: string; label: string }[];
}

/**
 * A real project on a temp workspace (imported, with a finished pilot of 8 analysed images in
 * the shared library) and the tool's server for it.
 */
export async function settingsServer() {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  const id = loaded.config.project;
  const s = await startAppServer({ root, token: TOKEN });
  const api = `${s.origin}/p/${id}/api/analysis-settings`;
  const post = async (body: unknown) => {
    const r = await fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SSR-Token": TOKEN },
      body: JSON.stringify(body),
    });
    return {
      status: r.status,
      body: (await r.json()) as Record<string, unknown> & {
        problems?: string[];
        consequences?: { text: string; images?: number; usd?: [number, number] }[];
      },
    };
  };
  /** Saves like the page: when asked, answers yes with the confirmation key it was given. */
  const save = async (body: Record<string, unknown>) => {
    const first = await post(body);
    if (!first.body.needsConfirm) return first;
    return post({ ...body, confirm: first.body.confirmKey });
  };
  const view = async () => {
    const r = await fetch(api);
    return (await r.json()) as { fields: FieldView[] };
  };
  const field = async (fid: string) => (await view()).fields.find((f) => f.id === fid);
  const project = () => loadProject(id, { root });
  const settingsFile = join(root, "workspace", id, "project.json");
  return { ...s, id, root, api, post, save, view, field, project, settingsFile };
}

/**
 * Makes the project's analyses look as if another project had paid for them (same settings,
 * shared through the library): after a model change those are the ones not reused.
 */
export function madeByAnotherProject(root: string, id: string): number {
  let n = 0;
  for (const f of files(join(root, "workspace", "_library"))) {
    if (!f.endsWith(".json")) continue;
    const r = JSON.parse(readFileSync(f, "utf8")) as { writtenBy?: string; key?: string };
    if (r.writtenBy !== id || !r.key) continue;
    writeFileSync(f, JSON.stringify({ ...r, writtenBy: "another-project" }));
    n++;
  }
  return n;
}

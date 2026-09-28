import assert from "node:assert/strict";
import { test } from "node:test";
import { NoBrowserError, startBrowser } from "../src/export/pdf.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { exportHooks } from "../src/server/export-api.ts";
import { tempProject } from "./helpers/project.ts";

const JSON_HEADERS = { "Content-Type": "application/json", "X-SSR-Token": "pdf-token" };

async function server() {
  const loaded = await tempProject({ Heroll: { phone: 2, tablet: 0 } });
  const s = await startAppServer({ root: loaded.root, projects: [loaded], token: "pdf-token" });
  const base = `${s.origin}/p/${loaded.config.project}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
    fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { ...s, base, post };
}

async function waitDone(base: string, id: string) {
  for (;;) {
    const r = (await (await fetch(`${base}/api/export/pdf/status?job=${id}`)).json()) as {
      job: { state: string; error: string | null; path: string | null };
    };
    if (r.job.state !== "waiting" && r.job.state !== "running") return r.job;
    await new Promise((res) => setTimeout(res, 50));
  }
}

test("export routes: token required, job with progress, download, open and show in folder", async () => {
  const opened: [string, boolean][] = [];
  exportHooks.deps = { render: async () => Buffer.from("%PDF-routes") };
  exportHooks.open = (p, reveal) => void opened.push([p, reveal]);
  const s = await server();
  try {
    const body = { report: { stage: "pilot", run: "current" }, images: false };
    assert.equal(
      (await s.post("/api/export/pdf", body, { "Content-Type": "application/json" })).status,
      403,
    );
    assert.equal(
      (await s.post("/api/export/pdf", { report: { stage: "x", run: "current" } })).status,
      400,
    );
    const unknown = await s.post("/api/export/pdf", {
      report: { stage: "pilot", run: "2020-01-01-pilot" },
    });
    assert.equal(unknown.status, 404);
    const r = (await (await s.post("/api/export/pdf", body)).json()) as { job: { id: string } };
    const job = await waitDone(s.base, r.job.id);
    assert.equal(job.state, "finished");
    const file = await fetch(`${s.base}/api/export/pdf/file?job=${r.job.id}`);
    assert.equal(file.headers.get("content-type"), "application/pdf");
    assert.match(file.headers.get("content-disposition") ?? "", /attachment; filename="Pilot/);
    assert.equal(await file.text(), "%PDF-routes");
    assert.equal((await fetch(`${s.base}/api/export/pdf/file?job=0000000000000000`)).status, 404);
    assert.equal(
      (await s.post("/api/export/pdf/open", { job: r.job.id, reveal: true })).status,
      200,
    );
    assert.equal((await s.post("/api/export/pdf/open", { job: r.job.id })).status, 200);
    assert.deepEqual(opened, [
      [job.path, true],
      [job.path, false],
    ]);
    assert.equal((await s.post("/api/export/pdf/open", { job: "../../x" })).status, 400);
    const page = await fetch(`${s.base}/views/report-print.html?stage=pilot&run=current&images=0`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<title>Pilot \(/);
    assert.equal((await fetch(`${s.base}/views/report-print.html?stage=nope`)).status, 400);
  } finally {
    exportHooks.deps = {};
    s.server.close();
  }
});

test("real PDF with the installed Chrome or Edge (skipped when there is none)", async (t) => {
  try {
    await (await startBrowser(null)).close();
  } catch (e) {
    if (e instanceof NoBrowserError) return t.skip("no Chrome or Edge on this computer");
    throw e;
  }
  exportHooks.deps = {};
  const s = await server();
  try {
    const r = (await (
      await s.post("/api/export/pdf", { report: { stage: "pilot", run: "current" } })
    ).json()) as { job: { id: string } };
    const job = await waitDone(s.base, r.job.id);
    assert.equal(job.state, "finished", job.error ?? "");
    const pdf = Buffer.from(
      await (await fetch(`${s.base}/api/export/pdf/file?job=${r.job.id}`)).arrayBuffer(),
    );
    const text = pdf.toString("latin1");
    assert.ok(text.startsWith("%PDF-"));
    assert.ok((text.match(/\/Type\s*\/Page\b/g) ?? []).length >= 2, "has pages");
    assert.match(text, /\/Outlines/, "has bookmarks");
  } finally {
    s.server.close();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { startAppServer } from "../src/server/app-server.ts";
import { homeHtml } from "../src/view/home-html.ts";
import { receiver, sender } from "./helpers/share.ts";

const TOKEN = "share-token";
const headers = { "Content-Type": "application/json", "X-SSR-Token": TOKEN };
const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers, body: JSON.stringify(body) });

async function until<T>(get: () => Promise<T | null>): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const v = await get();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("timed out");
}

test("from the project's Overview to a friend's home page, through the tool's own endpoints", async () => {
  const s = await sender();
  const a = await startAppServer({ root: s.root, token: TOKEN });
  const b = await startAppServer({ root: receiver().root, token: TOKEN });
  try {
    const api = `${a.origin}/p/${s.id}/api`;
    const info = (await (await fetch(`${api}/share`)).json()) as {
      sizes: { light: { bytes: number }; full: { bytes: number }; images: number };
      previewOnly: number;
    };
    assert.ok(info.sizes.light.bytes > 0 && info.sizes.light.bytes < info.sizes.full.bytes);
    assert.equal(info.previewOnly, 0);
    const page = await (await fetch(`${a.origin}/p/${s.id}/views/gallery.html`)).text();
    assert.match(page, /id="sharePanel"/);

    assert.equal((await post(`${api}/share/export`, { kind: "light" })).status, 202);
    const done = await until(async () => {
      const r = (await (await fetch(`${api}/share?sizes=0`)).json()) as {
        export: { state: string; result: { exportId: string; fileName: string } | null };
      };
      assert.notEqual(r.export.state, "failed");
      return r.export.state === "done" ? r.export.result : null;
    });
    assert.match(done?.fileName ?? "", /^rogue-legend-\d{4}-\d{2}-\d{2}-light\.zip$/);
    const file = await fetch(`${api}/share/file?id=${done?.exportId}`);
    assert.equal(file.headers.get("content-type"), "application/zip");
    assert.match(file.headers.get("content-disposition") ?? "", /attachment/);
    const zip = Buffer.from(await file.arrayBuffer());

    // The friend's tool: an upload needs the page's token.
    const bad = await fetch(`${b.origin}/api/share/upload`, { method: "POST", body: zip });
    assert.equal(bad.status, 403);
    assert.match(homeHtml(TOKEN), /Open a shared project/);
    const up = await fetch(`${b.origin}/api/share/upload`, {
      method: "POST",
      headers: { "X-SSR-Token": TOKEN, "Content-Type": "application/zip" },
      body: zip,
    });
    const { uploadId } = (await up.json()) as { uploadId: string };
    const seen = (await (await post(`${b.origin}/api/share/inspect`, { uploadId })).json()) as {
      inspection: { project: { name: string }; kind: string; collision: unknown };
    };
    assert.equal(seen.inspection.project.name, "Rogue Legend");
    assert.equal(seen.inspection.kind, "light");
    assert.equal(seen.inspection.collision, null);
    assert.equal(
      (await post(`${b.origin}/api/share/import`, { uploadId, mode: "new" })).status,
      202,
    );
    await until(async () => {
      const r = (await (await fetch(`${b.origin}/api/share/import`)).json()) as {
        importing: { state: string; error: string | null };
      };
      assert.notEqual(r.importing.state, "failed", r.importing.error ?? "");
      return r.importing.state === "done" ? true : null;
    });
    const projects = (await (await fetch(`${b.origin}/api/projects`)).json()) as {
      projects: { id: string }[];
    };
    assert.deepEqual(
      projects.projects.map((p) => p.id),
      [s.id],
    );

    // A Light copy: paid work says it needs the full-size pictures first, before any approval.
    const friend = `${b.origin}/p/${s.id}/api`;
    const shared = (await (await fetch(`${friend}/share`)).json()) as { previewOnly: number };
    assert.ok(shared.previewOnly > 0);
    const plan = await post(`${friend}/analysis/plan`, { stage: "core" });
    assert.equal(plan.status, 409);
    const body = (await plan.json()) as { problems: string[] };
    assert.match(body.problems.join(" "), /small preview only.*Download the full-size pictures/);
    const pilot = await post(`${friend}/analysis/plan`, { stage: "pilot" });
    assert.equal(pilot.status, 200, "a batch with nothing to pay for opens as usual");
  } finally {
    a.server.close();
    b.server.close();
  }
});

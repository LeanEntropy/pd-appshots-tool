import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importSeeds } from "../src/kb/import-seed.ts";
import { readApprovals } from "../src/kb/review.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { kbFiles, writeJsonFile } from "../src/storage/kb-files.ts";
import { content, entries, SOURCES, TODAY } from "./helpers/kb.ts";
import { tempProject } from "./helpers/project.ts";

const TOKEN = "t".repeat(32);

test("review list page: approve one entry and the unverified ones in bulk, saved in kb/approvals.json", async () => {
  const loaded = await tempProject({});
  const root = loaded.root;
  const files = kbFiles(root);
  const c = content();
  files.putJson("tags.json", { version: 1, tags: c.tags });
  const seed = mkdtempSync(join(tmpdir(), "seed-"));
  writeJsonFile(join(seed, "entries-t.json"), { file: "entries-t", entries: entries() });
  writeJsonFile(join(seed, "sources-t.json"), { sources: SOURCES });
  importSeeds(files, [seed], TODAY);
  const s = await startAppServer({ root, token: TOKEN });
  try {
    const page = await fetch(`${s.origin}/knowledge`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Knowledge base: review/);
    const list = (await (await fetch(`${s.origin}/api/kb/review`)).json()) as {
      one: { id: string }[];
      bulk: { id: string }[];
    };
    assert.ok(list.one.some((i) => i.id === "h-est"));
    const post = (path: string, body: unknown, token = TOKEN) =>
      fetch(`${s.origin}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-SSR-Token": token },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await post("/api/kb/decision", { entryId: "h-est", decision: "approved" }, "x")).status,
      403,
    );
    const ok = await post("/api/kb/decision", { entryId: "h-est", decision: "approved" });
    assert.equal(ok.status, 200);
    assert.equal(
      (await post("/api/kb/decision", { entryId: "nope-1", decision: "approved" })).status,
      409,
    );
    const bulk = (await (await post("/api/kb/approve-bulk", {})).json()) as { approved: number };
    assert.equal(bulk.approved, list.bulk.length);
    const saved = readApprovals(files);
    assert.equal(saved.length, 1 + list.bulk.length);
    assert.equal(saved.find((d) => d.entryId === "h-est")?.how, "one");
  } finally {
    s.server.close();
  }
});

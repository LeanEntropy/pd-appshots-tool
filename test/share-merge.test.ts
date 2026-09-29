import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { loadProject, readSettings } from "../src/config/project.ts";
import { listProjects } from "../src/config/registry.ts";
import { importPackage } from "../src/share/import.ts";
import { inspectPackage } from "../src/share/inspect.ts";
import { mergeLibraryFile } from "../src/share/merge.ts";
import { pack, receiver, sender, upload } from "./helpers/share.ts";

const libCount = (s: ReturnType<typeof receiver>["storage"]) =>
  ["images", "analysis", "google", "store-text"].reduce(
    (n, f) => n + [...s.list(`library/${f}`)].length,
    0,
  );

test("a project that exists already: refused, imported as a copy, or replaced after asking", async () => {
  const s = await sender();
  const bytes = await pack(s, "light");
  const r = receiver();
  await importPackage(r.storage, upload(r.storage, bytes), "new");
  const files = libCount(r.storage);

  const again = upload(r.storage, bytes);
  const seen = await inspectPackage(r.storage, again);
  seen.ix.close();
  assert.deepEqual(seen.inspection.collision, { name: "Rogue Legend", copyId: `${s.id}-2` });
  assert.equal(seen.inspection.newFiles, 0, "everything is in the library already");
  await assert.rejects(importPackage(r.storage, again, "new"), /already have a project/);

  const copy = await importPackage(r.storage, again, "copy");
  assert.equal(copy.projectId, `${s.id}-2`);
  assert.equal(readSettings(r.storage, { projectId: copy.projectId })?.name, "Rogue Legend (copy)");
  // No picture or shared analysis is stored twice; only the sender's own earlier (unproven)
  // analysis is kept under the copy's name, so the copy sees what the original saw.
  const own = [...r.storage.list("library/analysis")].filter((k) =>
    k.endsWith(`/unproven-${s.id}-2.json`),
  );
  assert.equal(libCount(r.storage), files + own.length, "no library file stored twice");
  assert.equal(copy.library.added, own.length);
  const loaded = loadProject(copy.projectId, { root: r.root });
  assert.equal(buildAnalysisPlan(loaded, "pilot").counts.full, 0, "the copy reuses the analyses");

  const replaced = await importPackage(r.storage, upload(r.storage, bytes), "replace");
  assert.equal(replaced.projectId, s.id);
  assert.match(replaced.replacedTo ?? "", /^shared\/share\/replaced\/rogue-legend-/);
  assert.ok(r.storage.exists(`${replaced.replacedTo}/project.json`), "the old one is kept aside");
  assert.deepEqual(
    listProjects(r.storage)
      .map((p) => p.id)
      .sort(),
    [s.id, `${s.id}-2`],
  );
});

test("library merge: existing records win unless the incoming one is newer and usable", () => {
  const r = receiver();
  const sha = "c".repeat(64);
  const k = `library/analysis/${sha}/key1.json`;
  const rec = (updatedAt: string, status: string, final: unknown) =>
    Buffer.from(JSON.stringify({ imageId: sha, status, updatedAt, final }));
  assert.equal(mergeLibraryFile(r.storage, k, rec("2026-01-02", "ok", { a: 1 })), "added");
  assert.equal(mergeLibraryFile(r.storage, k, rec("2026-01-02", "ok", { a: 1 })), "same");
  // Older, or newer but failed: the local one stays.
  assert.equal(mergeLibraryFile(r.storage, k, rec("2026-01-01", "ok", { a: 2 })), "kept");
  assert.equal(mergeLibraryFile(r.storage, k, rec("2026-02-01", "failed", null)), "kept");
  // Newer and usable: taken.
  assert.equal(mergeLibraryFile(r.storage, k, rec("2026-03-01", "ok", { a: 3 })), "updated");
  assert.deepEqual((r.storage.getJson(k) as { final: unknown }).final, { a: 3 });

  // Google image links and cost records are unions.
  const g = "library/google/abc.json";
  const gfile = (entries: { sha256: string; firstSeen: string }[]) =>
    Buffer.from(JSON.stringify({ version: 1, googleId: "x", entries }));
  mergeLibraryFile(r.storage, g, gfile([{ sha256: "1", firstSeen: "2026-01-01" }]));
  assert.equal(
    mergeLibraryFile(r.storage, g, gfile([{ sha256: "2", firstSeen: "2026-02-01" }])),
    "updated",
  );
  assert.equal((r.storage.getJson(g) as { entries: unknown[] }).entries.length, 2);
  const a = `library/attempts/${sha}/key1.json`;
  const att = (attemptId: string) => ({
    attemptId,
    projectId: "p",
    runId: "r",
    batchId: null,
    state: "finished",
    usd: 0.1,
    estimateUsd: 0.1,
    at: "2026-01-01",
  });
  const log = (...ids: string[]) =>
    Buffer.from(JSON.stringify({ imageId: sha, attempts: ids.map(att) }));
  mergeLibraryFile(r.storage, a, log("a1"));
  assert.equal(mergeLibraryFile(r.storage, a, log("a1", "a2")), "updated");
  assert.equal((r.storage.getJson(a) as { attempts: unknown[] }).attempts.length, 2);

  // A content-addressed file already here is kept as it is.
  const f = `library/images/facts/${sha}.json`;
  mergeLibraryFile(r.storage, f, Buffer.from('{"v":1}'));
  assert.equal(mergeLibraryFile(r.storage, f, Buffer.from('{"v":2}')), "kept");
});

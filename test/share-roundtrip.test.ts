import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAnalysisPlan } from "../src/analysis/plan.ts";
import { readRecords } from "../src/analysis/records.ts";
import { projectPaths } from "../src/config/load.ts";
import { loadProject } from "../src/config/project.ts";
import { listProjects } from "../src/config/registry.ts";
import { staticKey } from "../src/server/static.ts";
import { collectProject, estimate } from "../src/share/collect.ts";
import { importPackage } from "../src/share/import.ts";
import { fetchOriginals, originalsProblem, previewOnly } from "../src/share/originals.ts";
import { openPackage, readEntry } from "../src/share/read-zip.ts";
import { pack, receiver, sender, upload } from "./helpers/share.ts";

async function manifestOf(storage: ReturnType<typeof receiver>["storage"], bytes: Buffer) {
  const id = upload(storage, bytes);
  const ix = await openPackage(storage.localPath(`shared/share/incoming/${id}.zip`));
  const m = JSON.parse(
    (await readEntry(ix, ix.entries.get("manifest.json") as never)).bytes.toString(),
  );
  ix.close();
  return m as { kind: string; files: { path: string }[]; counts: { images: number } };
}

test("Light round trip: every page's data arrives, nothing needs analysing again", async () => {
  const s = await sender();
  const sizes = estimate(await collectProject(s.storage, s.id));
  assert.ok(sizes.light.bytes < sizes.full.bytes, "Light is smaller than Full");
  const bytes = await pack(s, "light");
  const r = receiver();
  const m = await manifestOf(r.storage, bytes);
  assert.equal(m.kind, "light");
  assert.ok(!m.files.some((f) => f.path.startsWith("library/images/orig/")), "no originals");
  assert.ok(
    m.files.some((f) => f.path.startsWith("library/images/thumb/")),
    "thumbnails",
  );
  assert.ok(
    m.files.some((f) => f.path.startsWith("library/analysis/")),
    "analyses",
  );

  const res = await importPackage(r.storage, upload(r.storage, bytes), "new");
  assert.equal(res.projectId, s.id);
  assert.equal(res.kind, "light");
  assert.deepEqual(
    listProjects(r.storage).map((p) => p.id),
    [s.id],
  );
  const loaded = loadProject(s.id, { root: r.root });
  const before = readRecords(projectPaths(s.loaded));
  const after = readRecords(projectPaths(loaded));
  assert.equal(after.size, before.size, "every analysis is there");
  const plan = buildAnalysisPlan(loaded, "pilot");
  assert.equal(plan.counts.full, 0, "0 images to analyse again");
  assert.equal(plan.counts.layerDiff, 0);

  // Every picture is a preview only: pages show the thumbnail, paid work asks for originals.
  const previews = previewOnly(r.storage, s.id);
  assert.equal(previews.length, m.counts.images);
  const paths = projectPaths(loaded);
  const one = previews[0] as string;
  assert.equal(staticKey(paths, `images/orig/${one}.png`), `library/images/thumb/${one}.webp`);
  const core = buildAnalysisPlan(loaded, "core");
  const paid = core.items.filter((i) => i.tier !== "identical");
  assert.ok(paid.length > 0);
  const problem = originalsProblem(r.storage, s.id, paid);
  assert.match(problem ?? "", /small preview only.*full-size picture/);
  assert.match(problem ?? "", /Nothing was started or paid/);

  // Downloading the full-size pictures again (same bytes) fills them in.
  const out = await fetchOriginals(r.storage, s.id, {
    fetch: async (url) => {
      const gid = url.slice(url.lastIndexOf("/") + 1, -3);
      const sha = Object.entries(
        (
          s.storage.getJson(`projects/${s.id}/refs.json`) as {
            images: Record<string, { googleIds: string[] }>;
          }
        ).images,
      ).find(([, v]) => v.googleIds.includes(gid))?.[0];
      const orig = sha
        ? [...s.storage.list("library/images/orig")].find((k) => k.includes(sha))
        : null;
      return orig
        ? { status: 200, bytes: s.storage.getBytes(orig) ?? null }
        : { status: 404, bytes: null };
    },
  });
  assert.equal(out.recovered, previews.length);
  assert.equal(previewOnly(r.storage, s.id).length, 0);
  assert.equal(originalsProblem(r.storage, s.id, paid), null);
});

test("Full round trip: originals arrive and are hash-checked; no preview-only pictures", async () => {
  const s = await sender();
  const bytes = await pack(s, "full");
  const r = receiver();
  const m = await manifestOf(r.storage, bytes);
  assert.ok(m.files.some((f) => f.path.startsWith("library/images/orig/")));
  await importPackage(r.storage, upload(r.storage, bytes), "new");
  assert.equal(previewOnly(r.storage, s.id).length, 0);
  const loaded = loadProject(s.id, { root: r.root });
  assert.equal(buildAnalysisPlan(loaded, "pilot").counts.full, 0);
  assert.ok([...r.storage.list("library/images/orig")].length > 0);
});

test("the package carries no folder path of the sender's computer", async () => {
  const s = await sender();
  const bytes = await pack(s, "light");
  const r = receiver();
  const id = upload(r.storage, bytes);
  const ix = await openPackage(r.storage.localPath(`shared/share/incoming/${id}.zip`));
  const needles = [s.root, s.root.replace(/\\/g, "/"), JSON.stringify(s.root).slice(1, -1)];
  for (const [name, e] of ix.entries) {
    if (!/\.(json|md)$/.test(name)) continue;
    const text = (await readEntry(ix, e)).bytes.toString("utf8").toLowerCase();
    for (const n of needles) assert.ok(!text.includes(n.toLowerCase()), `${name} has a local path`);
  }
  ix.close();
});

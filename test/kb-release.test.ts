import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importSeeds } from "../src/kb/import-seed.ts";
import { promote } from "../src/kb/promote.ts";
import { loadKb, loadPinned, pinRelease } from "../src/kb/release.ts";
import { approveBulk, decide, reviewList } from "../src/kb/review.ts";
import { EntrySchema } from "../src/kb/schema.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { writeJsonFile } from "../src/storage/kb-files.ts";
import { entries, SOURCES, TODAY, tempKbDir } from "./helpers/kb.ts";

const base = entries()[4];

test("schema: one atomic entry, enforced rules carry their policy, official classes only on store facts", () => {
  const ok = EntrySchema.safeParse(base);
  assert.ok(ok.success);
  const noPolicy = EntrySchema.safeParse({
    ...base,
    kind: "store_fact",
    ruleClass: "enforced_rule",
    enforcement: null,
  });
  assert.ok(!noPolicy.success);
  const wrongKind = EntrySchema.safeParse({ ...base, ruleClass: "official_guidance" });
  assert.ok(!wrongKind.success);
  const region = EntrySchema.safeParse({ ...base, scope: { ...base?.scope, countries: ["SEA"] } });
  assert.ok(!region.success, "a region is never a scope");
  const mixed = EntrySchema.safeParse({
    ...base,
    scope: { ...base?.scope, countries: ["global", "JP"] },
  });
  assert.ok(!mixed.success);
});

function seedDir() {
  const dir = mkdtempSync(join(tmpdir(), "seed-"));
  const good = entries().map((e) => ({ ...e, researcherConfidence: "high" }));
  writeJsonFile(join(dir, "entries-t.json"), {
    file: "entries-t",
    compiled: TODAY,
    entries: [
      ...good,
      { ...good[4], id: "bad-tag", tags: ["not_a_tag"] },
      {
        ...good[4],
        id: "bad-src",
        support: [{ sourceId: "nope", excerpt: "x", excerptType: "quote", fetched: true }],
      },
      { ...good[4], id: "bad-shape", claim: "" },
    ],
  });
  writeJsonFile(join(dir, "sources-t.json"), { sources: SOURCES });
  writeJsonFile(join(dir, "entries-broken.json"), { entries: "nope" });
  return dir;
}

test("import: valid entries go to the inbox, every reject is listed with its reason, re-runnable", () => {
  const { files } = tempKbDir();
  const dir = seedDir();
  const r = importSeeds(files, [dir], TODAY);
  assert.equal(r.imported, entries().length);
  assert.deepEqual(r.rejects.map((x) => x.id).sort(), ["bad-shape", "bad-src", "bad-tag"]);
  assert.match(r.rejects.find((x) => x.id === "bad-tag")?.reasons[0] ?? "", /unknown tag/);
  assert.equal(r.byTrust.official, 4);
  assert.ok((files.getJson("inbox/import-report.json") as { imported: number }).imported > 0);
  const again = importSeeds(files, [dir], TODAY);
  assert.equal(again.imported, r.imported);
  assert.equal(loadKb(files, "inbox", TODAY).entries.length, r.imported);
});

test("review list: recommendation-driving entries one by one, unverified in bulk; decisions keyed by content", () => {
  const { files } = tempKbDir();
  importSeeds(files, [seedDir()], TODAY);
  const l = reviewList(files, TODAY);
  const one = l.one.map((i) => i.id);
  assert.ok(one.includes("h-est") && one.includes("jp-reg"), "trusted and regulation entries");
  const auto = l.auto.find((i) => i.id === "gp-enf-1");
  assert.ok(!one.includes("gp-enf-1") && auto?.how === "auto" && auto.status === "approved");
  assert.ok(l.bulk.some((i) => i.id === "h-unv") && !one.includes("h-unv"));
  const d = decide(files, TODAY, "h-est", "approved", "user");
  assert.ok(d.ok);
  assert.equal(approveBulk(files, TODAY, "user"), l.bulk.length);
  const after = reviewList(files, TODAY);
  assert.equal(after.counts.approved, 1 + l.bulk.length + l.auto.length);
  // A changed entry asks again.
  const inbox = files.getJson("inbox/entries-t.json") as {
    file: string;
    entries: { id: string; claim: string }[];
  };
  for (const e of inbox.entries) if (e.id === "h-est") e.claim = "A changed claim.";
  files.putJson("inbox/entries-t.json", inbox);
  assert.equal(reviewList(files, TODAY).one.find((i) => i.id === "h-est")?.status, "changed");
});

test("promotion: only approved content becomes a release; version, counts, changelog; pinned snapshot", () => {
  const { files } = tempKbDir();
  importSeeds(files, [seedDir()], TODAY);
  decide(files, TODAY, "h-est", "approved", "user");
  decide(files, TODAY, "gp-enf-1", "approved", "user");
  decide(files, TODAY, "h-corr", "approved", "user");
  const p = promote(files, TODAY);
  assert.equal(p.version, 1);
  // The current official entries are approved automatically (D4).
  assert.deepEqual(p.added.sort(), ["exp-fact", "gp-count", "gp-enf-1", "gp-guid-1", "h-est"]);
  assert.ok(
    p.held.some((h) => h.startsWith("h-corr")),
    "a claim whose counter-claim is undecided is held back, never released uncontested",
  );
  const kb = loadKb(files, "release", TODAY);
  assert.equal(kb.entries.length, 5);
  assert.equal(kb.problems.length, 0);
  assert.equal(kb.meta.version, 1);
  assert.equal(promote(files, TODAY).unchanged, true);
  // Once the counter-claim is approved, both go out together, linked (and contested).
  decide(files, TODAY, "h-counter", "approved", "user");
  assert.deepEqual(promote(files, TODAY).added.sort(), ["h-corr", "h-counter"]);
  const kb2 = loadKb(files, "release", TODAY);
  assert.equal(kb2.computed.get("h-corr")?.contested, true);
  const storage = workspaceStorage(mkdtempSync(join(tmpdir(), "ws-")));
  const hash = pinRelease(storage, kb);
  assert.equal(loadPinned(storage, hash, TODAY)?.entries.length, 5);
  assert.equal(pinRelease(storage, kb), hash, "write-once snapshot");
});

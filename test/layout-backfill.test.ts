import assert from "node:assert/strict";
import { test } from "node:test";
import { readRecords } from "../src/analysis/records.ts";
import { projectPaths } from "../src/config/load.ts";
import { backfillScope, startBackfill } from "../src/layout/backfill.ts";
import { layoutStatus } from "../src/layout/store.ts";
import { runImport } from "../src/library/import/run-import.ts";
import { fakeProvider } from "./helpers/fake-provider.ts";
import { legacyProject } from "./helpers/imported.ts";

test("layouts for earlier images: listed with their cost, run only for the approved list", async () => {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  const scope = backfillScope(loaded);
  assert.ok(scope.items.length > 0);
  assert.equal(scope.ours + scope.competitors, scope.items.length);
  assert.ok(scope.items.every((i) => i.ours || i.where.some((w) => /#[123]$/.test(w))));
  assert.ok(scope.usd[0] > 0 && scope.usd[1] >= scope.usd[0]);

  const fake = fakeProvider({ read: () => ({ screenType: "gameplay", headline: "EPIC" }) });
  const refused = startBackfill(loaded, "0".repeat(64), () => fake);
  assert.equal(refused.ok, false, "a list other than the one shown is refused");
  assert.equal(fake.calls.length, 0);

  const r = startBackfill(loaded, scope.scopeHash, () => fake);
  assert.ok(r.ok);
  const end = await r.done;
  assert.equal(end.state, "finished");
  assert.equal(end.saved, scope.items.length);
  assert.equal(fake.calls.length, scope.items.length, "one layout call per image");
  assert.ok(fake.calls.every((c) => c.prompt.startsWith("Draw the layout")));
  const paths = projectPaths(loaded);
  for (const it of scope.items) {
    const rec = readRecords(paths).get(it.imageId);
    assert.ok(rec);
    const s = layoutStatus(paths, rec);
    assert.equal(s.status, "current");
    assert.equal(s.file?.source, "backfill");
  }
  assert.equal(backfillScope(loaded).items.length, 0, "nothing is offered twice");
});

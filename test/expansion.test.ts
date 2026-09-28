import assert from "node:assert/strict";
import { test } from "node:test";
import { expansionOptions, saveExpansion } from "../src/analysis/expansion.ts";
import { projectPaths } from "../src/config/load.ts";
import { savePick } from "../src/core/selection.ts";
import { enqueue, status } from "../src/jobs/index.ts";
import { readJournal } from "../src/jobs/journal.ts";
import { postAnalysisPlan } from "../src/server/api.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { PICK } from "./helpers/imported.ts";
import { fakeDeps, outcome, settle } from "./helpers/jobs.ts";
import { tempProject } from "./helpers/project.ts";

const DECKS = {
  "Archero 2": { phone: 3, tablet: 0 },
  "Capybara Go": { phone: 2, tablet: 0 },
  "Mini Tales": { phone: 1, tablet: 0 },
  Heroll: { phone: 1, tablet: 0 },
  Dicero: { phone: 1, tablet: 0 },
  "Legend of Slime": { phone: 2, tablet: 0 },
};

test("the expansion question lists the rest with image counts; the choice is only saved", async () => {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  const o = expansionOptions(loaded);
  const slime = loaded.config.competitors.find((c) => c.name === "Legend of Slime");
  assert.ok(slime);
  assert.deepEqual(o.competitors, [{ appId: slime.id, name: "Legend of Slime", images: 2 }]);
  assert.ok(o.countries.length > 0);
  assert.ok(
    o.countries.every((c) => c.images === 0),
    "no country decks downloaded in the test",
  );
  assert.equal(o.saved.savedAt, null);
  const gl = o.countries[0]?.gl as string;
  const r = saveExpansion(loaded, { competitors: [slime.id], countries: [gl] });
  assert.ok(!("problem" in r));
  assert.deepEqual(r.saved.competitors, [slime.id]);
  assert.deepEqual(r.saved.countries, [gl]);
  const paths = projectPaths(loaded);
  const inc = readJournal(workspaceStorage(paths.workspace), paths).increments;
  assert.deepEqual(
    inc.map((i) => [i.kind, i.state]),
    [
      ["competitors", "chosen"],
      ["countries", "chosen"],
    ],
  );
  const bad = saveExpansion(loaded, { competitors: ["com.unknown"], countries: [] });
  assert.ok("problem" in bad);
});

test("a project's status never shows another project's running job as its own", async () => {
  const loaded = await tempProject(DECKS);
  savePick(loaded, PICK, "cli");
  const other = { ...loaded, config: { ...loaded.config, project: "second-game" } };
  const shown = postAnalysisPlan(loaded, { stage: "pilot" }).body as { plan: { planHash: string } };
  let release = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const r = enqueue(
    loaded,
    "analysis",
    { stage: "pilot", planHash: shown.plan.planHash },
    {
      depsFor: (cb) => fakeDeps(cb),
      run: async () => {
        await gate;
        return outcome();
      },
    },
  );
  assert.ok(r.ok);
  assert.equal(status(loaded).running, true);
  const s = status(other);
  assert.equal(s.running, false);
  assert.equal(s.state, "none");
  assert.match(
    s.otherAi ?? "",
    new RegExp(`${projectPaths(loaded).projectId} is using the AI now`),
  );
  release();
  await settle(loaded);
});

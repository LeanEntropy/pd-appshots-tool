/**
 * Text part of the accuracy score: does the model's English meaning of each headline, subline
 * and logo match the frozen reference? One yes/no judgement per text by gpt-5.6-sol (Codex CLI,
 * cross-family), saved to meaning.json for score.ts.
 * Usage: BENCH_ROOT=<scratch>/layout-root npx tsx scripts/layout-bench/meaning.ts
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLayout } from "../../src/layout/checks.ts";
import { run } from "../../src/util/proc.ts";
import { IMAGES, need, OUT, readOut, writeOut } from "./common.ts";
import { type AnswerKey, matchLayer } from "./metrics.ts";
import type { BenchRun } from "./run.ts";

async function main(): Promise<void> {
  need();
  const bench = readOut<BenchRun>("run.json");
  if (!bench) throw new Error("Run run.ts first.");
  const items: { id: string; reference: string; candidate: string }[] = [];
  for (const im of IMAGES) {
    const r = bench.images.find((x) => x.imageId === im.id);
    const key = JSON.parse(readFileSync(join(OUT, "answer-keys", `${im.name}.json`), "utf8")) as AnswerKey;
    const raw = (r?.output as { images: { layout?: unknown }[] } | undefined)?.images[0]?.layout;
    const l = r?.reading ? readLayout(raw, r.reading).layout : null;
    if (!l) continue;
    const mk = matchLayer(key.marketing, l.marketing, key.height / key.width);
    for (const k of key.marketing.filter((e) => ["headline", "subline", "logo"].includes(e.role))) {
      const g = mk.matches.find((x) => x.key.id === k.id)?.got ?? l.marketing.find((e) => e.role === k.role);
      items.push({ id: `${im.name}:${k.id}`, reference: k.textEn ?? "", candidate: g?.textEn ?? "" });
    }
  }
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "same"],
          properties: { id: { type: "string" }, same: { type: "boolean" } },
        },
      },
    },
  };
  const sf = join(tmpdir(), "layout-meaning-schema.json");
  const of = join(tmpdir(), "layout-meaning-out.json");
  writeFileSync(sf, JSON.stringify(schema));
  const prompt = `For each item, answer same=true when the candidate English text conveys the same meaning as the reference English text of a game store screenshot text (wording may differ; a translation of a game name counts as the same name). An empty candidate is never the same.\n\n${JSON.stringify(items, null, 1)}`;
  const args = ["exec", "-m", "gpt-5.6-sol", "-s", "read-only", "--skip-git-repo-check", "--ephemeral"];
  const r = await run("codex", [...args, "--output-schema", sf, "-o", of, "-"], { input: prompt, timeoutMs: 300_000 });
  if (r.code !== 0) throw new Error(r.stderr.slice(-400));
  const out = JSON.parse(readFileSync(of, "utf8")) as { answers: { id: string; same: boolean }[] };
  rmSync(of, { force: true });
  writeOut("meaning.json", Object.fromEntries(out.answers.map((a) => [a.id, a.same])));
  writeOut("meaning-items.json", items);
  console.log(JSON.stringify(out.answers));
}

await main();

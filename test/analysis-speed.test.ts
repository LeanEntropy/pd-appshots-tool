import assert from "node:assert/strict";
import { test } from "node:test";
import { ledger } from "../src/analysis/budget.ts";
import { rateLimitWait, runPool } from "../src/analysis/pool.ts";
import type { VisionCall } from "../src/analysis/providers.ts";
import {
  claudeArgs,
  claudeEnv,
  cliResult,
  inlineMessage,
  modelRequests,
  usageOf,
} from "../src/analysis/providers-claude.ts";
import { run } from "../src/util/proc.ts";

test("reservations: calls at the same time never pass the spending limit", () => {
  let spent = 0;
  const book = ledger(1, () => spent);
  const a = book.reserve("full-analysis");
  const b = book.reserve("full-analysis");
  assert.ok(a && b, "two ceilings of $0.40 fit in $1");
  assert.equal(book.reserve("full-analysis"), null, "a third would pass the limit");
  assert.ok(Math.abs(book.open() - 0.8) < 1e-9);
  spent += 0.15;
  a.done(0.15);
  assert.ok(book.reserve("full-analysis"), "the freed reservation funds the next call");
  // A call above its ceiling raises the ceiling for the rest of the batch.
  spent += 0.5;
  b.done(0.5);
  assert.equal(book.warnings.length, 1);
  assert.equal(book.reserve("full-analysis"), null, "what is left no longer funds one call");
  // Steps without a known ceiling reserve everything left (they run alone).
  const big = ledger(2, () => 0);
  const w = big.reserve("recommend");
  assert.ok(w && Math.abs(big.remaining()) < 1e-9);
});

function tasks(n: number) {
  return Array.from({ length: n }, (_, i) => i);
}

test("pool: one at a time until a paid call finished, then N at a time; order does not matter", async () => {
  let live = 0;
  let most = 0;
  let paidDone = false;
  const done: number[] = [];
  await runPool(tasks(8), {
    concurrency: 3,
    gate: () => true,
    run: async (t) => {
      live++;
      most = Math.max(most, live);
      if (!paidDone) assert.equal(live, 1, "calls wait for the first paid call (cache warm-up)");
      // Task 0 is a cache hit (nothing paid): the warm-up is the next task.
      await new Promise((r) => setTimeout(r, t === 0 ? 1 : 5 + ((t * 7) % 11)));
      live--;
      done.push(t);
      if (t > 0) paidDone = true;
      return { ok: true, paid: t > 0 };
    },
    shouldStop: () => false,
    sleep: async () => {},
    slowDown: () => {},
  });
  assert.equal(most, 3);
  assert.deepEqual(
    [...done].sort((a, b) => a - b),
    tasks(8),
  );
});

test("pool: Stop starts nothing new and lets running tasks finish", async () => {
  let stop = false;
  const finished: number[] = [];
  await runPool(tasks(10), {
    concurrency: 3,
    gate: () => !stop,
    run: async (t) => {
      if (t === 2) stop = true;
      await new Promise((r) => setTimeout(r, 10));
      finished.push(t);
      return { ok: true, paid: true };
    },
    shouldStop: () => stop,
    sleep: async () => {},
    slowDown: () => {},
  });
  assert.ok(finished.length >= 3 && finished.length <= 4, `finished ${finished.join(",")}`);
});

test("pool: a rate limit drops to one at a time and retries that same task once", async () => {
  const runs: number[] = [];
  let slowed = 0;
  let live = 0;
  let mostAfter = 0;
  let limited = false;
  await runPool(tasks(6), {
    concurrency: 3,
    gate: () => true,
    run: async (t) => {
      runs.push(t);
      live++;
      if (limited) mostAfter = Math.max(mostAfter, live);
      await new Promise((r) => setTimeout(r, t === 1 ? 20 : 5));
      live--;
      const first = t === 1 && runs.filter((x) => x === 1).length === 1;
      if (first) limited = true;
      return { ok: true, paid: true, retryAfterMs: first ? 30_000 : null };
    },
    shouldStop: () => false,
    sleep: async () => {},
    slowDown: () => {
      slowed++;
    },
  });
  assert.equal(slowed, 1);
  assert.equal(runs.filter((x) => x === 1).length, 2, "the rate-limited task is retried once");
  assert.equal(new Set(runs).size, 6);
  assert.ok(mostAfter <= 3);
  assert.equal(rateLimitWait("API Error: 429 rate limit, retry after 12 seconds"), 12_000);
  assert.equal(rateLimitWait("Overloaded"), 60_000);
  assert.equal(rateLimitWait("the schema is not valid JSON"), null);
});

const call = (images = 1): VisionCall => ({
  model: "claude-fable-5-1",
  system: { text: "s", hash: "h", file: "C:/tmp/system.md" },
  prompt: "Analyse this screenshot.",
  images: Array.from({ length: images }, (_, i) => ({
    ref: `img${i + 1}`,
    image: { mimeType: "image/jpeg", bytes: () => Buffer.from([1, 2, 3, i]) },
  })),
  schema: { type: "object" },
  maxBudgetUsd: 0.4,
  timeoutMs: 1000,
});

test("claude: the inline path sends the image in the request, with no tools and no transcript", () => {
  const inline = claudeArgs("claude-fable-5-1", call(), true);
  assert.deepEqual(inline.slice(inline.indexOf("--tools"), inline.indexOf("--tools") + 2), [
    "--tools",
    "",
  ]);
  assert.ok(!inline.includes("Read"));
  assert.ok(inline.includes("--no-session-persistence"));
  assert.deepEqual(
    inline.slice(inline.indexOf("--input-format"), inline.indexOf("--input-format") + 2),
    ["--input-format", "stream-json"],
  );
  const read = claudeArgs("claude-fable-5-1", call(), false);
  assert.ok(read.includes("Read") && !read.includes("--input-format"));
  const line = JSON.parse(inlineMessage(call(2)));
  const content = line.message.content as {
    type: string;
    text?: string;
    source?: { data: string };
  }[];
  assert.equal(content[0]?.text, "Analyse this screenshot.", "the fixed task text first");
  assert.deepEqual(
    content.map((c) => c.type),
    ["text", "text", "image", "text", "image"],
  );
  assert.equal(content[2]?.source?.data, Buffer.from([1, 2, 3, 0]).toString("base64"));
});

test("claude: tokens, seconds and model requests are read from the CLI's result", () => {
  const stream = [
    JSON.stringify({ type: "system", subtype: "init" }),
    JSON.stringify({ type: "assistant", message: { id: "m1", content: [{ type: "thinking" }] } }),
    JSON.stringify({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use" }] } }),
    JSON.stringify({
      type: "result",
      structured_output: { ok: 1 },
      total_cost_usd: 0.13,
      duration_ms: 20000,
      num_turns: 2,
      modelUsage: {
        "claude-fable-5-1": {
          inputTokens: 2,
          outputTokens: 1600,
          cacheReadInputTokens: 6196,
          cacheCreationInputTokens: 2589,
        },
      },
    }),
  ].join("\n");
  const out = cliResult(stream);
  assert.deepEqual(out?.structured_output, { ok: 1 });
  assert.deepEqual(out && usageOf(out), {
    inputTokens: 2,
    outputTokens: 1600,
    cacheReadTokens: 6196,
    cacheWriteTokens: 2589,
    durationMs: 20000,
    turns: 2,
  });
  assert.equal(modelRequests(stream), 1);
  assert.equal(cliResult(JSON.stringify({ result: "x", total_cost_usd: 1 }))?.result, "x");
});

test("claude: no memory or CLAUDE.md files; an empty config only with a setup token", () => {
  const plain = claudeEnv({ PATH: "x" });
  assert.equal(plain.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
  assert.equal(plain.CLAUDE_CODE_DISABLE_CLAUDE_MDS, "1");
  assert.equal(plain.CLAUDE_CONFIG_DIR, undefined);
  const clean = claudeEnv({ PATH: "x", SSR_CLAUDE_OAUTH_TOKEN: "tok" });
  assert.equal(clean.CLAUDE_CODE_OAUTH_TOKEN, "tok");
  assert.match(clean.CLAUDE_CONFIG_DIR ?? "", /ssr-claude-clean$/);
});

test("processes: three at once each get their own input and output; a timeout ends one", async () => {
  const echo = "process.stdin.on('data',d=>process.stdout.write(String(d).toUpperCase()))";
  const outs = await Promise.all(
    ["a", "b", "c"].map((s) => run(process.execPath, ["-e", echo], { input: `${s}${s}${s}` })),
  );
  assert.deepEqual(
    outs.map((o) => o.stdout),
    ["AAA", "BBB", "CCC"],
  );
  const slow = await run(process.execPath, ["-e", "setTimeout(()=>{},10000)"], { timeoutMs: 300 });
  assert.equal(slow.timedOut, true);
  const env = await run(process.execPath, ["-e", "process.stdout.write(process.env.SSR_T||'')"], {
    env: { ...process.env, SSR_T: "yes" },
  });
  assert.equal(env.stdout, "yes");
});

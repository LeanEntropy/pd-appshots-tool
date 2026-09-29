/** Shows the raw stream of one inline-image Haiku call: which tools the model used, per request. */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeArgs, claudeEnv, inlineMessage } from "../../src/analysis/providers-claude.ts";
import type { VisionCall } from "../../src/analysis/providers.ts";
import { run } from "../../src/util/proc.ts";

const img = process.argv[2] ?? "";
const sys = join(tmpdir(), "ssr-haiku-sys.md");
writeFileSync(sys, "You describe images briefly.");
const c: VisionCall = {
  model: "claude-haiku-4-5",
  system: { text: "", hash: "x", file: sys },
  prompt: "Name the dominant colour of the image.",
  images: [{ ref: "img1", image: { mimeType: "image/jpeg", bytes: () => readFileSync(img) } }],
  schema: {
    type: "object",
    properties: { colour: { type: "string" } },
    required: ["colour"],
    additionalProperties: false,
  },
  maxBudgetUsd: 0.05,
  timeoutMs: 120_000,
};
const r = await run("claude", claudeArgs(c.model, c, true), {
  input: inlineMessage(c),
  timeoutMs: 120_000,
  env: claudeEnv(),
});
for (const line of r.stdout.split(/\r?\n/).filter(Boolean)) {
  const o = JSON.parse(line) as {
    type: string;
    subtype?: string;
    message?: { id?: string; content?: { type: string; name?: string }[] };
    num_turns?: number;
  };
  if (o.type === "assistant")
    console.log(
      "assistant",
      o.message?.id,
      (o.message?.content ?? []).map((x) => x.name ?? x.type).join(","),
    );
  else if (o.type === "result") console.log("result turns", o.num_turns);
  else console.log(o.type, o.subtype ?? "");
}

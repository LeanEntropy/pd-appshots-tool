/** Cheap check of the inline-image call path with Haiku (a few tenths of a cent), before the spike. */
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerFor } from "../../src/analysis/providers.ts";

const img = process.argv[2] ?? "";
const sys = join(tmpdir(), "ssr-haiku-sys.md");
writeFileSync(sys, "You describe images briefly.");
const p = providerFor("claude:claude-haiku-4-5", tmpdir(), { inlineImages: true });
const r = await p.call({
  model: p.model,
  system: { text: "You describe images briefly.", hash: "x", file: sys },
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
});
console.log(JSON.stringify(r, null, 1));

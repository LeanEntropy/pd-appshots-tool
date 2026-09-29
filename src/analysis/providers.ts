import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDir } from "../util/fsx.ts";
import { sha256, stableStringify } from "../util/hash.ts";
import { run } from "../util/proc.ts";
import type { RenderedPrompt } from "./prompts.ts";
import { claudeProvider } from "./providers-claude.ts";

/**
 * A provider-neutral image (plan 12B, B1): providers never know about storage. Command-line
 * providers use the local file (or a temporary copy of the bytes); an API provider sends bytes.
 */
export interface ModelImage {
  mimeType: string;
  localPath?: string;
  bytes: () => Buffer;
}

/** A local file for a command-line tool; `done` removes a temporary copy. */
export function localFile(image: ModelImage): { path: string; done: () => void } {
  if (image.localPath) return { path: image.localPath, done: () => {} };
  const ext = image.mimeType === "image/png" ? "png" : "jpg";
  const path = join(tmpdir(), `ssr-img-${process.pid}-${sha256(image.bytes())}.${ext}`);
  writeFileSync(path, image.bytes());
  return { path, done: () => rmSync(path, { force: true }) };
}

export interface VisionCall {
  model: string;
  system: RenderedPrompt;
  /** Task text; the images are listed by reference label. */
  prompt: string;
  images: { ref: string; image: ModelImage }[];
  schema: Record<string, unknown>;
  maxBudgetUsd: number;
  timeoutMs: number;
}

/** Tokens and time of one model call, as the CLI reports them (unknown parts left out). */
export interface CallUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  /** The CLI's own duration of the call. */
  durationMs?: number | null;
  /** Model turns (1 when the image travels inside the request). */
  turns?: number | null;
  /** Wall time from process start to exit. */
  wallMs?: number;
}

export interface VisionResult {
  ok: boolean;
  output: unknown;
  costUsd: number | null;
  error: string | null;
  usage?: CallUsage;
}

export interface Provider {
  family: "anthropic" | "openai";
  model: string;
  call(c: VisionCall): Promise<VisionResult>;
}

/** Codex CLI: images via -i, prompt on stdin (the Windows sandbox blocks file reads). */
export function codexProvider(model: string, schemaDir: string): Provider {
  return {
    family: "openai",
    model,
    async call(c) {
      ensureDir(schemaDir);
      const schemaText = stableStringify(c.schema);
      const schemaFile = join(schemaDir, `${sha256(schemaText)}.json`);
      if (!existsSync(schemaFile)) writeFileSync(schemaFile, schemaText);
      // A random part: several calls may run at once in one process.
      const out = join(tmpdir(), `ssr-codex-${process.pid}-${randomBytes(6).toString("hex")}.json`);
      const refs = c.images.map((i) => i.ref).join(", ");
      const input = c.images.length
        ? `${c.system.text}\n\n${c.prompt}\n\nThe attached images are, in order: ${refs}.`
        : `${c.system.text}\n\n${c.prompt}`;
      const args = ["exec", "-m", model, "-s", "read-only", "--skip-git-repo-check", "--ephemeral"];
      const files = c.images.map((i) => localFile(i.image));
      for (const f of files) args.push("-i", f.path);
      args.push("--output-schema", schemaFile, "-o", out, "-");
      const r = await run("codex", args, { input, timeoutMs: c.timeoutMs }).finally(() => {
        for (const f of files) f.done();
      });
      try {
        const text = readFileSync(out, "utf8");
        if (r.code !== 0)
          return { ok: false, output: null, costUsd: null, error: r.stderr.slice(-400) };
        return { ok: true, output: JSON.parse(text), costUsd: null, error: null };
      } catch {
        return {
          ok: false,
          output: null,
          costUsd: null,
          error: r.timedOut ? "timed out" : r.stderr.slice(-400) || "no output",
        };
      } finally {
        rmSync(out, { force: true });
      }
    },
  };
}

export interface ProviderOptions {
  /** Claude only: the image travels inside the request (Settings, "Send the image inside the request"). */
  inlineImages?: boolean;
}

/** Provider for a config model reference like "claude:claude-fable-5-1". */
export function providerFor(ref: string, schemaDir: string, o: ProviderOptions = {}): Provider {
  const [kind, model] = ref.split(":") as [string, string];
  if (kind === "claude")
    return claudeProvider(model, { inlineImages: !!o.inlineImages, localFile });
  if (kind === "codex") return codexProvider(model, schemaDir);
  throw new Error(`Unknown model provider in "${ref}".`);
}

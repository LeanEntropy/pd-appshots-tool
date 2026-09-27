import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDir } from "../util/fsx.ts";
import { sha256, stableStringify } from "../util/hash.ts";
import { run } from "../util/proc.ts";
import type { RenderedPrompt } from "./prompts.ts";

export interface VisionCall {
  model: string;
  system: RenderedPrompt;
  /** Task text; the images are listed by reference label. */
  prompt: string;
  images: { ref: string; path: string }[];
  schema: Record<string, unknown>;
  maxBudgetUsd: number;
  timeoutMs: number;
}

export interface VisionResult {
  ok: boolean;
  output: unknown;
  costUsd: number | null;
  error: string | null;
}

export interface Provider {
  family: "anthropic" | "openai";
  model: string;
  call(c: VisionCall): Promise<VisionResult>;
}

/**
 * Claude Code CLI with the cost-saving flags proven in the bake-off (custom system prompt file).
 * The JSON schema must be an argument (the CLI takes no file); util/proc.ts starts claude.exe
 * directly, never through cmd.exe, so the JSON arrives intact on Windows.
 */
export function claudeProvider(model: string): Provider {
  return {
    family: "anthropic",
    model,
    async call(c) {
      const list = c.images.map((i) => `${i.ref}: ${i.path}`).join("\n");
      const input = c.images.length
        ? `${c.prompt}\n\nRead each image file with the Read tool, then answer.\n${list}`
        : c.prompt;
      const tools = c.images.length
        ? ["--tools", "Read", "--allowedTools", "Read"]
        : ["--tools", ""];
      const args = [
        "-p",
        "--model",
        model,
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--strict-mcp-config",
        "--system-prompt-file",
        c.system.file,
        ...tools,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(c.schema),
        "--max-budget-usd",
        c.maxBudgetUsd.toFixed(2),
      ];
      const r = await run("claude", args, { input, timeoutMs: c.timeoutMs });
      try {
        const out = JSON.parse(r.stdout) as {
          is_error?: boolean;
          structured_output?: unknown;
          total_cost_usd?: number;
          result?: string;
        };
        const cost = typeof out.total_cost_usd === "number" ? out.total_cost_usd : null;
        if (r.code !== 0 || out.is_error || out.structured_output === undefined) {
          return {
            ok: false,
            output: null,
            costUsd: cost,
            error: (out.result ?? r.stderr ?? "no structured output").slice(0, 400),
          };
        }
        return { ok: true, output: out.structured_output, costUsd: cost, error: null };
      } catch {
        return {
          ok: false,
          output: null,
          costUsd: null,
          error: r.timedOut ? "timed out" : (r.stderr || r.stdout).slice(0, 400),
        };
      }
    },
  };
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
      const out = join(tmpdir(), `ssr-codex-${process.pid}-${Date.now()}.json`);
      const refs = c.images.map((i) => i.ref).join(", ");
      const input = c.images.length
        ? `${c.system.text}\n\n${c.prompt}\n\nThe attached images are, in order: ${refs}.`
        : `${c.system.text}\n\n${c.prompt}`;
      const args = ["exec", "-m", model, "-s", "read-only", "--skip-git-repo-check", "--ephemeral"];
      for (const i of c.images) args.push("-i", i.path);
      args.push("--output-schema", schemaFile, "-o", out, "-");
      const r = await run("codex", args, { input, timeoutMs: c.timeoutMs });
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

/** Provider for a config model reference like "claude:claude-fable-5-1". */
export function providerFor(ref: string, schemaDir: string): Provider {
  const [kind, model] = ref.split(":") as [string, string];
  if (kind === "claude") return claudeProvider(model);
  if (kind === "codex") return codexProvider(model, schemaDir);
  throw new Error(`Unknown model provider in "${ref}".`);
}

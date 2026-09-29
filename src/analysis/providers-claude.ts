import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDir } from "../util/fsx.ts";
import { run } from "../util/proc.ts";
import type { CallUsage, Provider, VisionCall, VisionResult } from "./providers.ts";

export interface ClaudeOptions {
  /**
   * Send the images inside the request (stream-json input with image blocks, no tools, one
   * model turn) instead of listing file paths for the Read tool (a second turn).
   */
  inlineImages?: boolean;
  /** Local file of an image, for the Read-tool path (providers.ts localFile). */
  localFile: (c: VisionCall["images"][number]["image"]) => { path: string; done: () => void };
}

/**
 * Environment of every `claude -p` call. The CLI otherwise adds the user's auto-memory file and
 * CLAUDE.md files to each call. When SSR_CLAUDE_OAUTH_TOKEN holds a token from
 * `claude setup-token`, the call also runs with an empty config folder, so the account's e-mail
 * address (kept in the user's config) is not added either.
 */
export function claudeEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...base,
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
  };
  const token = base.SSR_CLAUDE_OAUTH_TOKEN?.trim();
  if (token) {
    const dir = join(tmpdir(), "ssr-claude-clean");
    ensureDir(dir);
    env.CLAUDE_CODE_OAUTH_TOKEN = token;
    env.CLAUDE_CONFIG_DIR = dir;
  }
  return env;
}

/** Arguments of one call; `inline` switches the input to stream-json with image blocks. */
export function claudeArgs(model: string, c: VisionCall, inline: boolean): string[] {
  const readTool = c.images.length > 0 && !inline;
  return [
    "-p",
    "--model",
    model,
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--system-prompt-file",
    c.system.file,
    ...(readTool ? ["--tools", "Read", "--allowedTools", "Read"] : ["--tools", ""]),
    ...(inline
      ? ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"]
      : ["--output-format", "json"]),
    "--json-schema",
    JSON.stringify(c.schema),
    "--max-budget-usd",
    c.maxBudgetUsd.toFixed(2),
  ];
}

/**
 * The one stdin line of the inline path: the fixed task text first, then each image after its
 * reference label (the per-call part last, so everything before it can come from the cache).
 */
export function inlineMessage(c: VisionCall): string {
  const content: unknown[] = [{ type: "text", text: c.prompt }];
  for (const i of c.images) {
    content.push({ type: "text", text: `${i.ref}:` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: i.image.mimeType,
        data: i.image.bytes().toString("base64"),
      },
    });
  }
  return `${JSON.stringify({ type: "user", message: { role: "user", content } })}\n`;
}

interface CliResult {
  type?: string;
  is_error?: boolean;
  structured_output?: unknown;
  total_cost_usd?: number;
  result?: string;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
    }
  >;
}

/** The final result object: the whole stdout (json) or the last "result" line (stream-json). */
export function cliResult(stdout: string): CliResult | null {
  const text = stdout.trim();
  if (!text) return null;
  try {
    const one = JSON.parse(text) as CliResult;
    if (!Array.isArray(one)) return one;
  } catch {
    // stream-json: one JSON object per line
  }
  const lines = text.split(/\r?\n/).reverse();
  for (const l of lines) {
    try {
      const o = JSON.parse(l) as CliResult;
      if (o.type === "result") return o;
    } catch {}
  }
  return null;
}

/** Tokens and time of one call, summed over every model the CLI used. */
export function usageOf(out: CliResult): CallUsage | null {
  const models = Object.values(out.modelUsage ?? {});
  const u = out.usage;
  if (!models.length && !u) return null;
  const sum = (f: (m: (typeof models)[number]) => number | undefined) =>
    models.reduce((n, m) => n + (f(m) ?? 0), 0);
  return {
    inputTokens: models.length ? sum((m) => m.inputTokens) : (u?.input_tokens ?? 0),
    outputTokens: models.length ? sum((m) => m.outputTokens) : (u?.output_tokens ?? 0),
    cacheReadTokens: models.length
      ? sum((m) => m.cacheReadInputTokens)
      : (u?.cache_read_input_tokens ?? 0),
    cacheWriteTokens: models.length
      ? sum((m) => m.cacheCreationInputTokens)
      : (u?.cache_creation_input_tokens ?? 0),
    durationMs: out.duration_ms ?? null,
    turns: out.num_turns ?? null,
  };
}

/**
 * Claude Code CLI with the cost-saving flags proven in the bake-off (custom system prompt file,
 * no transcript, no memory files). The JSON schema must be an argument (the CLI takes no file);
 * util/proc.ts starts claude.exe directly, never through cmd.exe, so the JSON arrives intact.
 */
export function claudeProvider(model: string, o: ClaudeOptions): Provider {
  const inline = !!o.inlineImages;
  return {
    family: "anthropic",
    model,
    async call(c): Promise<VisionResult> {
      const started = Date.now();
      const useInline = inline && c.images.length > 0;
      const files = useInline ? [] : c.images.map((i) => ({ ref: i.ref, ...o.localFile(i.image) }));
      const list = files.map((i) => `${i.ref}: ${i.path}`).join("\n");
      const input = useInline
        ? inlineMessage(c)
        : c.images.length
          ? `${c.prompt}\n\nRead each image file with the Read tool, then answer.\n${list}`
          : c.prompt;
      const r = await run("claude", claudeArgs(model, c, useInline), {
        input,
        timeoutMs: c.timeoutMs,
        env: claudeEnv(),
      }).finally(() => {
        for (const f of files) f.done();
      });
      const out = cliResult(r.stdout);
      const usage = out ? usageOf(out) : null;
      const wallMs = Date.now() - started;
      const withWall = usage ? { ...usage, wallMs } : { wallMs };
      if (!out)
        return {
          ok: false,
          output: null,
          costUsd: null,
          error: r.timedOut ? "timed out" : (r.stderr || r.stdout).slice(0, 400),
          usage: withWall,
        };
      const cost = typeof out.total_cost_usd === "number" ? out.total_cost_usd : null;
      if (r.code !== 0 || out.is_error || out.structured_output === undefined) {
        return {
          ok: false,
          output: null,
          costUsd: cost,
          error: (out.result || r.stderr || "no structured output").slice(0, 400),
          usage: withWall,
        };
      }
      return {
        ok: true,
        output: out.structured_output,
        costUsd: cost,
        error: null,
        usage: withWall,
      };
    },
  };
}

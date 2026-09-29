import type { CallUsage } from "./providers.ts";

/** Tokens and time of two calls added up (an answer that needed a repair). */
export function addUsage(
  a: CallUsage | undefined,
  b: CallUsage | undefined,
): CallUsage | undefined {
  if (!b) return a;
  if (!a) return { ...b };
  const n = (x?: number | null) => x ?? 0;
  return {
    inputTokens: n(a.inputTokens) + n(b.inputTokens),
    outputTokens: n(a.outputTokens) + n(b.outputTokens),
    cacheReadTokens: n(a.cacheReadTokens) + n(b.cacheReadTokens),
    cacheWriteTokens: n(a.cacheWriteTokens) + n(b.cacheWriteTokens),
    durationMs: n(a.durationMs) + n(b.durationMs),
    turns: n(a.turns) + n(b.turns),
    requests: n(a.requests) + n(b.requests),
    wallMs: n(a.wallMs) + n(b.wallMs),
  };
}

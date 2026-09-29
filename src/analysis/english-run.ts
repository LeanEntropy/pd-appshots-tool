import { join } from "node:path";
import { z } from "zod";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { priceOf } from "../kb/cost.ts";
import { layoutStatus, readOlderLayout } from "../layout/store.ts";
import { answerKey } from "../library/layout.ts";
import { workspaceStorage } from "../storage/index.ts";
import { acquireAll, LOCKS } from "../storage/leases.ts";
import { stableHash } from "../util/hash.ts";
import { ledger } from "./budget.ts";
import { type CallContext, validatedCall } from "./call.ts";
import { saveEnglish } from "./english-store.ts";
import { textRows } from "./image-texts.ts";
import { renderEnglishPrompt } from "./prompts.ts";
import { type Provider, providerFor } from "./providers.ts";
import { isUsable, readRecords } from "./records.ts";

/**
 * "Add English" (plan-games-library I1b, user decision D3): the marketing texts of the
 * project's analysed pictures that have no English saved anywhere yet, translated text only
 * (no picture) by the translation model, 40 texts per call, behind the usual approval screen (count,
 * cost, limit first). Each answer is saved per exact text and language in the shared library,
 * so the same words are never paid for twice. Nothing runs until the user approves.
 */
export const ENGLISH_STEP = "english-texts";
/** Translation is the config's "translate" role (Opus 5.5 by default), never Sonnet. */
export const englishModel = (loaded: LoadedConfig): string => loaded.config.models.translate;
export const TEXTS_PER_CALL = 40;
/**
 * Per call of up to 40 short texts (text only; the CLI's own overhead dominates), measured on
 * Sonnet 5 ($10 per million output tokens); scaled by the chosen model's price (Opus 5.5: 2x).
 */
const SONNET_USD_PER_CALL: readonly [number, number] = [0.03, 0.08];
const SONNET_OUTPUT_USD_PER_MTOK = 10;
export function englishUsdPerCall(model: string): [number, number] {
  const k = priceOf(model).output / SONNET_OUTPUT_USD_PER_MTOK;
  return [round(SONNET_USD_PER_CALL[0] * k), round(SONNET_USD_PER_CALL[1] * k)];
}

export interface EnglishItem {
  text: string;
  language: string;
  /** How many of the project's pictures carry this text. */
  pictures: number;
}

export interface EnglishScope {
  items: EnglishItem[];
  pictures: number;
  calls: number;
  usd: [number, number];
  limitUsd: number;
  scopeHash: string;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Free to compute: which texts still lack English, and what adding it would cost. */
export function englishScope(loaded: LoadedConfig): EnglishScope {
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const found = new Map<string, EnglishItem & { ids: Set<string> }>();
  const pics = new Set<string>();
  for (const r of readRecords(paths).values()) {
    if (!isUsable(r)) continue;
    // The same layout the image page draws: the current one, else the older one kept.
    const layout =
      layoutStatus(paths, r).file?.layout ?? readOlderLayout(paths, r)?.file.layout ?? null;
    for (const t of textRows(paths, storage, r, layout)) {
      if (t.english || !t.text.trim()) continue;
      const k = `${t.language}\n${t.text}`;
      const had = found.get(k);
      if (had) {
        had.ids.add(r.imageId);
        had.pictures = had.ids.size;
      } else
        found.set(k, {
          text: t.text,
          language: t.language,
          pictures: 1,
          ids: new Set([r.imageId]),
        });
      pics.add(r.imageId);
    }
  }
  const items = [...found.values()]
    .map(({ ids: _, ...it }) => it)
    .sort((a, b) => a.language.localeCompare(b.language) || a.text.localeCompare(b.text));
  const calls = Math.ceil(items.length / TEXTS_PER_CALL);
  const per = englishUsdPerCall(englishModel(loaded));
  const usd: [number, number] = [round(calls * per[0]), round(calls * per[1])];
  const limitUsd = calls ? Math.max(usd[1], per[1]) : 0;
  return {
    items,
    pictures: pics.size,
    calls,
    usd,
    limitUsd,
    scopeHash: stableHash({ items, usd, limitUsd }),
  };
}

const Answer = z.strictObject({
  items: z.array(z.strictObject({ n: z.number().int(), english: z.string() })),
});
type Answer = z.infer<typeof Answer>;

export function englishTask(batch: readonly EnglishItem[]): string {
  return [
    `Translate these ${batch.length} texts into English. Answer with { "items": [{ "n": <number>, "english": "<translation>" }] }, one entry per text.`,
    batch.map((t, i) => `${i + 1}. [${t.language}] ${t.text.replace(/\s+/g, " ")}`).join("\n"),
  ].join("\n\n");
}

export function englishProblems(a: Answer, n: number): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  for (const it of a.items) {
    if (it.n < 1 || it.n > n) out.push(`there is no text number ${it.n}`);
    else if (seen.has(it.n)) out.push(`text ${it.n} is answered more than once`);
    else if (!it.english.trim()) out.push(`text ${it.n} has an empty translation`);
    seen.add(it.n);
  }
  for (let i = 1; i <= n; i++) if (!seen.has(i)) out.push(`text ${i} is missing`);
  return out;
}

export interface EnglishProgress {
  state: "running" | "finished" | "stopped" | "failed";
  done: number;
  total: number;
  saved: number;
  /** Texts whose batch got no valid answer (they can be tried again). */
  failed: number;
  spentUsd: number;
  message: string;
}

const running = new Map<string, { progress: EnglishProgress; stop: boolean }>();

export function englishStatus(loaded: LoadedConfig): EnglishProgress | null {
  return running.get(projectPaths(loaded).projectId)?.progress ?? null;
}

export function stopEnglish(loaded: LoadedConfig): boolean {
  const r = running.get(projectPaths(loaded).projectId);
  if (r?.progress.state !== "running") return false;
  r.stop = true;
  return true;
}

/** Runs the approved list only (the fingerprint the user saw must still match), under its limit. */
export function startEnglish(
  loaded: LoadedConfig,
  scopeHash: string,
  make: (ref: string) => Provider = (ref) =>
    providerFor(ref, join(projectPaths(loaded).objects, "schemas"), {
      inlineImages: loaded.config.options.speed.inlineImages,
    }),
): { ok: true; done: Promise<EnglishProgress> } | { ok: false; status: number; problem: string } {
  const scope = englishScope(loaded);
  if (scope.scopeHash !== scopeHash)
    return {
      ok: false,
      status: 409,
      problem: "The list changed since it was shown. Review it again.",
    };
  if (!scope.items.length)
    return { ok: false, status: 409, problem: "Every text has its English." };
  const paths = projectPaths(loaded);
  const storage = workspaceStorage(paths.workspace);
  const { taxonomy, hash } = loadTaxonomy(loaded);
  const prompt = renderEnglishPrompt(loaded.root, paths.objects, taxonomy);
  const provider = make(englishModel(loaded));
  const held = acquireAll(storage, [LOCKS.ai], { projectId: paths.projectId, kind: ENGLISH_STEP });
  if ("heldBy" in held)
    return {
      ok: false,
      status: 409,
      problem: "Another job is using the AI now. Start this when it finishes.",
    };
  let spent = 0;
  const book = ledger(scope.limitUsd, () => spent);
  const ctx: CallContext = {
    storage,
    answerKey: (step, key) => answerKey(paths, step, key),
    taxonomy,
    taxonomyHash: hash,
    maxBudgetUsd: 0.3,
    remainingUsd: book.remaining,
    timeoutMs: 600_000,
    onCost: (u) => {
      spent += u;
    },
    reserve: book.reserve,
  };
  const job = {
    stop: false,
    progress: {
      state: "running",
      done: 0,
      total: scope.items.length,
      saved: 0,
      failed: 0,
      spentUsd: 0,
      message: "Starting...",
    } as EnglishProgress,
  };
  running.set(paths.projectId, job);
  const p = job.progress;
  const done = (async () => {
    for (let i = 0; i < scope.items.length && !job.stop; i += TEXTS_PER_CALL) {
      const batch = scope.items.slice(i, i + TEXTS_PER_CALL);
      p.message = `Adding English: texts ${i + 1} to ${i + batch.length} of ${p.total}`;
      const r = await validatedCall(
        ENGLISH_STEP,
        provider,
        prompt,
        englishTask(batch),
        [],
        Answer,
        (a) => englishProblems(a, batch.length),
        ctx,
        { texts: stableHash(batch) },
      );
      p.spentUsd = round(spent);
      if (!r.value) {
        // A batch without a valid answer is not "done": the run ends as stopped, not finished.
        p.failed += batch.length;
        if (book.remaining() <= 0.01) break;
        continue;
      }
      p.done += batch.length;
      const at = new Date().toISOString();
      for (const it of r.value.items) {
        const t = batch[it.n - 1];
        if (!t) continue;
        saveEnglish(storage, {
          text: t.text,
          language: t.language,
          english: it.english.trim(),
          model: provider.model,
          at,
        });
        p.saved++;
      }
    }
    p.state = p.done < p.total ? "stopped" : "finished";
    p.message =
      p.state === "finished"
        ? `Finished: English saved for ${p.saved} of ${p.total} texts; $${p.spentUsd.toFixed(2)} spent.`
        : `Stopped: English saved for ${p.saved} of ${p.total} texts${p.failed ? ` (${p.failed} got no valid answer; try again)` : ""}; everything saved is kept; $${p.spentUsd.toFixed(2)} spent.`;
    return p;
  })()
    .catch((e: unknown) => {
      p.state = "failed";
      p.message = `The English step failed: ${e instanceof Error ? e.message : String(e)}`;
      return p;
    })
    .finally(() => held.release());
  return { ok: true, done };
}

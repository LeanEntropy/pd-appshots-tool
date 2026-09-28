import { libraryKey, type Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";
import { type CallContext, validatedCall } from "./call.ts";
import {
  CONCEPT_MAP_SCHEMA,
  type ConceptMap,
  conceptMapProblems,
  conceptMapSchema,
} from "./concept-map-schema.ts";
import { languageName } from "./play-experiments.ts";
import type { RenderedPrompt } from "./prompts.ts";
import type { Provider } from "./providers.ts";

/**
 * The concept map call (plan-reports 3A.2, steps 2 and 3): one text-only call per language,
 * cached in the shared library per exact text set, prompt and model, so the same texts are
 * never sent twice (across projects too). The newest map of the language is passed to the next
 * call, so concept ids stay comparable between versions.
 */
export interface TextSet {
  hl: string;
  texts: string[];
  hash: string;
}

interface Saved {
  hl: string;
  setHash: string;
  promptHash: string;
  schema: string;
  model: string;
  createdAt: string;
  map: ConceptMap;
}

const dir = (hl: string) => libraryKey("concept-maps", hl);

export function conceptMapKey(hl: string, setHash: string, promptHash: string, model: string) {
  return stableHash({ hl, setHash, promptHash, schema: CONCEPT_MAP_SCHEMA, model }).slice(0, 40);
}

function readSaved(storage: Storage, k: string): Saved | undefined {
  try {
    const raw = storage.getJson(k) as Saved | undefined;
    if (!raw) return undefined;
    const p = conceptMapSchema().safeParse(raw.map);
    return p.success ? { ...raw, map: p.data } : undefined;
  } catch {
    return undefined;
  }
}

export function readConceptMap(storage: Storage, hl: string, key: string): ConceptMap | undefined {
  return readSaved(storage, libraryKey("concept-maps", hl, `${key}.json`))?.map;
}

/** The newest map of this language (any text set), or undefined. */
export function previousConceptMap(storage: Storage, hl: string): ConceptMap | undefined {
  let best: Saved | undefined;
  for (const k of storage.list(dir(hl))) {
    if (!k.endsWith(".json")) continue;
    const s = readSaved(storage, k);
    if (s && (!best || s.createdAt > best.createdAt)) best = s;
  }
  return best?.map;
}

/** The cached map for exactly this text set, prompt and model; null when none (no AI). */
export function cachedConceptMap(
  storage: Storage,
  set: TextSet,
  prompt: RenderedPrompt,
  model: string,
): ConceptMap | null {
  const map = readConceptMap(storage, set.hl, conceptMapKey(set.hl, set.hash, prompt.hash, model));
  return map && !conceptMapProblems(map, set.texts).length ? map : null;
}

export function conceptMapTask(set: TextSet, previous: ConceptMap | undefined): string {
  return [
    `Group the words of these store-page texts into concepts. Language: ${languageName(set.hl)} (${set.hl}).`,
    `Texts (${set.texts.length}), one per line:\n${set.texts.map((t, i) => `${i + 1}. ${t.replace(/\n/g, " ")}`).join("\n")}`,
    previous
      ? `The previous concept map of this language (JSON). Keep its concept ids and labels where they still fit; add or drop concepts as the texts need:\n${JSON.stringify(previous)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Writes (or reads from the cache) the concept map of one text set. Invented terms are never saved. */
export async function writeConceptMap(
  set: TextSet,
  provider: Provider,
  prompt: RenderedPrompt,
  ctx: CallContext,
  storage: Storage,
): Promise<{ map: ConceptMap | null; problems: string[] }> {
  const cached = cachedConceptMap(storage, set, prompt, provider.model);
  if (cached) return { map: cached, problems: [] };
  if (!set.texts.length) return { map: null, problems: ["no texts in this language"] };
  const previous = previousConceptMap(storage, set.hl);
  const r = await validatedCall(
    "concept-map",
    provider,
    prompt,
    conceptMapTask(set, previous),
    [],
    conceptMapSchema(),
    (v) => conceptMapProblems(v, set.texts),
    ctx,
    { hl: set.hl, setHash: set.hash },
  );
  if (!r.value) return { map: null, problems: r.problems };
  const key = conceptMapKey(set.hl, set.hash, prompt.hash, provider.model);
  const saved: Saved = {
    hl: set.hl,
    setHash: set.hash,
    promptHash: prompt.hash,
    schema: CONCEPT_MAP_SCHEMA,
    model: provider.model,
    createdAt: new Date().toISOString(),
    map: r.value,
  };
  storage.putJson(libraryKey("concept-maps", set.hl, `${key}.json`), saved);
  return { map: r.value, problems: [] };
}

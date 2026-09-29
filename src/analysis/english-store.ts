import { z } from "zod";
import { libraryKey, type Storage } from "../storage/index.ts";
import { stableHash } from "../util/hash.ts";

/**
 * English of marketing texts, saved once per exact text and language in the shared library
 * (plan-games-library I1b): library/english/<hash>.json. The same words on any picture, in any
 * project, are never paid for twice.
 */
export const ENGLISH_VERSION = "english.v1";

const Saved = z.object({
  version: z.literal(ENGLISH_VERSION),
  text: z.string(),
  language: z.string(),
  english: z.string(),
  model: z.string(),
  at: z.string(),
});
export type SavedEnglish = z.infer<typeof Saved>;

export const englishKey = (text: string, language: string) =>
  libraryKey("english", `${stableHash({ text, language }).slice(0, 40)}.json`);

/** The saved English of one text, or null. */
export function readEnglish(storage: Storage, text: string, language: string): string | null {
  try {
    const r = Saved.safeParse(storage.getJson(englishKey(text, language)));
    return r.success && r.data.text === text ? r.data.english : null;
  } catch {
    return null;
  }
}

export function saveEnglish(storage: Storage, s: Omit<SavedEnglish, "version">): void {
  storage.putJson(englishKey(s.text, s.language), { version: ENGLISH_VERSION, ...s });
}

/** Text in English already (nothing to translate). */
export const isEnglish = (language: string) => /^en\b/i.test(language.trim());

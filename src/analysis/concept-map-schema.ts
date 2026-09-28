import { z } from "zod";

/**
 * The concept map of one language's marketing text (plan-reports 3A.2, step 2): the AI decides
 * the concepts and groups the exact local terms under them; code checks every term is really in
 * the text and belongs to one concept only. Every field is required (OpenAI strict mode too).
 */
export const CONCEPT_MAP_SCHEMA = "concept-map-schema.v1";

const Term = z.strictObject({
  term: z.string().describe("an exact string copied from one of the input texts"),
  kind: z.enum(["loanword", "native", "english", "other"]),
  note: z.string().describe("tone or register, or empty"),
});

const Concept = z.strictObject({
  id: z.string().describe('short lowercase slug, e.g. "battle"'),
  label: z.string().describe("English label"),
  gloss: z.string().describe("one short sentence: what the idea is"),
  terms: z.array(Term),
});

const Schema = z.strictObject({ concepts: z.array(Concept) });

export type ConceptMap = z.infer<typeof Schema>;

export function conceptMapSchema(): z.ZodType<ConceptMap> {
  return Schema;
}

/** NFKC, lower case (Latin), whitespace collapsed: how terms and texts are compared. */
export function normTerm(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Plain problems: terms not in the text, a term in two concepts, repeated ids, empty concepts. */
export function conceptMapProblems(map: ConceptMap, texts: readonly string[]): string[] {
  const problems: string[] = [];
  const hay = texts.map(normTerm);
  const ids = new Set<string>();
  const owner = new Map<string, string>();
  for (const c of map.concepts) {
    if (!c.id.trim()) problems.push(`a concept ("${c.label}") has no id`);
    if (ids.has(c.id)) problems.push(`the concept id "${c.id}" is used twice`);
    ids.add(c.id);
    if (!c.terms.length) problems.push(`the concept "${c.id}" has no terms`);
    const own = new Set<string>();
    for (const t of c.terms) {
      const n = normTerm(t.term);
      if (!n) {
        problems.push(`the concept "${c.id}" has an empty term`);
        continue;
      }
      if (!hay.some((h) => h.includes(n)))
        problems.push(
          `the term "${t.term}" (concept "${c.id}") is not in any of the texts: copy terms exactly`,
        );
      if (own.has(n)) continue;
      own.add(n);
      const other = owner.get(n);
      if (other && other !== c.id)
        problems.push(`the term "${t.term}" is in two concepts ("${other}" and "${c.id}")`);
      else owner.set(n, c.id);
    }
  }
  return problems;
}

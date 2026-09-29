import type { Kb } from "./release.ts";
import type { EnforcedCheck, Store } from "./schema.ts";

/**
 * Enforced platform rules checked by code (decision D1): a recommendation or an A/B variant that
 * breaks one is rejected (repaired by the call, else dropped). A check counts only while one of
 * its entries is in the release as an enforced rule, so every rejection traces to a policy page.
 * Going against official guidance that is NOT enforced is allowed; it is never checked here.
 */
export function activeChecks(kb: Kb, store: Store): EnforcedCheck[] {
  const enforced = kb.entries.filter(
    (e) =>
      !e.retired &&
      e.ruleClass === "enforced_rule" &&
      e.scope.store.includes(store) &&
      // A rule past its review date is not applied as current (as in retrieval).
      !kb.computed.get(e.id)?.stale,
  );
  return kb.checks.filter(
    (k) =>
      k.store === store &&
      k.confirmedBy.trim() !== "" &&
      enforced.some(
        (e) =>
          k.entryIds.includes(e.id) ||
          k.policyUrls.some((u) => !!e.enforcement?.policyUrl.startsWith(u)),
      ),
  );
}

export interface PlacedText {
  where: string;
  text: string;
}

function patternOf(p: string): RegExp | null {
  try {
    return new RegExp(p, "iu");
  } catch {
    return null;
  }
}

/** Problems of the texts on the images and the deck length against the active checks. */
export function enforcedProblems(
  checks: readonly EnforcedCheck[],
  texts: readonly PlacedText[],
  deckLengths: readonly { where: string; n: number }[],
): string[] {
  const out: string[] = [];
  for (const k of checks) {
    if (k.kind === "banned_text") {
      const res = k.patterns.map(patternOf).filter((r): r is RegExp => !!r);
      for (const t of texts)
        if (t.text && res.some((r) => r.test(t.text)))
          out.push(
            `${t.where}: "${t.text}" breaks an enforced store rule (${k.message}); change it`,
          );
    } else {
      for (const d of deckLengths)
        if (d.n < k.min || d.n > k.max)
          out.push(`${d.where}: ${d.n} images breaks an enforced store rule (${k.message})`);
    }
  }
  return out;
}

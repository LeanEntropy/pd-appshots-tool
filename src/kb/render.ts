import type { Kb } from "./release.ts";
import type { Entry } from "./schema.ts";
import { type Computed, countedSources, isTrusted } from "./trust.ts";

/**
 * One entry as the model sees it (plan 4.2): its handle for this call, what it may be used for,
 * the full claim, when it applies, its structured numbers, scope, and how many independent
 * origins back it. Never a URL, a source name or an id: the model cites the handle only, and
 * code renders the citation marker and its links.
 */
const USE: Record<Computed["trust"], string> = {
  official: "Official platform statement",
  established: "Established (3+ independent sources)",
  corroborated: "Corroborated (2+ independent sources)",
  unverified: "Unverified (one source): test idea only",
};

const RULE: Record<Entry["ruleClass"], string> = {
  enforced_rule:
    "ENFORCED RULE: never recommend breaking it (the listing would be refused or removed)",
  official_guidance:
    "Official guidance, not enforced: may be gone against when the evidence says it helps; say so plainly",
  store_behaviour: "How the store works",
  none: "",
};

const STORE: Record<string, string> = { google_play: "Google Play", app_store: "App Store" };

function latestYear(e: Entry, kb: Kb): string {
  const years = e.support
    .map((s) => kb.sourceById.get(s.sourceId)?.published.slice(0, 4) ?? "")
    .filter((y) => /^\d{4}$/.test(y))
    .sort();
  return years.at(-1) ?? "unknown";
}

export function renderEntry(e: Entry, c: Computed, handle: string, kb: Kb): string {
  const label = c.contested
    ? "Contested (a trusted counter-claim exists): test idea only, show both sides"
    : c.stale && e.kind === "store_fact"
      ? `${USE[c.trust]}; past its review date: say "check in the store console", never state it as current`
      : isTrusted(c.trust) || c.trust === "unverified"
        ? USE[c.trust]
        : "";
  const lines = [
    `[${handle}] ${label}${RULE[e.ruleClass] ? ` | ${RULE[e.ruleClass]}` : ""}`,
    `Claim: ${e.claim}`,
    ...(e.appliesWhen ? [`Applies when: ${e.appliesWhen}`] : []),
    ...(e.facts.length
      ? [
          `Numbers: ${e.facts.map((f) => `${f.value} ${f.unit} (${f.of}${f.context ? `; ${f.context}` : ""})`).join("; ")}`,
        ]
      : []),
    ...(e.abDetail
      ? [
          `Case: ${[
            "game",
            "store",
            "market",
            "control",
            "variant",
            "metric",
            "result",
            "durationSample",
          ]
            .filter((k) => e.abDetail?.[k])
            .map((k) => `${k} ${e.abDetail?.[k]}`)
            .join("; ")}`,
        ]
      : []),
    ...(e.enforcement
      ? [
          `Policy wording: "${e.enforcement.exactWording}" Consequence: ${e.enforcement.consequence}.`,
        ]
      : []),
    `Scope: ${e.scope.store.map((s) => STORE[s] ?? s).join(", ")}; ${e.scope.countries.join(", ")}; positions ${e.scope.position.join(", ")}`,
    `Evidence: ${c.origins} independent origin${c.origins === 1 ? "" : "s"}, latest ${latestYear(e, kb)}${c.vendorOnly ? ", industry sources only" : ""}${e.validFor ? `; valid for ${e.validFor}` : ""}`,
    ...(countedSources(e, kb.sourceById).some((s) => s.replaceableByToolData)
      ? [
          "Part of this rests on a researcher's snapshot of store listings: where the computed competitor data covers the same point, the data wins.",
        ]
      : []),
    ...(e.contradicts.length ? [`Counter-claims: ${e.contradicts.length} (given with it)`] : []),
  ];
  return lines.join("\n");
}

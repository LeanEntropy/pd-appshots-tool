import { stableHash } from "../util/hash.ts";
import type { Kb } from "./release.ts";
import type { Decision, Entry, Source } from "./schema.ts";
import type { RefreshLog } from "./source-date.ts";
import { countedSources } from "./trust.ts";

/**
 * Decision D4 (user, 2026-09-29): an entry whose trust is "official" (Google Play's or Apple's own
 * pages: enforced rules, guidance, store behaviour) is approved automatically, but only while it is
 * current: every official page behind it was verified in the last FRESH_DAYS days (the source's
 * accessed date, or a later check by `npm run kb -- refresh-official`) and it is not past its
 * review date. Otherwise it needs a freshness check (not approved, so never released). A refresh
 * that finds the page gone, moved or without the quoted wording sends it to the one-by-one list.
 * A decision the user made himself is never replaced.
 */
export const FRESH_DAYS = 30;
export const AUTO_BY = "auto";
export const AUTO_NOTE = "approved automatically: official source";

export const entryHash = (e: Entry) => stableHash(e);

export type OfficialStateName = "current" | "needs_check" | "changed";
export interface OfficialState {
  state: OfficialStateName;
  /** The oldest verification date among the entry's official pages. */
  verified: string;
  problems: string[];
}

const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86_400_000;

/** The official pages behind an entry (counted, of type official). */
export function officialSources(kb: Kb, e: Entry): Source[] {
  return countedSources(e, kb.sourceById).filter((s) => s.type === "official");
}

/** The state of every official entry of this knowledge base. */
export function officialStates(kb: Kb, log: RefreshLog, today: string): Map<string, OfficialState> {
  const out = new Map<string, OfficialState>();
  for (const e of kb.entries) {
    const c = kb.computed.get(e.id);
    if (c?.trust !== "official") continue;
    const dates = officialSources(kb, e).map((s) => {
      const checked = log.sources[s.id]?.verified ?? "";
      return checked > s.accessed ? checked : s.accessed;
    });
    const verified = dates.length ? ([...dates].sort()[0] ?? "") : "";
    const found = log.entries[e.id];
    if (found && found.contentHash === entryHash(e) && found.problems.length) {
      out.set(e.id, { state: "changed", verified, problems: found.problems });
      continue;
    }
    const problems: string[] = [];
    if (c.stale) problems.push(`past its review date (${e.reviewBy})`);
    if (!verified || daysBetween(verified, today) > FRESH_DAYS)
      problems.push(`official page last verified ${verified || "never"}`);
    out.set(e.id, { state: problems.length ? "needs_check" : "current", verified, problems });
  }
  return out;
}

/**
 * The decisions with D4 applied: current official entries approved automatically (kept as they
 * were when already approved automatically with this content), automatic approvals withdrawn from
 * entries that are no longer current official ones. The user's own decisions stay as they are.
 */
export function applyOfficial(
  kb: Kb,
  decisions: readonly Decision[],
  states: ReadonlyMap<string, OfficialState>,
  today: string,
): Decision[] {
  const byId = new Map(decisions.map((d) => [d.entryId, d]));
  const out = decisions.filter(
    (d) => d.how !== "auto" || states.get(d.entryId)?.state === "current",
  );
  for (const [id, st] of states) {
    const e = kb.byId.get(id);
    const d = byId.get(id);
    if (!e || st.state !== "current" || (d && d.how !== "auto")) continue;
    const hash = entryHash(e);
    if (d?.contentHash === hash) continue;
    const next: Decision = {
      entryId: id,
      contentHash: hash,
      decision: "approved",
      how: "auto",
      by: AUTO_BY,
      at: today,
      note: AUTO_NOTE,
    };
    const i = out.findIndex((x) => x.entryId === id);
    if (i >= 0) out[i] = next;
    else out.push(next);
  }
  return out;
}

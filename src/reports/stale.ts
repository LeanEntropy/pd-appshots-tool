import { PROMPT_VERSIONS } from "../analysis/prompts.ts";
import type { ReportInputs } from "../analysis/report-data.ts";
import { olderStyle } from "./bottom-line.ts";
import type { VersionInputs } from "./types.ts";
import { presetVersionInputs } from "./version.ts";

const OLDER_REASON =
  "Its AI parts are written in the older style (a text-only run, 0 images, rewrites them)";

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
/** "2026-09-30" -> "30 Sep" (the same on every machine). */
const DAY = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""}`;

/**
 * Why the data differs from what a Pilot or Full check version was built from (plan-reports 4.2),
 * in plain words, or null when it does not. Versions saved with a version.json get specific
 * reasons (main country, pick, screen-type list, analyses, store pages); older runs only the
 * fingerprint comparison of the latest pointer, as before.
 */
export function newerReason(
  x: ReportInputs,
  main: { gl: string; hl: string },
  inputs: VersionInputs | null,
  savedHash: string | null,
): string | null {
  if (inputs && (inputs.mainMarket.gl !== main.gl || inputs.mainMarket.hl !== main.hl))
    return "The main country changed.";
  const older = !!inputs?.aiRunId && olderStyle(inputs.versions.prompts, PROMPT_VERSIONS);
  if (!savedHash || savedHash === x.dataHash) return older ? `${OLDER_REASON}.` : null;
  if (!inputs) return "New or updated analyses since this version was made.";
  const reasons: string[] = [];
  const was = new Set(inputs.pick.map((g) => g.appId));
  const now = new Set(x.plan.games.map((g) => g.appId));
  const added = x.plan.games.filter((g) => !was.has(g.appId)).map((g) => `${g.name} added`);
  const removed = inputs.pick.filter((g) => !now.has(g.appId)).map((g) => `${g.name} removed`);
  if (added.length || removed.length)
    reasons.push(`the pick changed (${[...added, ...removed].join(", ")})`);
  if (inputs.versions.taxonomy !== x.plan.versions.taxonomy)
    reasons.push("the screen-type list was updated");
  if (older) reasons.push(OLDER_REASON.charAt(0).toLowerCase() + OLDER_REASON.slice(1));
  const current = presetVersionInputs(x, {
    reportId: inputs.reportId,
    stage: x.plan.stage,
    main: inputs.mainMarket,
    now: new Date(0),
  });
  const saved = new Map(inputs.records.map((r) => [`${r.appId}|${r.position}`, r]));
  const changed = current.records.filter((r) => {
    const o = saved.get(`${r.appId}|${r.position}`);
    return r.updatedAt !== null && (!o || o.imageId !== r.imageId || o.updatedAt !== r.updatedAt);
  }).length;
  if (changed) reasons.push(`${changed} new or updated ${changed === 1 ? "analysis" : "analyses"}`);
  for (const g of x.plan.games) {
    const date = x.orderDates.get(g.appId) ?? null;
    const before = inputs.orderDates[g.appId] ?? null;
    if (was.has(g.appId) && date && date !== before)
      reasons.push(`${g.name}'s store page changed on ${DAY(date)}`);
  }
  if (!reasons.length) return "The data changed since this version was made.";
  const text = reasons.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

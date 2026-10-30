import type { TestVariable } from "../analysis/play-experiments.ts";
import type { Directive } from "../engine/directives.ts";
import type { EngineResult } from "../engine/engine.ts";
import { evidenceText } from "../engine/strength.ts";
import { type Evidence, evidenceStrength, positionWeight } from "./ab-candidates.ts";

/**
 * A/B test evidence as a view of the engine's directives (plan section 10, step 3): each
 * screenshot directive that changes something becomes a gap with its own n of M and positions,
 * most leverage first. Tests on directives of strength "test" come first among test ideas, and a
 * test may never move away from a directive (validate.ts, checked in ab-tests-schema.ts).
 */
const VARIABLE: Partial<Record<Directive["kind"], TestVariable>> = {
  COPY: "screenshot",
  DROP: "screenshot",
  ADD: "screenshot",
  LENGTH: "screenshot",
  REORDER: "order",
  ORIENT: "composition",
  RELAYER: "composition",
  RECAPTURE: "screenshot",
  MESSAGE: "text",
};

export function directiveEvidence(e: EngineResult, gl: string, ourDeckLength: number): Evidence[] {
  const rows = e.directives
    .filter(
      (d) => VARIABLE[d.kind] && d.level !== "keep" && d.level !== "review" && d.evidence.M > 0,
    )
    .map((d) => {
      const positions = d.kind === "LENGTH" ? [ourDeckLength + 1] : d.positions;
      const first = positions.length ? Math.min(...positions) : 1;
      return {
        id: "",
        kind: `directive-${d.id}`,
        statement: `${d.id} ${d.title} (${evidenceText(d.evidence)}).`,
        n: d.evidence.n,
        of: d.evidence.M,
        unit: "games",
        games: d.evidence.games,
        countries: [gl],
        positions,
        imageIds: d.evidence.imageIds,
        ours: positions.filter((p) => p <= ourDeckLength),
        variable: VARIABLE[d.kind] as TestVariable,
        leverage:
          Math.round(
            positionWeight(first) *
              evidenceStrength(d.kind === "DROP" ? d.evidence.M : d.evidence.n, d.evidence.M) *
              100,
          ) / 100,
      } satisfies Evidence;
    });
  return rows.sort((a, b) => b.leverage - a.leverage || a.kind.localeCompare(b.kind));
}

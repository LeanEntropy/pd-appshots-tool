import type { LoadedConfig } from "../config/load.ts";
import { makeCountryReportsNow } from "../reports/derived-relations.ts";
import type { ApiResponse } from "./api.ts";
import { findDef, gone } from "./reports-api.ts";

/** "Make country reports now" on a comparison (code only, no AI): made, or already there. */
export function deriveNow(loaded: LoadedConfig, id: string): ApiResponse {
  const def = findDef(loaded, id);
  if (!def) return gone();
  if (def.type !== "compare")
    return { status: 409, body: { problems: ["Only a comparison makes country reports."] } };
  if (!def.versions.length)
    return { status: 409, body: { problems: ["Build the comparison first."] } };
  const r = makeCountryReportsNow(loaded, def.id);
  const n = new Set(r.made.map((m) => m.reportId)).size;
  return {
    status: 200,
    body: {
      made: n,
      message: n
        ? `${n} country ${n === 1 ? "report" : "reports"} made from this comparison, at no cost.`
        : "The country reports of this comparison are already there.",
    },
  };
}

import { z } from "zod";
import type { LoadedConfig } from "../config/load.ts";
import { saveGroups } from "../reports/groups-load.ts";
import type { ReportDef } from "../reports/types.ts";
import type { ApiResponse } from "./api.ts";

/** The groups of countries of a comparison, as the page saves them (plan-cross-country 3.2). */
export const GroupsBody = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(60),
      countries: z.array(z.string().regex(/^[a-z]{2}$/)).max(20),
    }),
  )
  .max(4);

/** Saves them when every group has at least 2 of the compared countries (empty: the suggested). */
export function saveGroupsOf(
  loaded: LoadedConfig,
  def: ReportDef,
  groups: z.infer<typeof GroupsBody>,
): ApiResponse {
  if (def.type !== "compare")
    return { status: 409, body: { problems: ["Only a comparison has groups of countries."] } };
  const gls = new Set(def.scope.markets.map((m) => m.gl));
  const bad = groups.find((g) => g.countries.some((gl) => !gls.has(gl)) || g.countries.length < 2);
  if (bad)
    return {
      status: 400,
      body: { problems: [`"${bad.name}" needs at least 2 of the compared countries.`] },
    };
  saveGroups(loaded, def, groups);
  return { status: 200, body: { id: def.id, groups, message: "Groups saved." } };
}

/** Something computed for display only: left out (null) rather than failing the page. */
export function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}

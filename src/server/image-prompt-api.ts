import { z } from "zod";
import type { CountryAdvice } from "../analysis/country-advice-schema.ts";
import type { ReportData } from "../analysis/report-data.ts";
import type { Recommendations } from "../analysis/synthesis-schema.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { deckPrompts, imagePrompt, type PromptPlace } from "../reports/image-prompt.ts";
import { promptSlots } from "../reports/image-prompt-facts.ts";
import { PROMPT_KB_IDS, type PromptStore, storeRules } from "../reports/image-prompt-rules.ts";
import { mainMarketRef } from "../reports/main-market.ts";
import { listDefs } from "../reports/store.ts";
import { type MarketRef, platformOfScope } from "../reports/types.ts";
import { workspaceStorage } from "../storage/index.ts";
import { kbFiles } from "../storage/kb-files.ts";
import type { ApiResponse } from "./api.ts";
import { findDef, getReportVersion } from "./reports-api.ts";

/**
 * Image prompts (user, 2026-10-30): GET .../reports/<rid>/versions/<vid>/image-prompts?gl=xx
 * answers every position's prompt and the whole deck's; GET /api/image-prompt?gl&hl&pos the
 * prompt for one of our own images (the image page). Built by code from the version the page
 * shows (no AI call, free). The ids are listed ones, so no path comes from the request.
 */
type CountryEntry = { gl: string; hl?: string; label: string; isMain?: boolean; data: ReportData };
interface VersionBody {
  data?: ReportData;
  countries?: CountryEntry[];
  country?: { countries: CountryEntry[]; advice: { gl: string; advice: CountryAdvice | null }[] };
}

let kbMemo: { day: string; root: string; claims: Map<string, string> } | null = null;
const StoreEntries = z.object({
  entries: z.array(
    z.object({ id: z.string(), claim: z.string(), retired: z.boolean().optional() }),
  ),
});
/**
 * The quoted rules' wording from the knowledge base's official store entries (read once a day;
 * only the two store files, so the first prompt is instant); the built-in text otherwise.
 */
function kbClaims(root: string): Map<string, string> {
  const day = new Date().toISOString().slice(0, 10);
  if (kbMemo?.day === day && kbMemo.root === root) return kbMemo.claims;
  const claims = new Map<string, string>();
  const files = kbFiles(root);
  for (const name of ["inbox/entries-google-play.json", "inbox/entries-app-store.json"]) {
    try {
      const f = StoreEntries.safeParse(files.getJson(name));
      for (const e of f.success ? f.data.entries : [])
        if (!e.retired && PROMPT_KB_IDS.includes(e.id)) claims.set(e.id, e.claim);
    } catch {
      // An unreadable file: the built-in wording of the same entries is used.
    }
  }
  kbMemo = { day, root, claims };
  return claims;
}

function languageName(hl: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(hl) ?? hl;
  } catch {
    return hl;
  }
}

export function placeOf(
  game: string,
  storeName: string,
  m: MarketRef,
  deckLength: number,
): PromptPlace {
  return {
    game,
    storeName,
    country: m.label,
    language: languageName(m.hl),
    english: /^en\b/i.test(m.hl),
    deckLength,
  };
}

interface Picked {
  d: ReportData;
  market: MarketRef;
  advice: CountryAdvice | null;
  mainRecs: Recommendations | null;
}

function pick(b: VersionBody, gl: string, markets: MarketRef[], main: MarketRef): Picked | null {
  const entry = (cs: CountryEntry[]) => cs.find((c) => c.gl === gl) ?? (gl ? undefined : cs[0]);
  const marketOf = (c: CountryEntry): MarketRef => ({
    gl: c.gl,
    hl: c.hl ?? markets.find((m) => m.gl === c.gl)?.hl ?? main.hl,
    label: c.label,
  });
  if (b.country?.countries?.length) {
    const x = entry(b.country.countries);
    if (!x) return null;
    const isMain = b.country.countries.find((c) => c.isMain);
    return {
      d: x.data,
      market: marketOf(x),
      advice: x.isMain ? null : (b.country.advice?.find((a) => a.gl === x.gl)?.advice ?? null),
      mainRecs: isMain?.data.ai?.recommendations ?? null,
    };
  }
  if (b.countries?.length) {
    const x = entry(b.countries);
    if (!x) return null;
    return { d: x.data, market: marketOf(x), advice: null, mainRecs: null };
  }
  if (b.data)
    return {
      d: b.data,
      market: markets.find((m) => m.gl === gl) ?? markets[0] ?? main,
      advice: null,
      mainRecs: null,
    };
  return null;
}

const none = (why: string): ApiResponse => ({ status: 404, body: { problems: [why] } });

function build(
  loaded: LoadedConfig,
  store: PromptStore,
  p: Picked,
  positions?: number[],
): ApiResponse {
  const slots = promptSlots(projectPaths(loaded), p.d, {
    advice: p.advice,
    mainRecs: p.mainRecs,
    ...(positions ? { positions } : {}),
  });
  if (!slots.length) return none("This report has no image positions to write prompts for yet.");
  const rules = storeRules(store, kbClaims(loaded.root));
  const place = placeOf(loaded.config.ourApp.name, rules.name, p.market, slots.length);
  if (positions)
    place.deckLength = Math.max(
      slots.length,
      ...p.d.games.filter((g) => g.ours).flatMap((g) => g.rows.map((r) => r.position)),
    );
  return {
    status: 200,
    body: {
      store: rules.name,
      country: p.market.label,
      prompts: slots.map((s) => ({
        position: s.position,
        hasSpec: !!s.spec,
        text: imagePrompt(place, s, rules),
      })),
      all: deckPrompts(place, slots, rules),
    },
  };
}

export function getImagePrompts(
  loaded: LoadedConfig,
  rid: string,
  vid: string,
  gl: string,
): ApiResponse {
  const def = findDef(loaded, rid);
  if (!def) return none("This report no longer exists. Reload the page.");
  const v = getReportVersion(loaded, rid, vid);
  if (v.status !== 200) return v;
  const p = pick(v.body as VersionBody, gl, def.scope.markets, mainMarketRef(loaded));
  if (!p) return none("This version has no image positions (it is shown as its written report).");
  return build(loaded, platformOfScope(def.scope), p);
}

/**
 * The prompt for our own image at a store position (the image page): the main country's Full
 * check (or Pilot) as it is now, else the latest country report holding that country.
 */
export function getOwnImagePrompt(loaded: LoadedConfig, q: URLSearchParams): ApiResponse {
  const gl = q.get("gl") ?? "";
  const pos = Number(q.get("pos"));
  if (!/^[a-z]{2}$/.test(gl) || !Number.isInteger(pos) || pos < 1 || pos > 20)
    return { status: 400, body: { problems: ["Unknown image position."] } };
  const main = mainMarketRef(loaded);
  const paths = projectPaths(loaded);
  const defs = listDefs(workspaceStorage(paths.workspace), paths).filter(
    (d) => !d.archived && platformOfScope(d.scope) === "play",
  );
  const tries: [string, string][] = [];
  if (gl === main.gl)
    for (const id of ["r-core", "r-pilot"])
      if (defs.some((d) => d.id === id)) tries.push([id, "now"]);
  for (const d of defs) {
    if (d.type !== "country" && d.type !== "compare") continue;
    if (!d.scope.markets.some((m) => m.gl === gl)) continue;
    const latest = [...d.versions].reverse().find((v) => !v.archived);
    if (latest) tries.push([d.id, latest.id]);
  }
  let fallback: ApiResponse | null = null;
  for (const [rid, vid] of tries) {
    const def = findDef(loaded, rid);
    const v = def ? getReportVersion(loaded, rid, vid) : null;
    const p =
      def && v?.status === 200 ? pick(v.body as VersionBody, gl, def.scope.markets, main) : null;
    if (!p?.d.games.some((g) => g.ours && g.rows.some((r) => r.position === pos))) continue;
    const r = build(loaded, "play", p, [pos]);
    const first = (r.body as { prompts?: { hasSpec: boolean }[] }).prompts?.[0];
    if (first?.hasSpec) return r;
    fallback ??= r.status === 200 ? r : null;
  }
  return fallback ?? none("No report covers this country and position yet. Build a report first.");
}

/** The relative address of a version's prompts, for the page (added to each country's data). */
export function withPromptLinks(body: unknown, rid: string, vid: string): unknown {
  const b = body as VersionBody & Record<string, unknown>;
  if (!b || typeof b !== "object") return body;
  const link = (gl: string) =>
    `reports/${encodeURIComponent(rid)}/versions/${encodeURIComponent(vid)}/image-prompts${gl ? `?gl=${encodeURIComponent(gl)}` : ""}`;
  const withLink = <T extends object>(x: T, gl: string): T => ({ ...x, imagePrompts: link(gl) });
  if (b.data) return { ...b, data: withLink(b.data, "") };
  if (b.countries)
    return { ...b, countries: b.countries.map((c) => ({ ...c, data: withLink(c.data, c.gl) })) };
  if (b.country?.countries)
    return {
      ...b,
      country: {
        ...b.country,
        countries: b.country.countries.map((c) => ({ ...c, data: withLink(c.data, c.gl) })),
        advice: (b.country.advice ?? []).map((a) => withLink(a, a.gl)),
      },
    };
  return body;
}

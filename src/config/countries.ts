import { join } from "node:path";
import { z } from "zod";
import { readJson } from "../util/fsx.ts";

/** The tracked country catalogue (configs/countries.json, plan 4.4). */
export const CountryCatalogueSchema = z
  .object({
    version: z.literal(1),
    defaultTicked: z.array(z.string()),
    languages: z.record(z.string(), z.string().min(1)),
    countries: z
      .array(
        z.object({
          gl: z.string().regex(/^[a-z]{2}$/),
          label: z.string().min(1),
          region: z.string().min(1),
          defaultHl: z.string().min(2),
          languages: z.array(z.string().min(2)).min(1),
        }),
      )
      .min(1),
    /** Regions the cross-country groups are suggested from (plan-cross-country 3.2). */
    groupRegions: z
      .array(z.object({ name: z.string().min(1), countries: z.array(z.string()).min(2) }))
      .default([]),
  })
  .superRefine((c, ctx) => {
    const gls = new Set<string>();
    for (const x of c.countries) {
      if (gls.has(x.gl)) ctx.addIssue({ code: "custom", message: `${x.gl} is listed twice` });
      gls.add(x.gl);
      if (!x.languages.includes(x.defaultHl))
        ctx.addIssue({ code: "custom", message: `${x.gl}: default language not in its list` });
      for (const hl of x.languages)
        if (!c.languages[hl]) ctx.addIssue({ code: "custom", message: `${x.gl}: unknown ${hl}` });
    }
    if (!gls.has("us")) ctx.addIssue({ code: "custom", message: "United States is missing" });
    for (const gl of c.defaultTicked)
      if (!gls.has(gl)) ctx.addIssue({ code: "custom", message: `default ${gl} is not listed` });
  });
export type CountryCatalogue = z.infer<typeof CountryCatalogueSchema>;

export const COUNTRIES_FILE = join("configs", "countries.json");

/** The tool's own folder: the catalogue is tool data, tracked with the code. */
const TOOL_ROOT = join(import.meta.dirname, "..", "..");

export function loadCountries(root = TOOL_ROOT): CountryCatalogue {
  const parsed = CountryCatalogueSchema.safeParse(readJson(join(root, COUNTRIES_FILE)));
  if (!parsed.success)
    throw new Error(
      `The country list has problems: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  return parsed.data;
}

export interface Market {
  gl: string;
  hl: string;
  label: string;
}

/** "Japan", or "Philippines (Filipino)" when the country offers more than one language. */
export function marketLabel(cat: CountryCatalogue, gl: string, hl: string): string {
  const c = cat.countries.find((x) => x.gl === gl);
  if (!c) return gl.toUpperCase();
  if (gl === "us") return "United States (English)";
  return c.languages.length > 1 ? `${c.label} (${cat.languages[hl] ?? hl})` : c.label;
}

export const US_MARKET: Market = { gl: "us", hl: "en", label: "United States (English)" };

/** US English first, then the default ticked countries in their default languages. */
export function defaultMarkets(cat: CountryCatalogue): Market[] {
  const rest = cat.defaultTicked.flatMap((gl) => {
    const c = cat.countries.find((x) => x.gl === gl);
    return c && gl !== "us"
      ? [{ gl, hl: c.defaultHl, label: marketLabel(cat, gl, c.defaultHl) }]
      : [];
  });
  return [US_MARKET, ...rest];
}

/**
 * Checks a list of countries against the catalogue and returns them labelled, US English first.
 * Returns a plain-language problem instead when a country or language is not offered.
 */
export function checkMarkets(
  cat: CountryCatalogue,
  picked: { gl: string; hl: string }[],
): { markets: Market[] } | { problem: string } {
  const out: Market[] = [US_MARKET];
  const seen = new Set(["us"]);
  for (const m of picked) {
    if (m.gl === "us") {
      if (m.hl !== "en")
        return { problem: "United States always uses English: it is the baseline." };
      continue;
    }
    const c = cat.countries.find((x) => x.gl === m.gl);
    if (!c) return { problem: `The country "${m.gl}" is not in the list.` };
    if (!c.languages.includes(m.hl))
      return { problem: `${c.label} is not offered in ${cat.languages[m.hl] ?? m.hl}.` };
    if (seen.has(m.gl))
      return { problem: `${c.label} is listed twice. Pick one language per country.` };
    seen.add(m.gl);
    out.push({ gl: m.gl, hl: m.hl, label: marketLabel(cat, m.gl, m.hl) });
  }
  return { markets: out };
}

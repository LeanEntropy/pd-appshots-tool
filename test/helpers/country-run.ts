import { runInNewContext } from "node:vm";
import { type LoadedConfig, projectPaths } from "../../src/config/load.ts";
import type { CountryReport } from "../../src/reports/country-report-types.ts";
import { enqueueReport } from "../../src/reports/report-job.ts";
import { createReport, readDef, versionFileKey } from "../../src/reports/store.ts";
import { workspaceStorage } from "../../src/storage/index.ts";
import { REPORT_SCRIPT } from "../../src/view/gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "../../src/view/gallery-report-parts.ts";
import { REPORT_COUNTRY_SCRIPT } from "../../src/view/report-country.ts";
import { REPORT_COUNTRY_PARTS_SCRIPT } from "../../src/view/report-country-parts.ts";
import { REPORT_SUMMARY_SCRIPT } from "../../src/view/report-summary.ts";
import { REPORT_WORDS_SCRIPT } from "../../src/view/report-words.ts";
import {
  addDeck,
  analyse,
  builderProject,
  idOf,
  idsOf,
  newText,
  picture,
  readyReport,
  usBytes,
} from "./builder.ts";
import type { reportFake } from "./report-fakes.ts";

/** A One country (Japan) report project, run and render helpers for the report tests. */
export const TWO = ["Capybara Go", "Mini Tales"];
const JP = { gl: "jp", hl: "ja", label: "Japan" };

/** Japan: ours the same file as in the US; Capybara Go the same picture with new text; Mini Tales a new picture. */
export async function japanProject(): Promise<LoadedConfig> {
  const loaded = await builderProject();
  const ours = loaded.config.ourApp.name;
  analyse(loaded, [ours, ...TWO]);
  readyReport(loaded, "pilot");
  await addDeck(loaded, ours, "jp", "ja", [usBytes(loaded, idOf(loaded, ours), 1)], "ours");
  const capy = usBytes(loaded, idOf(loaded, "Capybara Go"), 1);
  await addDeck(loaded, "Capybara Go", "jp", "ja", [await newText(capy)]);
  await addDeck(loaded, "Mini Tales", "jp", "ja", [await picture(901)]);
  return loaded;
}

export function japanReport(loaded: LoadedConfig) {
  const paths = projectPaths(loaded);
  return createReport(workspaceStorage(paths.workspace), paths, {
    name: "Japan vs 2 competitors",
    type: "country",
    scope: { type: "country", markets: [JP], competitors: idsOf(loaded, TWO), includeCharts: [] },
  });
}

export function run(
  loaded: LoadedConfig,
  id: string,
  hash: string,
  fake: ReturnType<typeof reportFake>,
) {
  return enqueueReport(
    loaded,
    { reportId: id, planHash: hash },
    {
      depsFor: (onProgress) => ({ producer: fake, reviewer: null, adjudicator: fake, onProgress }),
      reportProvider: (ref) => ({ ...fake, model: ref.split(":")[1] ?? ref }),
    },
  );
}

export function latestCountry(loaded: LoadedConfig, id: string): CountryReport {
  const paths = projectPaths(loaded);
  const s = workspaceStorage(paths.workspace);
  const v = readDef(s, paths, id)?.versions.at(-1)?.id as string;
  return s.getJson(versionFileKey(paths, v, "country-report.json")) as CountryReport;
}

/** The page's HTML of a country version (the tab remembered for the report: savedTab). */
export function renderCountry(c: CountryReport, withFlags: boolean, savedTab?: string): string {
  const box = { innerHTML: "", classList: { toggle: () => {} } };
  const ctx: Record<string, unknown> = {
    IMG: "../images/",
    API: "/p/x/api",
    esc: (x: unknown) => String(x).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`),
    infoBtn: (id: string) => `<button class="info" data-info="${id}">i</button>`,
    localStorage: { getItem: () => savedTab ?? null, setItem: () => {} },
    document: { addEventListener: () => {}, getElementById: () => null },
    location: { hash: "", protocol: "file:" },
    ...(withFlags
      ? { countryLabel: (gl: string, n: string) => `<img class="flag" alt="${gl}">${n}` }
      : {}),
  };
  runInNewContext(
    `${REPORT_SCRIPT}\n${REPORT_PARTS_SCRIPT}\n${REPORT_SUMMARY_SCRIPT}\n${REPORT_COUNTRY_SCRIPT}\n${REPORT_COUNTRY_PARTS_SCRIPT}\n${REPORT_WORDS_SCRIPT}\nthis.draw = renderCountryReport;`,
    ctx,
  );
  const draw = ctx.draw as (b: unknown, c: unknown, rid: string, research: string) => void;
  draw(box, c, "r-japan-1", "");
  return box.innerHTML;
}

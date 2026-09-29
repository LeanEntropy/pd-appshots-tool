import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { countryAdviceSchema } from "../src/analysis/country-advice-schema.ts";
import type { ReportData } from "../src/analysis/report-data.ts";
import { interpretationSchema } from "../src/analysis/synthesis-schema.ts";
import {
  type BottomInput,
  bottomPoints,
  plain,
  splitSentences,
} from "../src/reports/bottom-points.ts";
import {
  countryPoints,
  dataPoints,
  pointsMarkdown,
  upgradeBottomMd,
  withCountryPoints,
} from "../src/reports/bottom-points-of.ts";
import type { CountryReport } from "../src/reports/country-report-types.ts";
import { reportApproval } from "../src/reports/report-job.ts";
import { REPORT_SCRIPT } from "../src/view/gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "../src/view/gallery-report-parts.ts";
import { REPORT_SUMMARY_SCRIPT } from "../src/view/report-summary.ts";
import {
  japanReport as japanDef,
  japanProject,
  latestCountry,
  renderCountry,
  run,
} from "./helpers/country-run.ts";
import { reportFake } from "./helpers/report-fakes.ts";

// The Japan country report's bottom line as the page showed it (user complaint, 2026-09-29).
const REPEAT =
  "Your store page shows the same 6 screenshots twice (positions 7–12 repeat 1–6, in a taller size). Remove the second set, or replace it with 6 new screens.";
const AI =
  'All 8 competitors in Japan use full-screen title art, and 5 of 8 open with it. Our page opens on a battle screen, has no title art and shows no logo in the first three images. The most important change is to open with our title art, with the ROGUE LEGEND logo and the line サイコロを振って、戦って、強くなれ！ ("Roll the dice, fight, and get stronger!"). After that, follow the main deck\'s order and cut our 12 images to 7, because the current page shows the same six pictures twice.';
const JAPAN = `Japan: y${REPEAT.slice(1)} Our store page is slightly different against 8 competitors in Japan. ${AI}`;
const VERDICT = {
  groups: [{ word: "slightly different", text: "from 8 competitors in Japan" }],
  meta: "11 of 17 pattern points",
};
const input = (o: Partial<BottomInput> = {}): BottomInput => ({
  shortAnswer: JAPAN,
  verdict: VERDICT,
  verdictWords: ["slightly different"],
  findings: [{ text: REPEAT, note: "" }],
  structured: null,
  shownBelow: [],
  multi: false,
  ...o,
});

test("sentences never split inside a quoted local headline or brackets", () => {
  const s = splitSentences(AI);
  assert.equal(s.length, 4);
  assert.match(s[2] ?? "", /^The most important change .*get stronger!"\)\.$/);
});

test("the Japan bottom line becomes a verdict, what differs and do first", () => {
  const p = bottomPoints(input());
  assert.equal(p.from, "split");
  assert.deepEqual(p.verdict, VERDICT);
  assert.deepEqual(p.differs.map(plain), [
    "All 8 competitors in Japan use full-screen title art, and 5 of 8 open with it.",
    "Our page opens on a battle screen, has no title art and shows no logo in the first three images.",
  ]);
  assert.deepEqual(
    p.differs[0]?.segs.filter((s) => s.b).map((s) => s.t),
    ["All 8 competitors", "5 of 8"],
  );
  assert.deepEqual(
    p.differs[1]?.segs.filter((s) => s.b).map((s) => s.t),
    ["no title art", "no logo"],
  );
  // The most important change first, then the code-made finding, then the rest.
  assert.deepEqual(p.actions.map(plain), [
    'Open with our title art, with the ROGUE LEGEND logo and the line サイコロを振って、戦って、強くなれ！ "Roll the dice, fight, and get stronger!"',
    REPEAT,
    "Follow the main deck's order and cut our 12 images to 7, because the current page shows the same six pictures twice.",
  ]);
  assert.deepEqual(
    p.actions[0]?.segs.find((s) => s.tr),
    { t: ' "Roll the dice, fight, and get stronger!"', tr: true },
  );
  assert.equal(p.actions[1]?.code, true);
  const md = pointsMarkdown(p).join("\n");
  assert.match(
    md,
    /^\*\*Slightly different\*\* from 8 competitors in Japan \(11 of 17 pattern points\)\./,
  );
  assert.match(md, /\*\*What differs\*\*\n\n- \*\*All 8 competitors\*\* in Japan/);
  assert.match(
    md,
    /\*\*Do first\*\*\n\n1\. Open with our title art.*_"Roll the dice, fight, and get stronger!"_\n2\. Your store page/,
  );
});

test("a sentence repeating a key point listed below is left out; so is the finding", () => {
  const kp = "Opens with Title screen / full-screen art: 5 of 8 competitors; ours: Gameplay.";
  const p = bottomPoints(
    input({
      shortAnswer: `${REPEAT} Our store page is slightly different compared with 8 competitors in Japan: it fits 11 of 17 weighted pattern points. The most important change: ${kp}`,
      verdict: null,
      shownBelow: [REPEAT, kp],
    }),
  );
  assert.deepEqual(p.differs, []);
  assert.deepEqual(p.actions, []);
});

test("the AI's structured points are preferred and no sentence is repeated", () => {
  const p = bottomPoints(
    input({
      structured: {
        verdict: "slightly different from 8 competitors in Japan, mainly at image 1",
        differences: ["**All 8 competitors** use title art; ours has none"],
        actions: ["Open with our title art", "Remove the second set of six screenshots"],
      },
    }),
  );
  assert.equal(p.from, "ai");
  assert.equal(p.verdict?.groups[0]?.text, "from 8 competitors in Japan, mainly at image 1");
  assert.deepEqual(p.differs[0]?.segs, [
    { t: "All 8 competitors", b: true },
    { t: " use title art; ours has none" },
  ]);
  // The AI's "remove the second set" is the code-made finding already listed: kept once.
  assert.deepEqual(p.actions.map(plain), ["Open with our title art", REPEAT]);
  assert.ok(!p.differs.some((d) => plain(d).includes("battle screen")));
});

test("answers saved before the structured points still parse (they read as empty)", () => {
  const empty = { verdict: "", differences: [], actions: [] };
  assert.deepEqual(countryAdviceSchema.shape.bottomLine.parse(undefined), empty);
  assert.deepEqual(interpretationSchema.shape.bottomLine.parse(undefined), empty);
});

/** A real country version (fake models), with the Japan bottom line and repeat finding. */
async function japanReport(countries = 1): Promise<CountryReport> {
  const loaded = await japanProject();
  const def = japanDef(loaded);
  const a = reportApproval(loaded, def);
  assert.ok(!("problem" in a));
  const r = run(loaded, def.id, a.plan.planHash, reportFake());
  assert.ok(r.ok);
  await r.done;
  const c = latestCountry(loaded, def.id);
  const jp = c.countries[0];
  assert.ok(jp);
  jp.data.repeats = [
    {
      appId: "x",
      name: "Rogue Legends",
      ours: true,
      total: 12,
      unique: 6,
      text: REPEAT,
      counted: true,
    },
  ];
  const kr = { ...structuredClone(jp), gl: "kr", hl: "ko", label: "South Korea" };
  const all = countries > 1 ? [jp, kr] : [jp];
  const v = (gl: string, label: string) => ({
    gl,
    label,
    isMain: false,
    verdict: "slightly different",
    points: { fit: 11, total: 17 },
    competitors: 8,
    keyPoint: REPEAT,
    localisation: "",
    shortAnswer: countries > 1 ? "" : AI,
  });
  return {
    ...c,
    type: countries > 1 ? "compare" : "country",
    countries: all,
    advice: [],
    summary: {
      ...c.summary,
      shortAnswer: JAPAN,
      verdicts: all.map((x) => v(x.gl, x.label)),
    },
  };
}

const summaryContext = () => {
  const ctx: Record<string, unknown> = {
    esc: (x: unknown) => String(x).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`),
    document: { addEventListener: () => {}, getElementById: () => null },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  runInNewContext(
    `${REPORT_SCRIPT}\n${REPORT_PARTS_SCRIPT}\n${REPORT_SUMMARY_SCRIPT}\nthis.sa = shortAnswerHtml;`,
    ctx,
  );
  return ctx.sa as (d: unknown) => string;
};

test("every report type draws the bottom line as a list", async () => {
  // One country: the verdict line with its chip replaces the verdict card.
  const one = renderCountry(withCountryPoints(await japanReport()), true);
  assert.match(
    one,
    /<p class="blv"><span class="pill slightly">Slightly different<\/span> from 8 competitors in Japan/,
  );
  assert.match(one, /<h4>What differs<\/h4><ul><li><strong>All 8 competitors<\/strong> in Japan/);
  assert.match(
    one,
    /<h4>Do first<\/h4><ol><li>Open with our title art.*<span class="bltr">&#34;Roll the dice/,
  );
  assert.doesNotMatch(one, /class="vcards"/);
  assert.doesNotMatch(one, /<p class="short">/);
  // Compare countries: the verdict line groups the countries; the cards stay.
  const two = countryPoints(await japanReport(2));
  assert.equal(two.verdict?.groups[0]?.text, "in Japan and South Korea");
  const cmp = renderCountry(withCountryPoints(await japanReport(2)), true);
  assert.match(cmp, /class="bl"/);
  assert.match(cmp, /class="vcards"/);
  // The Pilot and the Full check: points from the report data (the verdict word is shown above).
  const data = {
    fit: {
      verdict: "optimised",
      keyPoints: ["Image 5 shows Gameplay: 2 of 2 competitors; ours: Menus and progression."],
    },
    ai: null,
    summary: {
      shortAnswer:
        "Our store page is optimised. 4 of 8 competitors show Menus and progression at image 2. Try moving our Menus and progression screen up to image 2.",
      worded: true,
      keyRecommendations: [],
    },
  } as unknown as ReportData;
  const p = dataPoints(data);
  assert.ok(p);
  assert.equal(p.verdict, null);
  const html = summaryContext()({ summary: { ...data.summary, points: p } });
  assert.match(html, /<h4>What differs<\/h4><ul><li><strong>4 of 8 competitors<\/strong> show/);
  assert.match(html, /<h4>Do first<\/h4><ol><li>Try moving our Menus/);
  // Saved before the points: the prose as it was.
  assert.match(summaryContext()({ summary: data.summary }), /<p class="short">Our store page/);
});

test("a saved report.md gets the points in place of its prose bottom line", () => {
  const md = `# Japan\n\n## 1. Overall recommendations\n\n${JAPAN}\n\n| Country |\n`;
  const out = upgradeBottomMd(md, JAPAN, bottomPoints(input()));
  assert.ok(!out.includes(JAPAN));
  assert.match(
    out,
    /## 1\. Overall recommendations\n\n\*\*Slightly different\*\*.*\n\n\*\*What differs\*\*[\s\S]*\n3\. Follow the main deck's order[^\n]*\n\n\| Country \|/,
  );
  assert.equal(upgradeBottomMd(md, "not in it", bottomPoints(input())), md);
});

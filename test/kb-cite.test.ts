import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { writeAbTests } from "../src/analysis/ab-tests.ts";
import type { AbTestsOutput } from "../src/analysis/ab-tests-schema.ts";
import type { CallContext } from "../src/analysis/call.ts";
import type { Provider, VisionCall } from "../src/analysis/providers.ts";
import { citeHtml, citeNumberer, linksOf } from "../src/kb/cite.ts";
import type { Evidence } from "../src/reports/ab-candidates.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { KB_CITE_SCRIPT } from "../src/view/kb-cite.ts";
import { fixtureKb, run } from "./helpers/kb.ts";

const esc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
type Marks = (o: unknown, item: string) => string;
const kbMarks = new Function("esc", `${KB_CITE_SCRIPT}\nreturn kbMarks;`)(esc) as Marks;

/** Everything in the tooltip that is not a link. */
const tipText = (html: string) =>
  (html.match(/<span class="kb-cite-tip"[^>]*>(.*?)<\/span>/g) ?? [])
    .map((t) => t.replace(/<a [^>]*>[^<]*<\/a>/g, "").replace(/<\/?span[^>]*>/g, ""))
    .join("");

test("a citation mark is [n] with a tooltip of ONLY links, each opening in a new tab", () => {
  const kb = fixtureKb();
  const cite = citeNumberer(kb);
  const [c] = cite(["h-est"]);
  assert.ok(c);
  assert.equal(c.n, 1);
  assert.deepEqual(cite(["h-est"])[0]?.n, 1, "the same entry keeps its number");
  assert.equal(cite(["h-corr"])[0]?.n, 2);
  const html = citeHtml(c);
  assert.match(html, /^<sup class="kb-cite" tabindex="0">\[1\]/);
  assert.equal(tipText(html), "", "no trust level, date, publisher or any other text");
  for (const a of html.match(/<a [^>]*>/g) ?? []) {
    assert.match(a, /target="_blank"/);
    assert.match(a, /rel="noopener noreferrer"/);
  }
  assert.ok(!/Established|Corroborated|2025|Pub /.test(html));
  // An enforced rule links its policy page first.
  assert.equal(
    linksOf(kb, "gp-enf-1")[0],
    "https://support.google.com/googleplay/android-developer/answer/9898842",
  );
});

test("the page's copy renders the same: links only, unsafe links never, nothing without marks", () => {
  const o = {
    kbCites: {
      "position:1": [
        { n: 1, links: ["https://a.example/x?q=1&r=2", "javascript:alert(1)"] },
        { n: 1, links: ["https://a.example/x"] },
        { n: 2, links: ["data:text/html,hi"] },
      ],
    },
    kbNotes: {
      "position:1": ["This goes against Google Play's own advice, which is not a rule: <b>x</b>"],
    },
  };
  const html = kbMarks(o, "position:1");
  assert.equal(
    (html.match(/<sup /g) ?? []).length,
    1,
    "duplicates merged; a mark without a safe link is dropped",
  );
  assert.ok(!html.includes("javascript:") && !html.includes("data:"));
  assert.equal(tipText(html), "");
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/, "notes are escaped");
  assert.equal(kbMarks({}, "position:1"), "");
  assert.equal(kbMarks(null, "position:1"), "");
});

function abProvider(): Provider & { calls: VisionCall[] } {
  const calls: VisionCall[] = [];
  const slot = (p: number, headline: string) => ({
    position: p,
    fromOurPosition: p,
    changes: p === 1 ? ["text"] : [],
    orientation: "portrait",
    composition: "full",
    screen: "battle",
    band: "none",
    headline: p === 1 ? headline : "",
    extras: "none",
  });
  const t = (title: string, headline: string) => ({
    title,
    hypothesis: "h",
    evidence: [{ id: "E1", n: 3, of: 3 }],
    variable: "text",
    countries: ["us"],
    metric: "installs",
    variant: { summary: "s", slots: [slot(1, headline), slot(2, ""), slot(3, "")] },
    secondVariant: null,
    impact: { size: "medium", reason: "r" },
    orderReason: "",
  });
  return {
    family: "anthropic",
    model: "fake",
    calls,
    async call(c) {
      calls.push(c);
      const handle =
        /\[(K\d+)\][^\n]*\nClaim: Claim of exp-fact\./.exec(c.system.text)?.[1] ?? "K1";
      return {
        ok: true,
        costUsd: 0,
        error: null,
        output: {
          tests: [t("Bad", "No.1 roguelike"), t("Good", "Epic boss fights")],
          kb: {
            citations: [{ item: "test:2", handles: [handle] }],
            againstGuidance: [],
            conflicts: [],
          },
        },
      };
    },
  };
}

test("A/B tests: a variant that breaks an enforced rule is dropped by code; the rest keep their citations", async () => {
  const kb = fixtureKb();
  const r = run(kb);
  const ev: Evidence = {
    id: "E1",
    kind: "position-1",
    statement: "s",
    n: 3,
    of: 3,
    unit: "games",
    games: [],
    countries: ["us"],
    positions: [1],
    imageIds: [],
    ours: [1],
    variable: "text",
    leverage: 3,
  };
  const ctx: CallContext = {
    storage: workspaceStorage(mkdtempSync(join(tmpdir(), "kbab-"))),
    answerKey: (step, key) => `shared/test/${step}/${key}.json`,
    taxonomy: { id: "t", version: "1", screenTypes: [], definitions: {}, subtypeLabels: {} },
    taxonomyHash: "t",
    maxBudgetUsd: 1,
    remainingUsd: () => 1,
    timeoutMs: 1000,
    onCost: () => {},
    kb: r,
  };
  const p = abProvider();
  const out = await writeAbTests(
    p,
    { text: "AB PROMPT", hash: "h", file: "" },
    {
      evidence: [ev],
      rules: {
        evidence: new Map([["E1", ev]]),
        countries: ["us"],
        ourDeckLength: 3,
        length: { min: 3, max: 3 },
        metrics: ["installs"],
        lowTraffic: () => false,
        ourOrientation: new Map(),
      },
      market: { gl: "us", hl: "en", label: "United States" },
      traffic: "medium",
      ours: [],
      brief: () => "",
      recommendations: null,
    },
    ctx,
  );
  const v = out.value as (AbTestsOutput & { kbCites?: Record<string, unknown> }) | null;
  assert.deepEqual(
    v?.tests.map((t) => t.title),
    ["Good"],
  );
  assert.equal(p.calls.length, 2, "one retry with the rule listed");
  assert.match(p.calls[1]?.prompt ?? "", /breaks an enforced store rule/);
  assert.deepEqual(
    out.record?.citations.map((c) => c.item),
    ["test:1"],
    "renumbered after the drop",
  );
  assert.ok(v?.kbCites?.["test:1"]);
});

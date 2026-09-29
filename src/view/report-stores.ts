import type {
  PairResult,
  Row,
  StoreRec,
  StoresReport,
  StoreTest,
} from "../reports/stores-types.ts";
import { MARK_NAMES } from "../reports/stores-types.ts";
import { countryLabel } from "./flags.ts";
import { escHtml as esc } from "./shell.ts";
import { storeMarkHtml } from "./store-marks.ts";

/**
 * The "Google Play vs App Store" report on the Reports tab (style A, user 2026-09-29): open by
 * default only the bottom line, the recommendations and the A/B tests; the patterns, the
 * position tables and the notes on the data are folded. Store marks only in titles and headings.
 */
const IMG = "../images/";
const bold = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
const mark = (s: "play" | "appstore") => storeMarkHtml(s);

function sec(id: string, title: string, body: string, open: boolean): string {
  return `<details class="sec" data-sec="${id}"${open ? " open" : ""}><summary><span class="sec-t"><span class="secno"></span>${title}</span></summary><div class="sec-b">${body}</div></details>`;
}

function recHtml(r: StoreRec): string {
  return `<li><strong>${mark(r.store)} ${esc(r.title)}.</strong> ${esc(r.action)}${r.rule ? ` <span class="pill slightly">enforced: ${esc(r.rule)}</span>` : ""}<details class="offer-more"><summary>Why</summary><p>${esc(r.why)}</p></details></li>`;
}

function testHtml(t: StoreTest, i: number): string {
  const kind = t.store === "appstore" ? "Treatment" : "Variant";
  return `<div class="abcard"><h4><span class="abno">${i + 1}</span>${mark(t.store)} ${esc(t.title)}</h4><p>${esc(t.hypothesis)}</p><p><strong>Control:</strong> ${esc(t.control)}</p>${t.treatments.map((v, k) => `<p><strong>${kind} ${k + 1}:</strong> ${esc(v)}</p>`).join("")}<details class="offer-more"><summary>Evidence and setup</summary><p><strong>Evidence:</strong> ${esc(t.evidence)}</p><p><strong>Metric:</strong> ${esc(t.metric)}</p><p><strong>Setup:</strong> ${esc(t.setup.line)}</p><ul>${t.setup.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details></div>`;
}

const thumb = (s: { thumb: string | null } | null, alt: string) =>
  s?.thumb
    ? `<img class="thumb" loading="lazy" src="${IMG}${esc(s.thumb)}" alt="${esc(alt)}" width="60">`
    : "";

function rowHtml(r: PairResult, w: Row): string {
  const side = (s: Row["play"], store: string) =>
    s
      ? `${thumb(s, `${r.name} ${store} position ${w.n}`)}<br>${esc(s.reading?.screen ?? "not analysed")}`
      : "none";
  const rel = w.apple
    ? `${esc(MARK_NAMES[w.apple.mark])}${w.apple.playPosition ? ` (Google Play #${w.apple.playPosition})` : ""}`
    : "";
  const text = w.text === "changed" ? "text changed" : w.text === "same" ? "same text" : "";
  return `<tr><td>${w.n}</td><td>${side(w.play, "Google Play")}</td><td>${side(w.apple, "App Store")}</td><td>${rel}${text ? `<br>${text}` : ""}</td></tr>`;
}

function pairHtml(r: PairResult): string {
  const title = `${esc(r.name)}${r.ours ? " (ours)" : ""}`;
  if (r.state.play !== "ok" || r.state.apple !== "ok") {
    const st = (x: string) =>
      x === "not-sold" ? "not sold here" : x === "ok" ? "held" : "not read";
    return `<p><strong>${title}</strong>: not comparable (Google Play ${st(r.state.play)}, App Store ${st(r.state.apple)}).</p>`;
  }
  const head = `${r.count.play} on Google Play, ${r.count.apple} on the App Store; order ${r.order === "same" ? "kept" : r.order === "reordered" ? "changed" : "not comparable"}; ${r.orientation.play} / ${r.orientation.apple}`;
  return `<details class="sec"${r.ours ? " open" : ""}><summary><span class="sec-t">${title}</span> <span class="meta">${esc(head)}</span></summary><div class="sec-b"><table class="rt pos"><tr><th>#</th><th>${mark("play")} Google Play</th><th>${mark("appstore")} App Store</th><th>How they relate</th></tr>${r.rows.map((w) => rowHtml(r, w)).join("")}</table></div></details>`;
}

function patternsHtml(r: StoresReport): string {
  if (!r.patterns.length) return "<p>No country has competitors on both stores to compare.</p>";
  const rows = r.patterns
    .map(
      (p) =>
        `<tr${p.ours === "different" ? ' class="miss"' : ""}><td>${countryLabel(p.gl, p.country)}</td><td>${p.n} of ${p.of} competitors ${esc(p.statement)}</td><td>${p.pattern ? "pattern" : "statistic"}</td><td>${p.ours === "n/a" ? esc(p.oursNote) : p.ours === "fits" ? "fits" : "different"}</td></tr>`,
    )
    .join("");
  return `<p class="meta">A pattern needs at least 3 competitors and at least half of those compared; fewer is a statistic only.</p><table class="rt fit"><tr><th>Country</th><th>What competitors do</th><th>Kind</th><th>Ours</th></tr>${rows}</table>`;
}

function aboutHtml(r: StoresReport): string {
  const defs = (Object.keys(MARK_NAMES) as (keyof typeof MARK_NAMES)[])
    .map((k) => `<li><strong>${esc(MARK_NAMES[k])}</strong>: ${esc(MARK_HELP[k])}</li>`)
    .join("");
  return `<h3>How we sort images</h3><ul>${defs}</ul><h3>About this data</h3><ul>${r.caveats.map((c) => `<li>${esc(c)}</li>`).join("")}${r.leftOut.length ? `<li>Not sold there: ${esc(r.leftOut.join(", "))}.</li>` : ""}</ul>`;
}

const MARK_HELP: Record<keyof typeof MARK_NAMES, string> = {
  "same-file": "the store serves exactly the same image file on both stores.",
  "same-picture":
    "the same size and pixels, apart from tiny file-compression noise; no word or icon changed.",
  "same-screen":
    "the same game screen with other marketing text or in another shape; checked by you or by the text comparison.",
  "probably-same":
    "the fingerprints of the two pictures are close, but nobody checked them yet; not counted as proof.",
  new: "a picture with no counterpart among the same game's Google Play images in that country.",
};

/** The whole report as HTML for the report box (server-made, escaped). */
export function storesReportHtml(r: StoresReport): string {
  const s = r.summary;
  const bottom = `<p class="short">${bold(s.verdict)}</p><ol class="keypoints">${s.points.map((p) => `<li>${bold(p)}</li>`).join("")}</ol>${s.actions.length ? `<h3>What to do</h3><ol class="keyrecs">${s.actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>` : ""}`;
  const recs = r.recommendations.length
    ? `<ol class="keyrecs">${r.recommendations.map(recHtml).join("")}</ol>`
    : "<p>No change stands out: our pages follow what the competitors do on both stores.</p>";
  const tests = r.tests.length
    ? `<div class="abcards">${r.tests.map(testHtml).join("")}</div>`
    : "<p>No gap is large enough to test yet.</p>";
  const positions = r.countries
    .map(
      (c) =>
        `<h3>${countryLabel(c.gl, c.label)}</h3>${r.pairs
          .filter((p) => p.gl === c.gl)
          .map(pairHtml)
          .join("")}`,
    )
    .join("");
  return [
    sec("summary", "Bottom line", bottom, true),
    sec("recs", "Recommendations per store", recs, true),
    sec("abtests", "A/B tests to run next", tests, true),
    sec("patterns", "Patterns across competitors", patternsHtml(r), false),
    sec("store", "Position by position", positions, false),
    sec("sorting", "How we sort images and about this data", aboutHtml(r), false),
  ].join("");
}

/**
 * The summary block at the top of every report (plan-reports 3C): the short answer, the verdict
 * and key points (overviewHtml), the key recommendations, the A/B tests to run next as short
 * cards, and the dates; plus the "A/B test details" section (3B). Rendered from the report data
 * (reports/summary.ts, reports/ab-section.ts); older versions without them say so.
 */
export const REPORT_SUMMARY_CSS = `
.short { font-size: 16px; line-height: 1.5; max-width: 70em; }
ol.keyrecs li { margin: 5px 0; }
.abcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; margin: 8px 0 12px; }
.abcard { background: var(--card); border: 1px solid var(--line); border-left: 6px solid var(--accent-2); border-radius: 10px; padding: 10px 12px; }
.abcard.code { border-left-color: var(--mid); }
.abcard .abno { display: inline-block; min-width: 24px; height: 24px; line-height: 24px; text-align: center; border-radius: 12px; background: var(--accent-2); color: #fff; font-weight: 700; margin-right: 6px; }
.abcard.code .abno { background: var(--mid); }
.abcard h4 { margin: 0 0 6px; font-size: 15px; } .abcard p { margin: 4px 0; font-size: 13px; }
.abtest { border: 1px solid var(--line); border-left: 6px solid var(--accent-2); border-radius: 10px; padding: 8px 14px; margin: 12px 0; break-inside: avoid; }
.abtest.code { border-left-color: var(--mid); }
.dates { color: var(--muted); font-size: 13px; }
`;

export const REPORT_SUMMARY_SCRIPT = `
function shortAnswerHtml(d) {
  return d.summary ? '<p class="short">' + esc(d.summary.shortAnswer) + "</p>" : "";
}

function keyRecsHtml(d) {
  const s = d.summary;
  if (!s) return "";
  const items = s.keyRecommendations.map((r) => "<li><strong>Position " + r.position + "</strong> (" + esc(s.country) + "): " + esc(r.text) + "</li>").join("");
  return "<h3>Key recommendations</h3>" + (s.recommendationsStale ? '<p class="warn">Written from older data (see Recommendations).</p>' : "")
    + (items ? '<ol class="keyrecs">' + items + '</ol><p><button type="button" class="linkbtn" data-goto="rep-' + repRid + '-recs">Full spec per position</button></p>'
      : "<p>None yet: the recommendations are not written, or they keep our current deck.</p>");
}

function abCardsHtml(d) {
  const ab = d.abTests;
  const h = "<h3>A/B tests to run next</h3>";
  if (!ab) return h + '<p class="meta">This version was made before A/B tests were part of reports.</p>';
  const cards = ab.tests.map((t) => '<div class="abcard' + (t.source === "code" ? " code" : "") + '"><h4><span class="abno">' + t.priority + "</span>" + esc(t.title) + "</h4>"
    + (t.source === "code" ? '<p class="meta">Gap worth testing (written by code)</p>' : "")
    + "<p>" + esc(t.hypothesis) + "</p><p><strong>One variable:</strong> " + esc(t.variableName) + (t.positions.length ? ", position " + esc(t.positions.join(", ")) : "") + "</p>"
    + "<p><strong>Countries:</strong> " + esc(t.countries.join(", ")) + "</p><p><strong>Setup:</strong> " + esc(t.setup.line) + "</p>"
    + '<p><button type="button" class="linkbtn" data-goto="rep-' + repRid + "-abt-" + t.priority + '">Full spec</button></p></div>').join("");
  return h + (ab.note ? '<p class="meta">' + esc(ab.note) + "</p>" : "") + (cards ? '<div class="abcards">' + cards + "</div>" : "");
}

function datesHtml(d) {
  const s = d.summary;
  if (!s) return "";
  const x = s.dates;
  const store = x.storeFrom && x.storeTo && x.storeFrom !== x.storeTo ? x.storeFrom + " to " + x.storeTo : (x.storeFrom || "not saved");
  return '<p class="dates">' + (x.generated ? "Generated " + esc(fmtWhen(x.generated)) : "Shown as it stands now, from the saved analyses") + ". Store pages from " + esc(store) + ". Analyses as of " + esc(x.analyses || "none yet") + ".</p>";
}
function fmtWhen(iso) { const t = new Date(iso); return isNaN(t.getTime()) ? String(iso) : t.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }

function summaryHtml(d) { return overviewHtml(d) + keyRecsHtml(d) + abCardsHtml(d) + datesHtml(d); }

function variantHtml(v) {
  return "<p><em>" + esc(v.summary) + '</em></p><div class="tablewrap"><table class="rt"><tr><th>#</th><th>Changed</th><th>From our position</th><th>Orientation</th><th>Composition</th><th>Screen</th><th>Band</th><th>Headline</th><th>Extras</th></tr>'
    + v.slots.map((s) => { const ch = s.changed || s.fromOurPosition !== s.position; return '<tr class="' + (ch ? "miss" : "") + '"><th>' + s.position + "</th><td>" + (ch ? pill("slightly", "changed") : "same") + "</td><td>" + (s.fromOurPosition || "new") + "</td><td>" + esc(s.orientation) + "</td><td>" + esc(s.composition) + "</td><td>" + esc(s.screen) + "</td><td>" + esc(s.band) + "</td><td><strong>" + esc(s.headline) + "</strong></td><td>" + esc(s.extras) + "</td></tr>"; }).join("") + "</table></div>";
}

function abTestHtml(t) {
  const ev = t.evidence.map((e) => "<li>" + esc(e.statement) + ' <span class="meta">(' + e.n + " of " + e.of + " " + esc(e.unit) + (e.games.length ? ": " + esc(e.games.join(", ")) : "") + ")</span></li>").join("");
  const ctl = '<table class="rt"><tr><th>#</th><th>Screen</th><th>Headline</th><th>Orientation</th></tr>' + t.control.map((c) => "<tr><th>" + c.position + "</th><td>" + esc(c.screen) + "</td><td>" + esc(c.headline) + "</td><td>" + esc(c.orientation) + "</td></tr>").join("") + "</table>";
  return '<div class="abtest' + (t.source === "code" ? " code" : "") + '" id="rep-' + repRid + "-abt-" + t.priority + '"><h3>Test ' + t.priority + ": " + esc(t.title) + "</h3>"
    + (t.source === "code" ? '<p class="meta">Gap worth testing, written by code (no AI wording).</p>' : "")
    + "<dl><dt>Hypothesis</dt><dd>" + esc(t.hypothesis) + "</dd><dt>Evidence</dt><dd><ul>" + ev + "</ul></dd>"
    + "<dt>The one variable</dt><dd>" + esc(t.variableName) + (t.positions.length ? ", position " + esc(t.positions.join(", ")) : "") + "</dd><dt>Countries</dt><dd>" + esc(t.countries.join(", ")) + "</dd>"
    + "<dt>Metric</dt><dd><strong>" + esc(t.metric.name) + "</strong>: " + esc(t.metric.meaning) + "</dd><dt>Guardrail</dt><dd>" + esc(t.guardrail) + "</dd>"
    + "<dt>Play Console setup</dt><dd>" + esc(t.setup.line) + (t.setup.notes.length ? "<ul>" + t.setup.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>" : "") + "</dd>"
    + (t.impact ? "<dt>Expected impact</dt><dd>" + pill(t.impact.size === "large" ? "following" : t.impact.size === "medium" ? "slightly" : "none", t.impact.size) + " " + esc(t.impact.reason) + "</dd>" : "") + "</dl>"
    + "<h4>Variant</h4>" + (t.variant ? variantHtml(t.variant) : "<p>" + esc(t.variantText) + "</p>")
    + (t.secondVariant ? "<h4>Second variant</h4>" + variantHtml(t.secondVariant) : "")
    + "<h4>Control: our current deck</h4>" + ctl + "</div>";
}

function abDetailsHtml(d) {
  const ab = d.abTests;
  if (!ab) return '<p class="meta">This version was made before A/B tests were part of reports.</p>';
  return '<p class="meta">From ' + ab.gaps + (ab.gaps === 1 ? " gap" : " gaps") + " between our deck and the competitors, computed by code; every test\\u2019s evidence and setup is checked by code.</p>"
    + (ab.note ? "<p>" + esc(ab.note) + "</p>" : "") + ab.tests.map(abTestHtml).join("")
    + (ab.leftOut.length ? "<h3>Left out</h3><ul>" + ab.leftOut.map((l) => "<li><strong>" + esc(l.title) + ":</strong> " + esc(l.reason) + "</li>").join("") + "</ul>" : "");
}
`;

/**
 * A One country or Compare countries version (country-report.json), drawn into its card.
 * Bottom line first (plan-reports 3C): the short answer, a verdict card per country (with its
 * flag), the key actions and the A/B tests; then the contents, the recommendations per country,
 * each country's position table and patterns, how each game localises, our habits vs the
 * competitors', the words used, the A/B test details, how we sort images, what to research next
 * and the detailed statistics. Every value is escaped; the parts live in report-country-parts.ts.
 */
export const REPORT_COUNTRY_CSS = `
.vcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; margin: 10px 0; }
.vcard { background: var(--bg); border: 1px solid var(--line); border-left: 6px solid var(--mid); border-radius: 10px; padding: 8px 12px; }
.vcard.following { border-left-color: var(--ok); } .vcard.slightly { border-left-color: var(--mid); } .vcard.very { border-left-color: var(--bad); }
.vcard h4 { margin: 0 0 4px; font-size: 15px; } .vcard p { margin: 4px 0; font-size: 13px; }
.missing { border-left: 5px solid var(--warn); background: var(--bg); padding: 6px 12px; margin: 8px 0; }
table.rt td.local { font-weight: 700; } .bt { color: var(--muted); font-style: italic; }
.cmp2 { display: inline-flex; gap: 4px; align-items: center; } .cmp2 img { width: 44px; height: 78px; object-fit: contain; border: 1px solid var(--line); border-radius: 3px; background: var(--bg); }
`;

export const REPORT_COUNTRY_SCRIPT = `
const cname = (label) => String(label || "").replace(/\\s*\\([^)]*\\)\\s*$/, "");
// A country with its flag (the flags helper, when the page has it).
function cflag(gl, label) { return typeof countryLabel === "function" ? countryLabel(gl, cname(label)) : esc(cname(label)); }
const COUNTRY_SECS = [
  ["summary", "Summary: the bottom line"], ["advice", "Recommendations per country"], ["countries", "Per country: positions and patterns"],
  ["local", "How each game localises"], ["habits", "Our localisation vs the competitors\\u2019"], ["words", "Words used, per country"],
  ["abtests", "A/B test details"], ["sorting", "How we sort images"], ["research", "What to research next"], ["stats", "Detailed statistics"],
];

function missingHtml(c) {
  if (!c.missing.length && !c.banners.length) return "";
  return c.banners.map((b) => '<div class="banner stale"><p>' + esc(b) + "</p></div>").join("")
    + (c.missing.length ? '<div class="missing"><p><strong>Not written yet in this version:</strong></p><ul>' + c.missing.map((m) => "<li>" + esc(m.what) + "</li>").join("") + '</ul><p><button type="button" class="primary rc-approve" data-rid="' + repRid + '">Review and approve</button> <span class="meta">Shows the exact images, steps and cost first; nothing runs until you approve.</span></p></div>' : "");
}

function verdictCard(v) {
  return '<div class="vcard ' + (VERDICT_CLS[v.verdict] || "") + '"><h4>' + cflag(v.gl, v.label) + (v.isMain ? ' <span class="meta">(main country)</span>' : "") + "</h4>"
    + "<p>" + pill(VERDICT_CLS[v.verdict] || "none", v.verdict) + (v.points ? ' <span class="meta">' + v.points.fit + " of " + v.points.total + " pattern points, " + v.competitors + " competitors</span>" : "") + "</p>"
    + (v.shortAnswer ? "<p>" + esc(v.shortAnswer) + "</p>" : "")
    + (v.keyPoint ? "<p><strong>Biggest gap:</strong> " + esc(v.keyPoint) + "</p>" : "")
    + (v.localisation ? "<p><strong>Localisation:</strong> " + esc(v.localisation) + "</p>" : "") + "</div>";
}

function countrySummaryHtml(c) {
  const s = c.summary;
  const acts = s.keyActions.map((a) => "<li><strong>" + cflag(a.gl, a.label) + ":</strong> " + esc(a.text) + (a.why ? ' <span class="meta">' + esc(a.why) + "</span>" : "") + (a.impact ? " " + pill(a.impact === "large" ? "following" : a.impact === "medium" ? "slightly" : "none", a.impact + " impact") : "") + (a.source === "code" ? ' <span class="meta">(computed gap)</span>' : "") + "</li>").join("");
  const d = s.dates;
  return missingHtml(c) + '<p class="short">' + esc(s.shortAnswer) + "</p>"
    + '<div class="vcards">' + s.verdicts.map((v) => verdictCard(s.verdicts.length === 1 ? Object.assign({}, v, { shortAnswer: "" }) : v)).join("") + "</div>"
    + "<h3>Key actions, most important first</h3>" + (acts ? '<ol class="keyrecs">' + acts + '</ol><p><button type="button" class="linkbtn" data-goto="rep-' + repRid + '-advice">Full spec per country</button></p>' : "<p>None: our page follows the competitors\\u2019 patterns here.</p>")
    + abCardsHtml({ abTests: c.abTests })
    + '<p class="dates">Generated ' + esc(fmtWhen(d.generated)) + ". Store pages from " + esc(d.storeFrom && d.storeTo && d.storeFrom !== d.storeTo ? d.storeFrom + " to " + d.storeTo : d.storeFrom || "not saved") + ". Analyses as of " + esc(d.analyses || "none yet") + ". Main country (the reference for what changed): " + cflag(c.main.gl, c.main.label) + ".</p>";
}

const CHANGE_WORDS = { same: "same as the main deck", translate: "translated", reword: "new wording", recapture: "recapture, local text", "new-picture": "new picture", moved: "moved" };
function adviceOne(a) {
  if (!a.advice) return "<p>" + esc(a.note) + "</p>";
  const x = a.advice;
  const acts = x.actions.map((t) => "<tr><td><strong>" + esc(noIdText(t.action)) + "</strong></td><td>" + esc(noIdText(t.why)) + "</td><td>" + (t.positions.length ? esc(t.positions.join(", ")) : "all") + "</td><td>" + pill(t.impact === "large" ? "following" : t.impact === "medium" ? "slightly" : "none", t.impact) + "</td></tr>").join("");
  const deck = x.deck.map((p) => '<tr class="' + (p.change === "same" ? "" : "miss") + '"><th>' + p.position + "</th><td>" + esc(CHANGE_WORDS[p.change] || p.change) + (p.fromMainPosition ? ' <span class="meta">(main #' + p.fromMainPosition + ")</span>" : ' <span class="meta">(new)</span>') + "</td><td>" + esc(p.screen) + '</td><td class="local">' + esc(p.headline) + (p.subline ? "<br>" + esc(p.subline) : "") + '<div class="bt">' + esc(p.backTranslation) + "</div></td><td>" + esc(p.band) + "</td><td>" + (p.logo.show ? "yes" : "no") + '<div class="meta">' + esc(p.logo.why) + "</div></td><td>" + esc(p.wordingNotes) + '<div class="meta">' + esc(noIdText(p.why)) + "</div></td></tr>").join("");
  const terms = x.terms.map((t) => "<li><strong>" + esc(t.concept) + ":</strong> use <strong>" + esc(t.use) + "</strong>" + (t.avoid ? ", not " + esc(t.avoid) : "") + ". " + esc(noIdText(t.why)) + "</li>").join("");
  const rv = a.review;
  return '<p class="short">' + esc(noIdText(x.shortAnswer)) + "</p><h4>What to change, most important first</h4>"
    + '<div class="tablewrap"><table class="rt"><tr><th>Change</th><th>Why (evidence)</th><th>Positions</th><th>Impact</th></tr>' + acts + "</table></div>"
    + "<h4>The deck for this country</h4>" + '<div class="tablewrap"><table class="rt"><tr><th>#</th><th>Change</th><th>Screen to capture</th><th>Local text (back-translation)</th><th>Band</th><th>Game logo</th><th>Wording and why</th></tr>' + deck + "</table></div>"
    + (terms ? "<h4>Words to use</h4><ul>" + terms + "</ul>" : "")
    + (x.keepFromMain ? "<p><strong>Keep as on the main page:</strong> " + esc(x.keepFromMain) + "</p>" : "")
    + (rv ? "<p><strong>Second opinion:</strong> " + (rv.verdict === "ok" ? "no major problems" : "changes requested") + (a.revised ? " (the advice above was revised after it)" : "") + ".</p>" + (rv.findings.length ? "<ul>" + rv.findings.map((f) => "<li>" + (f.severity === "major" ? "<strong>Major</strong>" : "Minor") + ", " + (f.position ? "position " + f.position : "whole deck") + ": " + esc(f.issue) + " " + esc(f.suggestion) + "</li>").join("") + "</ul>" : "") : "")
    + '<p class="meta">' + esc(a.note) + "</p>";
}
// Fact ids (C1, C2) are internal: never shown.
function noIdText(s) { return String(s || "").replace(/\\s*\\((?:facts? )?C\\d+(?:\\s*(?:,|and)\\s*C\\d+)*\\)/g, "").replace(/\\b(?:facts? )?C\\d+(?:(?:\\s*,\\s*|\\s+and\\s+)C\\d+)*\\b/g, "this evidence"); }

function adviceHtml(c) {
  const main = c.countries.filter((x) => x.isMain && x.data.ai && x.data.ai.recommendations);
  return c.advice.map((a, i) => '<details class="sec"' + (i === 0 ? " open" : "") + "><summary><span class=\\"sec-t\\">" + cflag(a.gl, a.label) + "</span></summary><div class=\\"sec-b\\">" + adviceOne(a) + "</div></details>").join("")
    + main.map((m) => '<details class="sec"><summary><span class="sec-t">' + cflag(m.gl, m.label) + ' (main country)</span></summary><div class="sec-b">' + recsHtml(m.data) + "</div></details>").join("")
    + (!c.advice.length && !main.length ? "<p>None written yet.</p>" : "");
}

function perCountryHtml(c) {
  return c.countries.map((x) => { const d = Object.assign({}, x.data, { sorting: null }); return '<details class="sec"><summary><span class="sec-t">' + cflag(x.gl, x.label) + '</span> <span class="meta">' + esc(x.data.fit ? x.data.fit.verdict : "not enough data") + "</span></summary><div class=\\"sec-b\\">"
    + (x.data.fit && x.data.fit.keyPoints.length ? "<h4>Key points to optimise here</h4><ol>" + x.data.fit.keyPoints.map((k) => "<li>" + esc(k) + "</li>").join("") + "</ol>" : "")
    + "<h4>Position by position</h4>" + positionsHtml(d) + "<h4>Patterns and our fit</h4>" + fitHtml(d) + "</div></details>"; }).join("");
}

// Draws a country version c into box, for report rid.
function renderCountryReport(box, c, rid, research) {
  if (!box || !c) return;
  const labels = {};
  for (const x of c.countries) Object.assign(labels, x.data.labels || {});
  reportData = { labels, sorting: c.sorting };
  repRid = String(rid || "").replace(/[^a-z0-9-]/g, "");
  repStage = "report";
  repSecs = COUNTRY_SECS.filter(([id]) => (id === "local" || id === "habits" ? !!c.localisation : id === "research" ? !!research : true)).map(([id, t]) => ({ id, t }));
  const n = (id) => repSecs.findIndex((s) => s.id === id);
  const part = (id, body, imgs, closed) => (n(id) < 0 ? "" : sec(n(id), body, imgs, closed));
  box.classList.toggle("noimg", !showImgs);
  box.innerHTML = part("summary", countrySummaryHtml(c), false) + tocHtml()
    + part("advice", adviceHtml(c), false)
    + part("countries", perCountryHtml(c), true)
    + part("local", localisationHtml(c), true)
    + part("habits", habitsHtml(c), false)
    + part("words", wordsHtml(c), false)
    + part("abtests", abDetailsHtml({ abTests: c.abTests }), false)
    + part("sorting", sortingHtml(c.sorting) || "<p>Nothing is sorted yet: no analyses in this report.</p>", true)
    + part("research", research || "", false)
    + part("stats", c.countries.map((x) => "<h3>" + cflag(x.gl, x.label) + "</h3>" + patternsHtml(x.data.patterns)).join(""), false, true);
}
`;

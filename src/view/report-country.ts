import { COUNTRY_TABS_CSS, COUNTRY_TABS_SCRIPT } from "./report-country-tabs.ts";
import { REPORT_GROUPS_CSS, REPORT_GROUPS_SCRIPT } from "./report-groups.ts";

/**
 * A One country or Compare countries version (country-report.json), drawn into its card, in
 * three numbered parts (user, 2026-09-29): 1 Overall recommendations (the short answer, a
 * verdict card per country, the gaps several countries share, each country's own key points and
 * the A/B tests), then the contents, 2 Across countries (how each game localises, our habits vs
 * the competitors', words across languages, A/B test details, how we sort images, what to
 * research next) and 3 Per country (one tab per country: report-country-tabs.ts). Every value is
 * escaped; the parts live in report-country-parts.ts.
 */
export const REPORT_COUNTRY_CSS = `
.vcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; margin: 10px 0; }
.vcard { background: var(--bg); border: 1px solid var(--line); border-left: 6px solid var(--mid); border-radius: 10px; padding: 8px 12px; }
.vcard.following { border-left-color: var(--ok); } .vcard.slightly { border-left-color: var(--mid); } .vcard.very { border-left-color: var(--bad); }
.vcard h4 { margin: 0 0 4px; font-size: 15px; } .vcard p { margin: 4px 0; font-size: 13px; }
.missing { border-left: 5px solid var(--warn); background: var(--bg); padding: 6px 12px; margin: 8px 0; }
table.rt td.local { font-weight: 700; } .bt { color: var(--muted); font-style: italic; }
.cmp2 { display: inline-flex; gap: 4px; align-items: center; } .cmp2 img { width: 44px; height: 78px; object-fit: contain; border: 1px solid var(--line); border-radius: 3px; background: var(--bg); }
${COUNTRY_TABS_CSS}${REPORT_GROUPS_CSS}`;

export const REPORT_COUNTRY_SCRIPT = `
const cname = (label) => String(label || "").replace(/\\s*\\([^)]*\\)\\s*$/, "");
// A country with its flag (the flags helper, when the page has it).
function cflag(gl, label) { return typeof countryLabel === "function" ? countryLabel(gl, cname(label)) : esc(cname(label)); }
const COUNTRY_SECS = [["summary", "Overall recommendations"], ["across", "Across countries"], ["countries", "Per country"]];

function missingHtml(c) {
  if (!c.missing.length && !c.banners.length) return "";
  return c.banners.map((b) => '<div class="banner stale"><p>' + esc(b) + "</p></div>").join("")
    + (c.missing.length ? '<div class="missing"><p><strong>Not written yet in this version:</strong></p><ul>' + c.missing.map((m) => "<li>" + esc(m.what) + "</li>").join("") + '</ul><p><button type="button" class="primary rc-approve" data-rid="' + repRid + '">Review and approve</button> <span class="meta">Shows the exact images, steps and cost first; nothing runs until you approve.</span></p></div>' : "");
}

function verdictCard(v) {
  return '<div class="vcard ' + (VERDICT_CLS[v.verdict] || "") + '"><h4>' + cflag(v.gl, v.label) + (v.isMain ? ' <span class="meta">(main country)</span>' : "") + "</h4>"
    + "<p>" + pill(VERDICT_CLS[v.verdict] || "none", v.verdict) + (v.points ? ' <span class="meta">' + v.points.fit + " of " + v.points.total + " pattern points</span>" : "") + "</p>"
    + (v.keyPoint ? "<p><strong>Biggest gap:</strong> " + esc(v.keyPoint) + "</p>" : "")
    + (v.shortAnswer || v.localisation ? "<details><summary>More</summary>" + (v.shortAnswer ? "<p>" + esc(v.shortAnswer) + "</p>" : "") + (v.localisation ? "<p><strong>Localisation:</strong> " + esc(v.localisation) + "</p>" : "") + "</details>" : "") + "</div>";
}

// Gaps several countries share (computed): each key point's claim is the part before ": ".
const kpKey = (k) => { const m = /^(.+?):\\s+(.+)$/.exec(String(k)); return m ? { key: m[1], detail: m[2].replace(/\\.$/, "") } : { key: String(k), detail: "" }; };
function sharedPoints(c) {
  if (c.countries.length < 2) return [];
  const m = new Map();
  for (const x of c.countries) for (const k of x.data.fit ? x.data.fit.keyPoints : []) {
    const p = kpKey(k);
    const g = m.get(p.key) || { key: p.key, per: [] };
    if (!g.per.some((q) => q.gl === x.gl)) g.per.push({ gl: x.gl, label: x.label, detail: p.detail });
    m.set(p.key, g);
  }
  return [...m.values()].filter((g) => g.per.length >= 2).sort((a, b) => b.per.length - a.per.length);
}
const firstSent = (s) => { const m = /^.+?[.!?](?=\\s|$)/.exec(String(s || "").trim()); return m ? m[0] : String(s || "").trim(); };
// A country's own key points: its advice's first actions when written, else its computed gaps not shared above.
function ownPoints(c, gl, shared) {
  const a = c.advice.find((x) => x.gl === gl);
  if (a && a.advice) return a.advice.actions.slice(0, 3).map((x) => ({ text: noIdText(x.action), why: firstSent(noIdText(x.why)), impact: x.impact, code: false }));
  const x = c.countries.find((y) => y.gl === gl);
  const kps = x && x.data.fit ? x.data.fit.keyPoints : [];
  const keys = new Set(shared.filter((g) => g.per.some((q) => q.gl === gl)).map((g) => g.key));
  const acts = c.summary.keyActions.filter((k) => k.gl === gl && k.source === "code" && !kps.includes(k.text)).map((k) => ({ text: k.text, why: k.why, impact: null, code: true }));
  return acts.concat(kps.filter((k) => !keys.has(kpKey(k).key)).map((k) => ({ text: k, why: "", impact: null, code: true }))).slice(0, 3);
}
const impactPill = (i) => (i ? " " + pill(i === "large" ? "following" : i === "medium" ? "slightly" : "none", i + " impact") : "");

function countrySummaryHtml(c) {
  const s = c.summary;
  const n = c.countries.length;
  const shared = sharedPoints(c);
  // Each shared gap names its countries; what it looks like in each is in the tooltip.
  const across = shared.map((g) => '<li title="' + esc(g.per.filter((q) => q.detail).map((q) => cname(q.label) + ": " + q.detail).join("; ")) + '"><strong>' + esc(g.key) + '</strong> <span class="meta">' + (g.per.length === n ? "all " + n + " countries" : esc(g.per.map((q) => cname(q.label)).join(", "))) + "</span></li>");
  const own = c.countries.map((x) => ({ x, pts: ownPoints(c, x.gl, shared) })).filter((o) => o.pts.length).map((o) => (n > 1 ? "<h4>" + cflag(o.x.gl, o.x.label) + "</h4>" : "") + '<ol class="keyrecs">'
    + o.pts.map((p) => "<li>" + esc(p.text) + (p.why ? ' <span class="meta">' + esc(p.why) + "</span>" : "") + impactPill(p.impact) + "</li>").join("")
    + '</ol><p><button type="button" class="linkbtn" data-ctab="' + esc(o.x.gl) + '">Full spec for ' + esc(cname(o.x.label)) + "</button></p>").join("");
  const d = s.dates;
  const comp = [...new Set(s.verdicts.map((v) => v.competitors).filter((k) => k))];
  // The verdict line, with the sample-size caveat said once.
  const lo = Math.min(...comp);
  const hi = Math.max(...comp);
  const vline = comp.length ? '<p class="meta">Against ' + esc(lo === hi ? hi : lo + " to " + hi) + " competitors" + (n > 1 ? " per country" : "") + (hi < SMALL_SAMPLE ? " (a small sample: read patterns as strong hints)" : "") + ".</p>" : "";
  const meta = [comp.length > 1 ? "<p>Competitors per country: " + esc(s.verdicts.map((v) => cname(v.label) + " " + v.competitors).join(", ")) + ".</p>" : "",
    across.length ? "<p>Gaps across countries are computed by code from each country\\u2019s competitor patterns.</p>" : "", abNoteHtml(c.abTests),
    '<p class="dates">Generated ' + esc(fmtWhen(d.generated)) + ". Store pages from " + esc(d.storeFrom && d.storeTo && d.storeFrom !== d.storeTo ? d.storeFrom + " to " + d.storeTo : d.storeFrom || "not saved") + ". Analyses as of " + esc(d.analyses || "none yet") + ". Main country (the reference for what changed): " + esc(cname(c.main.label)) + ".</p>"];
  return missingHtml(c) + '<p class="short">' + esc(s.shortAnswer) + "</p>"
    + '<div class="vcards">' + s.verdicts.map((v) => verdictCard(s.verdicts.length === 1 ? Object.assign({}, v, { shortAnswer: "" }) : v)).join("") + "</div>" + vline
    + (across.length ? "<h3>Across countries</h3>" + capList("ol", "keyrecs", across, 3) : "")
    + "<h3>" + (n > 1 ? "Key points per country" : "Key points") + "</h3>" + (own || "<p>None: our page follows the competitors\\u2019 patterns here.</p>")
    + abCardsHtml({ abTests: c.abTests, multi: n > 1 }) + detailsFold(meta);
}

const CHANGE_WORDS = { same: "same as the main deck", translate: "translated", reword: "new wording", recapture: "recapture, local text", "new-picture": "new picture", moved: "moved" };
function adviceOne(a) {
  if (!a.advice) return "<p>" + esc(a.note) + "</p>";
  const x = a.advice;
  const acts = x.actions.map((t) => "<tr><td><strong>" + esc(noIdText(t.action)) + "</strong></td><td>" + esc(noIdText(t.why)) + "</td><td>" + (t.positions.length ? esc(t.positions.join(", ")) : "all") + "</td><td>" + pill(t.impact === "large" ? "following" : t.impact === "medium" ? "slightly" : "none", t.impact) + "</td></tr>").join("");
  const deck = x.deck.map((p) => '<tr class="' + (p.change === "same" ? "" : "miss") + '"><th>' + p.position + "</th><td>" + esc(CHANGE_WORDS[p.change] || p.change) + (p.fromMainPosition ? ' <span class="meta">(main #' + p.fromMainPosition + ")</span>" : ' <span class="meta">(new)</span>') + "</td><td>" + esc(p.screen) + '</td><td class="local">' + esc(p.headline) + (p.subline ? "<br>" + esc(p.subline) : "") + '<div class="bt">' + esc(p.backTranslation) + "</div></td><td>" + esc(p.band) + "</td><td>" + (p.logo.show ? "yes" : "no") + '<div class="meta">' + esc(p.logo.why) + "</div></td><td>" + esc(p.wordingNotes) + '<div class="meta">' + esc(noIdText(p.why)) + "</div></td></tr>").join("");
  const rv = a.review;
  return '<p class="short">' + esc(noIdText(x.shortAnswer)) + "</p><h4>What to change, most important first</h4>"
    + '<div class="tablewrap"><table class="rt"><tr><th>Change</th><th>Why (evidence)</th><th>Positions</th><th>Impact</th></tr>' + acts + "</table></div>"
    + fold("The deck for this country, image by image (" + x.deck.length + ")", '<div class="tablewrap"><table class="rt"><tr><th>#</th><th>Change</th><th>Screen to capture</th><th>Local text (back-translation)</th><th>Band</th><th>Game logo</th><th>Wording and why</th></tr>' + deck + "</table></div>", "slotd")
    + wordsToUseHtml(a)
    + (x.keepFromMain ? "<p><strong>Keep as on the main page:</strong> " + esc(x.keepFromMain) + "</p>" : "")
    + (rv ? fold("Second opinion on this advice", "<p>" + (rv.verdict === "ok" ? "No major problems" : "Changes requested") + (a.revised ? " (the advice above was revised after it)" : "") + ".</p>" + (rv.findings.length ? "<ul>" + rv.findings.map((f) => "<li>" + (f.severity === "major" ? "<strong>Major</strong>" : "Minor") + ", " + (f.position ? "position " + f.position : "whole deck") + ": " + esc(f.issue) + " " + esc(f.suggestion) + "</li>").join("") + "</ul>" : ""), "review") : "")
    + detailsFold([a.note ? "<p>" + esc(a.note) + "</p>" : ""]);
}
// Fact ids (C1, C2) are internal: never shown.
function noIdText(s) { return String(s || "").replace(/\\s*\\((?:facts? )?C\\d+(?:\\s*(?:,|and)\\s*C\\d+)*\\)/g, "").replace(/\\b(?:facts? )?C\\d+(?:(?:\\s*,\\s*|\\s+and\\s+)C\\d+)*\\b/g, "this evidence"); }

// Draws a country version c into box, for report rid: 1 Overall recommendations, the contents,
// 2 Across countries (left out when empty), 3 Per country (open, one tab per country).
function renderCountryReport(box, c, rid, research) {
  if (!box || !c) return;
  const labels = {};
  for (const x of c.countries) Object.assign(labels, x.data.labels || {});
  reportData = { labels, sorting: c.sorting };
  repRid = String(rid || "").replace(/[^a-z0-9-]/g, "");
  repStage = "report";
  const across = acrossParts(c, research);
  repSecs = COUNTRY_SECS.filter(([id]) => id !== "across" || across.length).map(([id, t]) => ({ id, t }));
  const n = (id) => repSecs.findIndex((s) => s.id === id);
  const part = (id, body, imgs) => (n(id) < 0 ? "" : sec(n(id), body, imgs, false));
  box.classList.toggle("noimg", !showImgs);
  box.innerHTML = part("summary", samePagesTop(c) + countrySummaryHtml(c) + groupsLine(c) + derivedBandHtml(c), false) + countryTocHtml(c, across)
    + part("across", across.map(subSec).join(""), false)
    + part("countries", countryTabsHtml(c), true);
}
${COUNTRY_TABS_SCRIPT}${REPORT_GROUPS_SCRIPT}`;

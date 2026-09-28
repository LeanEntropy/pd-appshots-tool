/**
 * Suggested next research (plan-reports 5A) in the Report tab, above the list: folded by default
 * (the open or closed choice is kept per project in this browser), the top suggestions as boxes
 * side by side (why, what, cost, and why it ranks there), "Show all", dismissed ones, "How are
 * these ranked?", and the coverage map (folded; every game by every country, a cell opens the
 * builder for that game and country). Also "What to research next" near the end of each open
 * report: the list saved with the version, and the live one labelled "Now" when it differs.
 * Code only on the server: showing this costs nothing, and every button only opens the builder
 * (or the country picker, which asks before downloading anything).
 */
export const SUGGEST_CSS = `
.offers { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr)); gap: 16px; margin: 12px 0; }
.offer { --oc: var(--accent-2); display: flex; flex-direction: column; gap: 10px; padding: 16px 18px; border-radius: 12px; border: 1px solid color-mix(in srgb, var(--oc) 28%, var(--line)); background: color-mix(in srgb, var(--oc) 9%, var(--card)); min-width: 0; }
.offer .offer-top { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
.offer h4 { margin: 0; font-size: 15px; line-height: 1.3; } .offer p { margin: 0; } .offer .why { line-height: 1.45; color: var(--muted); }
.offer .chip { flex: none; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--card); border: 1px solid var(--line); white-space: nowrap; }
.offer .offer-acts { margin-top: auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.offer .offer-acts button, .offer .offer-acts .btn { margin: 0; padding: 5px 12px; border-radius: 8px; }
.offer .offer-acts a.btn { display: inline-block; border: 1px solid var(--line); background: var(--bg); color: var(--text); text-decoration: none; }
.offer button.sgd { margin-left: auto; padding: 2px 4px; border: none; background: none; color: var(--muted); font-size: 12px; text-decoration: underline; cursor: pointer; }
.offer details.offer-more > summary { cursor: pointer; font-size: 13px; color: var(--muted); }
.offer details.offer-more[open] > summary { margin-bottom: 6px; } .offer details.offer-more p { margin: 0 0 6px; font-size: 13px; }
.offer details.offer-more .offer-acts { margin-top: 6px; }
.offer.c-full-check { --oc: var(--accent); } .offer.c-same { --oc: var(--muted); } .offer.c-charts { --oc: var(--mid); }
.offer.c-weak { --oc: var(--brand); } .offer.c-regenerate { --oc: var(--ok); } .offer.c-pick-gap { --oc: var(--next); }
#suggestPanel details.sec > summary .sg-n { font-size: 13px; font-weight: 600; color: var(--muted); }
#suggestPanel .sg-more { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; margin: 4px 0 10px; }
table.cov { border-collapse: collapse; font-size: 12px; margin: 6px 0; } table.cov th, table.cov td { border: 1px solid var(--line); padding: 3px 6px; text-align: left; }
table.cov td button { font: inherit; font-size: 12px; border: none; background: none; cursor: pointer; padding: 0; color: inherit; text-align: left; }
table.cov td.analysed { background: color-mix(in srgb, var(--ok) 25%, transparent); } table.cov td.partly { background: color-mix(in srgb, var(--mid) 25%, transparent); }
table.cov td.downloaded { background: var(--bg); } table.cov td.not-sold, table.cov td.not-downloaded { color: var(--muted); }
table.cov .used { display: block; font-size: 11px; color: var(--accent-2); font-weight: 600; }
.covwrap { overflow-x: auto; max-width: 100%; }
.research ol, [data-sec="research"] ol { margin: 4px 0; } .research .older, [data-sec="research"] .older { color: var(--warn); font-size: 12px; }
`;

export const SUGGEST_SCRIPT = `
let suggestView = null;
let suggestAll = false;
let suggestDismissedOpen = false;
const CELL_WORDS = { "not-sold": "Not sold here", "not-downloaded": "Not downloaded", downloaded: "Downloaded", partly: "Partly analysed", analysed: "Analysed" };
// Folded by default; the user's open or closed choice is kept per project in this browser.
const SG_KEY = "ssr.suggest.open:" + API;
let suggestOpen = false;
try { suggestOpen = localStorage.getItem(SG_KEY) === "1"; } catch {}
// A suggestion of a report over several countries also offers adding countries to the project.
const multiCountry = (s) => [s.action, s.second].some((a) => a && a.scope && (a.scope.type === "compare" || (a.scope.markets || []).length > 1));

function suggestionCard(s) {
  const act1 = s.action ? (s.action.scope ? '<button type="button" class="sgo primary" data-sid="' + esc(s.id) + '" data-which="1">' + esc(s.action.label) + "</button>" : '<a class="btn" href="' + esc(s.action.href) + '">' + esc(s.action.label) + "</a>") : "";
  const act2 = s.second ? '<button type="button" class="sgo" data-sid="' + esc(s.id) + '" data-which="2">' + esc(s.second.label) + "</button>" : "";
  const more = multiCountry(s) ? '<button type="button" class="cpOpen" data-act-key="cp-' + esc(s.id) + '">Add countries</button>' : "";
  const chip = s.costChip || (s.costText === "free" ? "Free" : "");
  // Title, one short line, the cost chip and one button; everything else behind Details.
  return '<div class="offer c-' + esc(s.category) + '"><div class="offer-top"><h4>' + flagText(s.title) + "</h4>" + (chip ? '<span class="chip">' + esc(chip) + "</span>" : "") + "</div>"
    + '<p class="why">' + esc(s.short || s.why) + (s.older ? ' <span class="older">(based on older data)</span>' : "") + "</p>"
    + '<details class="offer-more"><summary>Details</summary><p>' + esc(s.why) + "</p>"
    + '<p class="meta">' + esc(s.what) + "<br>Cost: " + esc(s.costText) + "<br>" + esc(s.rankWhy) + "</p>"
    + (act2 || more ? '<div class="offer-acts">' + act2 + more + "</div>" : "") + "</details>"
    + '<div class="offer-acts">' + act1 + '<button type="button" class="sgd" data-sid="' + esc(s.id) + '" data-act-key="sgd-' + esc(s.id) + '" title="' + (s.dismissedNow ? "Show this suggestion again" : "Hide this suggestion") + '">' + (s.dismissedNow ? "Show again" : "Dismiss") + "</button></div></div>";
}

function coverageHtml(c) {
  const head = "<tr><th>Game</th>" + c.countries.map((m) => "<th>" + countryLabel(m.gl, countryOf(m.label)) + "</th>").join("") + "</tr>";
  const rows = (list) => list.map((r) => "<tr><th>" + esc(r.name) + (r.inPick ? ' <span class="meta">(pick)</span>' : "") + "</th>" + r.cells.map((x, i) => {
    const word = CELL_WORDS[x.state] + (x.state === "partly" ? " (" + x.analysed + " of " + x.total + ")" : "");
    const used = x.reports.length ? '<span class="used" title="' + esc(x.reports.join(", ")) + '">used in ' + x.reports.length + (x.reports.length === 1 ? " report" : " reports") + "</span>" : "";
    const can = x.state !== "not-sold" && x.state !== "not-downloaded" && r.kind !== "ours";
    return '<td class="' + esc(x.state) + '">' + (can ? '<button type="button" class="covc" data-app="' + esc(r.appId) + '" data-kind="' + esc(r.kind) + '" data-gl="' + esc(c.countries[i].gl) + '" title="Set up a report of this game in this country">' + esc(word) + "</button>" : esc(word)) + used + "</td>";
  }).join("") + "</tr>").join("");
  const charts = c.rows.filter((r) => r.kind === "chart");
  return '<div class="covwrap"><table class="cov">' + head + rows(c.rows.filter((r) => r.kind !== "chart")) + "</table></div>"
    + (charts.length ? "<details><summary>Chart games (" + charts.length + ')</summary><div class="covwrap"><table class="cov">' + head + rows(charts) + "</table></div></details>" : "")
    + '<p><button type="button" class="cpOpen" data-act-key="cp-cov">Add countries to the project</button></p>';
}

function renderSuggestions() {
  const box = document.getElementById("suggestPanel");
  const v = suggestView;
  if (!box || !v) return;
  const list = suggestAll ? v.suggestions : v.suggestions.slice(0, 3);
  const count = v.note ? "" : '<span class="sg-n">' + v.suggestions.length + (v.suggestions.length === 1 ? " idea" : " ideas") + ", free to look at</span>";
  const toggles = (v.suggestions.length > 3 ? '<button type="button" class="linkbtn" id="sgAll">' + (suggestAll ? "Show the top 3" : "Show all (" + v.suggestions.length + ")") + "</button>" : "")
    + (v.dismissed.length ? '<button type="button" class="linkbtn" id="sgDis">' + (suggestDismissedOpen ? "Hide dismissed" : "Show dismissed (" + v.dismissed.length + ")") + "</button>" : "");
  box.innerHTML = '<details class="sec" id="sgSec"' + (suggestOpen ? " open" : "") + '><summary><span class="sec-t">Suggested next research</span>' + count + '</summary><div class="sec-b">'
    + '<p class="meta">Computed from what is on disk, with no AI and no cost. Each suggestion only opens the report builder, which shows the exact images and cost first.</p>'
    + (v.note ? "<p>" + esc(v.note) + "</p>" : list.length ? '<div class="offers">' + list.map(suggestionCard).join("") + "</div>" : "<p>Nothing to suggest: every gap the tool can see is covered.</p>")
    + (toggles ? '<p class="sg-more">' + toggles + "</p>" : "")
    + (suggestDismissedOpen && v.dismissed.length ? '<div class="offers">' + v.dismissed.map((s) => suggestionCard(Object.assign({}, s, { dismissedNow: true }))).join("") + "</div>" : "")
    + "<details><summary>How are these ranked?</summary><ul>" + v.rules.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul></details>"
    + "<details><summary>Coverage map: every game in every country</summary>" + coverageHtml(v.coverage) + "</details>"
    + "</div></details>";
}

document.addEventListener("toggle", (e) => {
  if (!e.target || e.target.id !== "sgSec") return;
  suggestOpen = e.target.open;
  try { localStorage.setItem(SG_KEY, suggestOpen ? "1" : "0"); } catch {}
}, true);

async function loadSuggestions() {
  const box = document.getElementById("suggestPanel");
  if (!box || !location.protocol.startsWith("http")) return;
  if (!suggestView) actLine(box, "busy", "Working out what to research next...");
  try { suggestView = await getJson(API + "/suggestions"); box.className = ""; box.removeAttribute("role"); renderSuggestions(); }
  catch (e) { actLine(box, "bad", "The suggestions could not be loaded: " + actReason(e)); }
}

// "What to research next" in an open report: saved with the version, plus "Now" when it differs.
// The section body ("" when there is nothing to show); one country is a numbered section of it.
function researchBody(saved) {
  const live = suggestView && !suggestView.note ? suggestView.suggestions.filter((s) => s.category !== "same").slice(0, 5) : null;
  const savedItems = saved && Array.isArray(saved.items) ? saved.items : null;
  const same = savedItems && live && savedItems.map((s) => s.id).join() === live.map((s) => s.id).join();
  let body = "";
  if (savedItems) body += (savedItems.length ? researchList(savedItems) : "<p>Nothing to suggest when this version was made.</p>");
  if (live && !same) body += "<h4>Now</h4>" + (live.length ? researchList(live) : "<p>Nothing to suggest now.</p>");
  return body ? body + '<p class="meta">See Suggested next research at the top of this page to set any of these up.</p>' : "";
}

// The same as its own section, after the countries of a Compare countries report.
function researchHtml(saved) {
  const body = researchBody(saved);
  return body ? '<details class="sec research" open><summary><span class="sec-t">What to research next</span></summary><div class="sec-b">' + body + "</div></details>" : "";
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button");
  if (!b || !suggestView) return;
  if (b.id === "sgAll") { suggestAll = !suggestAll; renderSuggestions(); return; }
  if (b.id === "sgDis") { suggestDismissedOpen = !suggestDismissedOpen; renderSuggestions(); return; }
  const all = suggestView.suggestions.concat(suggestView.dismissed);
  if (b.classList.contains("sgo")) {
    const s = all.find((x) => x.id === b.dataset.sid);
    const target = s && (b.dataset.which === "2" ? s.second : s.action);
    if (target && target.scope) act(b, { busy: "Opening the builder...", run: () => openBuilder({ type: target.scope.type, scope: target.scope }), done: "" });
  } else if (b.classList.contains("sgd")) {
    const dismissed = suggestView.dismissed.some((x) => x.id === b.dataset.sid);
    act(b, { busy: dismissed ? "Restoring..." : "Dismissing...", run: async () => { await send(API + "/suggestions/" + encodeURIComponent(b.dataset.sid) + (dismissed ? "/restore" : "/dismiss"), {}); await loadSuggestions(); }, done: dismissed ? "Shown again." : "Dismissed. Find it under Show dismissed." });
  } else if (b.classList.contains("covc")) {
    const chart = b.dataset.kind === "chart";
    act(b, { busy: "Opening the builder...", run: () => openBuilder({ type: "country", scope: { type: "country", markets: [{ gl: b.dataset.gl }], competitors: chart ? [] : [b.dataset.app], includeCharts: chart ? [b.dataset.app] : [] } }), done: "" });
  }
});
`;

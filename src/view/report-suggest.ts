/**
 * Suggested next research (plan-reports 5A) in the Report tab, above the list: the top
 * suggestions (why, what, cost, and why it ranks there), "Show all", dismissed ones, "How are
 * these ranked?", and the coverage map (folded; every game by every country, a cell opens the
 * builder for that game and country). Also "What to research next" near the end of each open
 * report: the list saved with the version, and the live one labelled "Now" when it differs.
 * Code only on the server: showing this costs nothing, and every button only opens the builder.
 */
export const SUGGEST_CSS = `
#suggestPanel .sg { background: var(--card); border: 1px solid var(--line); border-left: 5px solid var(--accent-2); border-radius: 10px; padding: 8px 12px; margin: 8px 0; }
#suggestPanel .sg.same { border-left-color: var(--muted); } .sg h4 { margin: 0 0 4px; } .sg .why { margin: 2px 0; } .sg .bacts { margin-top: 6px; }
table.cov { border-collapse: collapse; font-size: 12px; margin: 6px 0; } table.cov th, table.cov td { border: 1px solid var(--line); padding: 3px 6px; text-align: left; }
table.cov td button { font: inherit; font-size: 12px; border: none; background: none; cursor: pointer; padding: 0; color: inherit; text-align: left; }
table.cov td.analysed { background: color-mix(in srgb, var(--ok) 25%, transparent); } table.cov td.partly { background: color-mix(in srgb, var(--mid) 25%, transparent); }
table.cov td.downloaded { background: var(--bg); } table.cov td.not-sold, table.cov td.not-downloaded { color: var(--muted); }
table.cov .used { display: block; font-size: 11px; color: var(--accent-2); font-weight: 600; }
.research ol, [data-sec="research"] ol { margin: 4px 0; } .research .older, [data-sec="research"] .older { color: var(--warn); font-size: 12px; }
`;

export const SUGGEST_SCRIPT = `
let suggestView = null;
let suggestAll = false;
let suggestDismissedOpen = false;
const CELL_WORDS = { "not-sold": "Not sold here", "not-downloaded": "Not downloaded", downloaded: "Downloaded", partly: "Partly analysed", analysed: "Analysed" };

function suggestionCard(s) {
  const act1 = s.action ? (s.action.scope ? '<button type="button" class="sgo primary" data-sid="' + esc(s.id) + '" data-which="1">' + esc(s.action.label) + "</button>" : '<a class="btn" href="' + esc(s.action.href) + '">' + esc(s.action.label) + "</a>") : "";
  const act2 = s.second ? '<button type="button" class="sgo" data-sid="' + esc(s.id) + '" data-which="2">' + esc(s.second.label) + "</button>" : "";
  return '<div class="sg ' + esc(s.category) + '"><h4>' + esc(s.title) + "</h4>"
    + '<p class="why">' + esc(s.why) + (s.older ? ' <span class="older">(based on older data)</span>' : "") + "</p>"
    + '<p class="meta">' + esc(s.what) + " \\u00b7 Cost: " + esc(s.costText) + " \\u00b7 " + esc(s.rankWhy) + "</p>"
    + '<div class="bacts">' + act1 + act2 + '<button type="button" class="sgd" data-sid="' + esc(s.id) + '" data-act-key="sgd-' + esc(s.id) + '">' + (s.dismissedNow ? "Show again" : "Dismiss") + "</button></div></div>";
}

function coverageHtml(c) {
  const head = "<tr><th>Game</th>" + c.countries.map((m) => "<th>" + esc(countryOf(m.label)) + "</th>").join("") + "</tr>";
  const rows = (list) => list.map((r) => "<tr><th>" + esc(r.name) + (r.inPick ? ' <span class="meta">(pick)</span>' : "") + "</th>" + r.cells.map((x, i) => {
    const word = CELL_WORDS[x.state] + (x.state === "partly" ? " (" + x.analysed + " of " + x.total + ")" : "");
    const used = x.reports.length ? '<span class="used" title="' + esc(x.reports.join(", ")) + '">used in ' + x.reports.length + (x.reports.length === 1 ? " report" : " reports") + "</span>" : "";
    const can = x.state !== "not-sold" && x.state !== "not-downloaded" && r.kind !== "ours";
    return '<td class="' + esc(x.state) + '">' + (can ? '<button type="button" class="covc" data-app="' + esc(r.appId) + '" data-kind="' + esc(r.kind) + '" data-gl="' + esc(c.countries[i].gl) + '" title="Set up a report of this game in this country">' + esc(word) + "</button>" : esc(word)) + used + "</td>";
  }).join("") + "</tr>").join("");
  const charts = c.rows.filter((r) => r.kind === "chart");
  return '<table class="cov">' + head + rows(c.rows.filter((r) => r.kind !== "chart")) + "</table>"
    + (charts.length ? "<details><summary>Chart games (" + charts.length + ')</summary><table class="cov">' + head + rows(charts) + "</table></details>" : "");
}

function renderSuggestions() {
  const box = document.getElementById("suggestPanel");
  const v = suggestView;
  if (!box || !v) return;
  const list = suggestAll ? v.suggestions : v.suggestions.slice(0, 3);
  box.innerHTML = '<details class="sec" open><summary><span class="sec-t">Suggested next research</span></summary><div class="sec-b">'
    + '<p class="meta">Computed from what is on disk, with no AI and no cost. Each suggestion only opens the report builder, which shows the exact images and cost first.</p>'
    + (v.note ? "<p>" + esc(v.note) + "</p>" : list.length ? list.map(suggestionCard).join("") : "<p>Nothing to suggest: every gap the tool can see is covered.</p>")
    + (v.suggestions.length > 3 ? '<p><button type="button" class="linkbtn" id="sgAll">' + (suggestAll ? "Show the top 3" : "Show all (" + v.suggestions.length + ")") + "</button></p>" : "")
    + (v.dismissed.length ? '<p><button type="button" class="linkbtn" id="sgDis">' + (suggestDismissedOpen ? "Hide dismissed" : "Show dismissed (" + v.dismissed.length + ")") + "</button></p>" + (suggestDismissedOpen ? v.dismissed.map((s) => suggestionCard(Object.assign({}, s, { dismissedNow: true }))).join("") : "") : "")
    + "<details><summary>How are these ranked?</summary><ul>" + v.rules.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul></details>"
    + "<details><summary>Coverage map: every game in every country</summary>" + coverageHtml(v.coverage) + "</details>"
    + "</div></details>";
}

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

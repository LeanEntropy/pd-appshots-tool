/**
 * In-page analysis gate and live status. "Start analysis" asks the local server for the approval
 * numbers (no AI). Only "Approve and run" starts model calls, for exactly the batch shown. The
 * status box is always filled (running, last result, or "nothing yet"); the page never reloads
 * itself: new analyses and the final report are fetched and shown in place.
 */
export const ANALYSIS_SCRIPT = `
let shownPlan = null;
let pollTimer = null;
let lastStatus = null;
let wasRunning = false;

function money(n) { return "$" + Number(n || 0).toFixed(2); }
function elapsed(from, to) {
  if (!from) return "";
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
}

function renderApproval(p) {
  const games = p.games.map((g) => "<li>" + esc(g.name) + ": positions " + (g.positions.join(", ") || "none") + "</li>").join("");
  const passes = p.estimate.passes.map((m) => "<tr><td>" + esc(m.role) + "</td><td>" + esc(m.model) + "</td><td>" + m.calls + "</td><td>" + m.images + "</td></tr>").join("");
  const excluded = p.excluded.length ? '<p class="meta">Left out (shown raw, not analysed): ' + p.excluded.length + " screenshots, e.g. " + esc(p.excluded[0].name + " position " + p.excluded[0].position + ": " + p.excluded[0].reason) + "</p>" : "";
  const blocked = !p.withinCap ? '<p class="warn">This batch would take the core above its cap. It cannot run.</p>' : "";
  const canRun = p.withinCap && (p.counts.newImages > 0 || p.synthesisNeeded);
  document.getElementById("approval").innerHTML = "<h3>" + (p.stage === "pilot" ? "Core pilot" : "Core check") + ": approval</h3>"
    + "<p>" + esc(p.market.label) + ". To analyse: <strong>" + p.counts.full + "</strong>, marketing-layer diff: " + p.counts.layerDiff + ", already analysed or identical (no AI): " + p.counts.identical + ". Core total after this batch: " + p.coreTotal + " of " + p.cap + ".</p>"
    + "<ul>" + games + "</ul>" + excluded
    + '<table class="passes"><tr><th>Step</th><th>Model</th><th>Calls</th><th>Images</th></tr>' + passes + "</table>"
    + "<p>Estimated cost: <strong>" + money(p.estimate.usd[0]) + " to " + money(p.estimate.usd[1]) + "</strong> on Claude, plus about " + Math.round(p.estimate.gptTokens / 1000) + "k GPT tokens. Provisional.</p>"
    + (p.synthesisNeeded ? "<p class=\\"meta\\">Then: patterns across competitors, our game vs the patterns, recommendations, and the final report.</p>" : "")
    + blocked
    + (canRun ? '<button id="approve" class="primary">Approve and run</button> ' : "<p>Nothing to run: everything is analysed and reported.</p>") + '<button id="cancelApproval">Cancel</button>';
}

async function showApproval() {
  const stage = document.getElementById("stage").value;
  document.getElementById("approval").textContent = "Working out the numbers (no AI)...";
  try {
    const r = await apiPost("/api/analysis/plan", { stage });
    if (!r.ok) { document.getElementById("approval").textContent = (r.body.problems || ["Could not prepare the batch."]).join(" "); return; }
    shownPlan = r.body.plan;
    renderApproval(shownPlan);
  } catch { document.getElementById("approval").textContent = "The gallery server is not running. Start it with: npm run gallery"; }
}

async function approve() {
  if (!shownPlan) return;
  const r = await apiPost("/api/analysis/run", { stage: shownPlan.stage, planHash: shownPlan.planHash });
  if (!r.ok) { document.getElementById("approval").innerHTML = '<p class="warn">' + esc((r.body.problems || ["Not started."]).join(" ")) + "</p>"; return; }
  document.getElementById("approval").textContent = "";
  shownPlan = null;
  pollStatus();
}

function renderStatus() {
  const el = document.getElementById("status");
  const s = lastStatus;
  if (!s) { el.innerHTML = '<p class="meta">Checking the analysis status...</p>'; return; }
  const errs = (s.errors || []).slice(-8).map((e) => "<li>" + esc((e.name ? e.name + (e.position ? " #" + e.position : "") + ": " : "") + e.message) + "</li>").join("");
  const errBox = s.errors && s.errors.length ? '<details class="errs"' + (s.running ? "" : " open") + "><summary>" + s.errors.length + " problem" + (s.errors.length > 1 ? "s" : "") + "</summary><ul>" + errs + "</ul></details>" : "";
  let h;
  if (s.running) {
    const p = s.progress || { message: "Starting...", done: 0, total: 0 };
    h = '<p class="now"><span class="spin" aria-hidden="true"></span>' + esc(p.message) + "</p>"
      + '<p class="meta">' + p.done + " of " + p.total + " screenshots done &middot; elapsed " + elapsed(s.startedAt) + " &middot; spent " + money(s.spentUsd) + "</p>";
  } else if (s.startedAt) {
    h = (s.error ? '<p class="warn"><strong>' + esc(s.error) + "</strong></p>" : '<p class="ok"><strong>Finished.</strong></p>')
      + '<p class="meta">Last run: ' + esc(new Date(s.startedAt).toLocaleString()) + ", took " + elapsed(s.startedAt, s.finishedAt) + ", spent " + money(s.spentUsd) + ".</p>"
      + (s.synthesisSkipped ? '<p class="meta">Patterns and recommendations not written: ' + esc(s.synthesisSkipped) + "</p>" : "")
      + (s.report ? '<p class="meta">Report saved: ' + esc(s.report) + "</p>" : "");
  } else h = '<p class="meta">No analysis has run yet. Press Start analysis to see the numbers first.</p>';
  el.innerHTML = "<h2>Analysis status</h2>" + h + errBox;
}

async function refreshAnalyses() {
  try {
    const r = await (await fetch("/api/analyses")).json();
    INFO = r.info || {};
    DATA.info = INFO;
    for (const a of [...DATA.ours, ...DATA.named, ...DATA.chart]) for (const d of a.decks) for (const i of d.images) i.analysis = (i.imageId && r.captions[i.imageId]) || null;
    render();
  } catch {}
}

async function loadReport() {
  const box = document.getElementById("report");
  try {
    const stage = document.getElementById("stage").value;
    const r = await (await fetch("/api/report?stage=" + encodeURIComponent(stage))).json();
    if (!r.report) { box.innerHTML = ""; return; }
    box.innerHTML = '<details open><summary><strong>Final report</strong> (' + (stage === "pilot" ? "core pilot" : "core check") + ", run " + esc(r.report.runId) + ')</summary><p class="meta">Saved as ' + esc(r.report.file) + "</p>" + r.report.html + "</details>";
  } catch {}
}

async function loadOverview(rebuild) {
  const box = document.getElementById("overview");
  const button = '<p><button id="rebuildOverview">' + (rebuild ? "Building..." : "Rebuild the overview") + '</button> <span class="meta">Free: computed from the downloaded images, no AI.</span></p>';
  try {
    if (rebuild) box.querySelector("#rebuildOverview") && (box.querySelector("#rebuildOverview").disabled = true);
    const r = rebuild ? await apiPost("/api/overview", {}) : { ok: true, body: await (await fetch("/api/overview")).json() };
    if (!r.ok) { box.innerHTML = '<p class="warn">' + esc((r.body.problems || ["The overview could not be built."]).join(" ")) + "</p>" + button; return; }
    const o = r.body.overview;
    box.innerHTML = o
      ? '<details open><summary><strong>Store overview (free, no AI)</strong></summary><p class="meta">Saved as ' + esc(o.file) + "</p>" + o.html + button.replace("Building...", "Rebuild the overview") + "</details>"
      : '<details open><summary><strong>Store overview (free, no AI)</strong></summary><p>Not built yet.</p>' + button.replace("Rebuild the overview", "Build the overview") + "</details>";
  } catch {}
}

async function pollStatus() {
  clearTimeout(pollTimer);
  try {
    lastStatus = await (await fetch("/api/analysis/status")).json();
    renderStatus();
    if (lastStatus.running) { wasRunning = true; pollTimer = setTimeout(pollStatus, 1500); }
    else if (wasRunning) { wasRunning = false; refreshAnalyses(); loadReport(); }
  } catch {
    document.getElementById("status").innerHTML = '<h2>Analysis status</h2><p class="warn">The gallery server is not reachable. Start it with: npm run gallery</p>';
    pollTimer = setTimeout(pollStatus, 5000);
  }
}

setInterval(() => { if (lastStatus && lastStatus.running) renderStatus(); }, 1000);
document.addEventListener("click", (e) => {
  if (e.target.id === "startAnalysis") showApproval();
  if (e.target.id === "approve") { e.target.disabled = true; approve(); }
  if (e.target.id === "rebuildOverview") { e.target.disabled = true; e.target.textContent = "Building (about a minute the first time)..."; loadOverview(true); }
  if (e.target.id === "cancelApproval") { shownPlan = null; document.getElementById("approval").textContent = ""; }
});
document.addEventListener("change", (e) => { if (e.target.id === "stage") loadReport(); });
if (location.protocol.startsWith("http")) { pollStatus(); loadReport(); loadOverview(false); }
else document.getElementById("status").innerHTML = '<h2>Analysis status</h2><p class="meta">Open this page with npm run gallery to run and follow the analysis.</p>';
`;

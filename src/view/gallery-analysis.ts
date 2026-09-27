/**
 * In-page analysis gate. "Start analysis" opens a modal approval dialog with the numbers and
 * thumbnails of exactly the images in the batch (no AI). Only "Approve and run" starts model calls,
 * for exactly the batch shown; the dialog then turns into the run panel (see gallery-run.ts). The
 * page never reloads itself: new analyses and the final report are fetched and shown in place.
 */
export const ANALYSIS_SCRIPT = `
let shownPlan = null;

function money(n) { return "$" + Number(n || 0).toFixed(2); }
function elapsed(from, to) {
  if (!from) return "";
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
}

const TIER_WORDS = { full: "full analysis", "layer-diff": "text-layer diff", identical: "already analysed, no AI" };

function thumbOf(id) {
  for (const a of [...DATA.ours, ...DATA.named, ...DATA.chart]) for (const d of a.decks) for (const i of d.images) if (i.imageId === id && i.thumb) return i.thumb;
  return null;
}

function gameBlock(p, g) {
  const items = p.items.filter((it) => it.appId === g.appId).sort((x, y) => x.position - y.position);
  const newOnes = items.filter((it) => it.tier !== "identical").length;
  const out = p.excluded.filter((x) => x.name === g.name);
  const known = items.filter((it) => it.tier === "identical").map((it) => "#" + it.position);
  const figs = items.filter((it) => it.tier !== "identical").map((it) => {
    const t = thumbOf(it.imageId);
    return '<figure class="' + esc(it.tier) + '" title="Position ' + it.position + ": " + esc(TIER_WORDS[it.tier] || it.tier) + '">' + (t ? '<img src="' + IMG + esc(t) + '" alt="' + esc(g.name) + " position " + it.position + '">' : "") + "<figcaption>#" + it.position + "</figcaption></figure>";
  }).join("");
  return '<div class="agame"><strong>' + esc(g.name) + "</strong>: " + newOnes + " of " + (items.length + out.length) + " will be analysed"
    + (known.length ? ", already analysed (no AI): " + known.join(", ") : "")
    + (out.length ? '<span class="meta"> &middot; left out: ' + out.map((x) => "#" + x.position).join(", ") + " (" + esc([...new Set(out.map((x) => x.reason))].join("; ")) + ")</span>" : "")
    + '<div class="athumbs">' + (figs || '<span class="meta">No new images from this game.</span>') + "</div></div>";
}

function renderApproval(p) {
  const passes = p.estimate.passes.map((m) => "<tr><td>" + esc(m.role) + "</td><td>" + esc(m.model) + "</td><td>" + m.calls + "</td><td>" + m.images + "</td></tr>").join("");
  const blocked = !p.withinCap ? '<p class="warn">This batch would take the core above its cap. It cannot run.</p>' : "";
  const canRun = p.withinCap && (p.counts.newImages > 0 || p.synthesisNeeded);
  const box = document.getElementById("approval");
  box.innerHTML = '<h3 id="approvalTitle">Approve the ' + (p.stage === "pilot" ? "core pilot" : "core check") + "?</h3>"
    + '<p class="big">' + esc(p.market.label) + ". <strong>" + p.counts.newImages + " images will be sent to AI</strong> (full analysis: " + p.counts.full + ", text-layer diff: " + p.counts.layerDiff + "), from " + p.games.length + " games. Already analysed or identical (no AI): " + p.counts.identical + ". Left out: " + p.excluded.length + ". Core total after this batch: " + p.coreTotal + " of " + p.cap + ".</p>"
    + p.games.map((g) => gameBlock(p, g)).join("")
    + '<table class="passes"><tr><th>Step</th><th>Model</th><th>Calls</th><th>Images</th></tr>' + passes + "</table>"
    + '<p class="big">Estimated cost: <strong>' + money(p.estimate.usd[0]) + " to " + money(p.estimate.usd[1]) + "</strong> on Claude, plus about " + Math.round(p.estimate.gptTokens / 1000) + "k GPT tokens. Provisional.</p>"
    + (p.synthesisNeeded ? '<p class="meta">Then: patterns across competitors, our game vs the patterns, recommendations, and the final report.</p>' : "")
    + blocked
    + '<div class="actions">' + (canRun ? '<button id="approve" class="primary">Approve and run</button>' : "<p>Nothing to run: everything is analysed and reported.</p>") + '<button id="cancelApproval">Cancel</button></div>';
  box.scrollTop = 0;
  box.focus();
}

function approvalDialog(text) {
  const dlg = document.getElementById("approvalDlg");
  const box = document.getElementById("approval");
  if (text !== undefined) box.innerHTML = '<p class="big">' + esc(text) + '</p><div class="actions"><button id="cancelApproval">Close</button></div>';
  if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
  box.scrollIntoView({ block: "start" });
  box.focus();
}

function closeApproval() {
  shownPlan = null;
  const dlg = document.getElementById("approvalDlg");
  if (dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
  document.getElementById("approval").textContent = "";
}

async function showApproval() {
  const stage = document.getElementById("stage").value;
  approvalDialog("Working out the numbers (no AI)...");
  try {
    const r = await apiPost("/api/analysis/plan", { stage });
    if (!r.ok) { approvalDialog((r.body.problems || ["Could not prepare the batch."]).join(" ")); return; }
    shownPlan = r.body.plan;
    renderApproval(shownPlan);
  } catch { approvalDialog("The gallery server is not running. Start it with: npm run gallery"); }
}

async function approve() {
  if (!shownPlan) return;
  const r = await apiPost("/api/analysis/run", { stage: shownPlan.stage, planHash: shownPlan.planHash });
  if (!r.ok) { approvalDialog((r.body.problems || ["Not started."]).join(" ")); shownPlan = null; return; }
  shownPlan = null;
  showRunInDialog();
  await pollStatus();
}

async function refreshAnalyses() {
  try {
    const r = await (await fetch("/api/analyses")).json();
    INFO = r.info || {};
    DATA.info = INFO;
    for (const a of [...DATA.ours, ...DATA.named, ...DATA.chart]) for (const d of a.decks) for (const i of d.images) i.analysis = (i.imageId && r.captions[i.imageId]) || null;
    render();
    return r.captions;
  } catch { return null; }
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
      ? '<details class="sec"' + (rebuild ? " open" : "") + '><summary><span class="sec-t">Store overview (free, no AI)</span> <span class="meta">Click to expand or fold</span></summary><div class="sec-b"><p class="meta">Saved as ' + esc(o.file) + "</p>" + o.html + button.replace("Building...", "Rebuild the overview") + "</div></details>"
      : '<details class="sec"><summary><span class="sec-t">Store overview (free, no AI)</span> <span class="meta">Click to expand or fold</span></summary><div class="sec-b"><p>Not built yet.</p>' + button.replace("Rebuild the overview", "Build the overview") + "</div></details>";
  } catch {}
}

document.addEventListener("click", (e) => {
  if (e.target.id === "startAnalysis") showApproval();
  if (e.target.id === "approve") { e.target.disabled = true; approve(); }
  if (e.target.id === "rebuildOverview") { e.target.disabled = true; e.target.textContent = "Building (about a minute the first time)..."; loadOverview(true); }
  if (e.target.id === "cancelApproval") closeApproval();
});
document.addEventListener("change", (e) => { if (e.target.id === "stage") loadReport(); });
document.getElementById("approvalDlg").addEventListener("close", () => { shownPlan = null; if (runInDialog) goTo("analysis"); runInDialog = false; });
if (location.protocol.startsWith("http")) { pollStatus(); loadOverview(false); }
else document.getElementById("status").innerHTML = '<h2>Analysis status</h2><p class="meta">Open this page with npm run gallery to run and follow the analysis.</p>';
`;

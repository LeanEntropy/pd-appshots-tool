/**
 * In-page analysis gate. "Start analysis" opens a modal approval dialog with the numbers and
 * thumbnails of exactly the images in the batch (no AI). Only "Approve and run" starts model calls,
 * for exactly the batch shown; the dialog then turns into the run panel (see gallery-run.ts). The
 * page never reloads itself: new analyses and the final report are fetched and shown in place.
 */
export const ANALYSIS_SCRIPT = `
let shownPlan = null;
let shownFree = null;
let shownContinue = null;

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

// "Already analysed, free", split by who paid (another project's analysis is reused at $0).
function freeRow(f) {
  if (!f) return "";
  const other = f.others.reduce((n, o) => n + o.count, 0);
  const total = f.thisProject + other + f.sameInBatch;
  if (!total) return "";
  const parts = ["by this project: " + f.thisProject];
  for (const o of f.others) parts.push("by another project (" + esc(o.name) + "): " + o.count);
  if (f.sameInBatch) parts.push("repeated in this batch, analysed once: " + f.sameInBatch);
  return '<div class="freebox"><strong>Already analysed, free: ' + total + " images</strong> (" + parts.join("; ") + "). They count toward the core cap, not toward the cost.</div>";
}

function continueRow(c) {
  if (!c) return "";
  return '<div class="contbox"><strong>This continues the stopped batch.</strong> Already spent in this batch: <strong>' + money(c.spentUsd) + "</strong> of its " + money(c.limitUsd) + " spending limit, so the rest may spend up to <strong>" + money(c.leftUsd) + "</strong>."
    + (c.interrupted ? " " + c.interrupted + " image" + (c.interrupted > 1 ? "s were" : " was") + " being analysed when it stopped; that cost is unknown and counted at its estimate." : "")
    + " The image being analysed when it stopped is analysed again.</div>";
}

function renderApproval(p) {
  const passes = p.estimate.passes.map((m) => "<tr><td>" + esc(m.role) + "</td><td>" + esc(m.model) + "</td><td>" + m.calls + "</td><td>" + m.images + "</td></tr>").join("");
  const blocked = !p.withinCap ? '<p class="warn">This batch would take the core above its cap. It cannot run.</p>' : "";
  const canRun = p.withinCap && (p.counts.newImages > 0 || p.synthesisNeeded);
  const box = document.getElementById("approval");
  box.innerHTML = '<h3 id="approvalTitle">Approve the ' + (p.stage === "pilot" ? "core pilot" : "core check") + "?</h3>"
    + '<p class="big">' + esc(p.market.label) + ". <strong>" + p.counts.newImages + " images will be sent to AI</strong> (full analysis: " + p.counts.full + ", text-layer diff: " + p.counts.layerDiff + "), from " + p.games.length + " games. Already analysed or identical (no AI): " + p.counts.identical + ". Left out: " + p.excluded.length + ". Core total after this batch: " + p.coreTotal + " of " + p.cap + ".</p>"
    + freeRow(shownFree) + continueRow(shownContinue)
    + p.games.map((g) => gameBlock(p, g)).join("")
    + '<table class="passes"><tr><th>Step</th><th>Model</th><th>Calls</th><th>Images</th></tr>' + passes + "</table>"
    + '<p class="big">Estimated cost: <strong>' + money(p.estimate.usd[0]) + " to " + money(p.estimate.usd[1]) + "</strong> on Claude, plus about " + Math.round(p.estimate.gptTokens / 1000) + "k GPT tokens. Provisional.</p>"
    + (p.synthesisNeeded ? '<p class="meta">Then: patterns across competitors, our game vs the patterns, recommendations, the A/B tests to run next, and the final report.</p>' : "")
    + blocked
    + '<div class="actions">' + (canRun ? '<button id="approve" class="primary">Approve and run</button>' : "<p>Nothing to run: everything is analysed and reported.</p>") + '<button id="cancelApproval">Cancel</button></div>';
  box.scrollTop = 0;
  box.focus();
}

function approvalDialog(text, kind) {
  const dlg = document.getElementById("approvalDlg");
  const box = document.getElementById("approval");
  if (text !== undefined) box.innerHTML = '<p class="big act-msg ' + (kind || "") + '"' + (kind === "bad" ? ' role="alert"' : "") + ">" + (kind === "busy" ? ACT_SPIN() : "") + esc(text) + '</p><div class="actions"><button id="cancelApproval">Close</button></div>';
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

async function showApproval(cont) {
  const stage = cont ? cont.stage : document.getElementById("stage").value;
  approvalDialog("Working out the numbers (no AI)... this takes a few seconds", "busy");
  try {
    const r = await send(API + "/analysis/plan", cont ? { stage, continueBatch: cont.batchId } : { stage });
    shownPlan = r.plan;
    shownFree = r.free || null;
    shownContinue = r.continuing || null;
    renderApproval(shownPlan);
  } catch (e) { approvalDialog("The numbers could not be worked out: " + actReason(e), "bad"); }
}

// Errors are shown in the dialog itself (a message behind the modal would not be seen).
async function approve() {
  if (!shownPlan) return;
  const body = { stage: shownPlan.stage, planHash: shownPlan.planHash };
  if (shownContinue) body.continueBatch = shownContinue.batchId;
  try { await send(API + "/analysis/run", body); }
  catch (e) { approvalDialog("The run did not start: " + actReason(e), "bad"); shownPlan = null; return; }
  shownPlan = null;
  showRunInDialog();
  await pollStatus();
}

// Start analysis, Continue, and the report's "Open the approval" all open the approval this way.
function openApproval(btn, cont) {
  return act(btn, { key: cont ? "continueRun" : "startAnalysis", busy: "Working out the numbers...", run: () => showApproval(cont) });
}

async function refreshAnalyses() {
  try {
    const r = await (await fetch(API + "/analyses")).json();
    INFO = r.info || {};
    DATA.info = INFO;
    for (const a of [...DATA.ours, ...DATA.named, ...DATA.chart]) for (const d of a.decks) for (const i of d.images) i.analysis = (i.imageId && r.captions[i.imageId]) || null;
    render();
    return r.captions;
  } catch { return null; }
}

// Loads (or, with rebuild, builds) the overview. A failed build throws, so its button says why.
async function loadOverview(rebuild) {
  const box = document.getElementById("overview");
  const button = (label) => '<p><button id="rebuildOverview">' + label + '</button> <span class="meta">Free: computed from the downloaded images, no AI.</span></p><p id="overviewStatus" class="act-msg" hidden></p>';
  let o;
  try { o = rebuild ? (await send(API + "/overview", {})).overview : (await getJson(API + "/overview")).overview; }
  catch (e) {
    if (rebuild) throw e;
    box.innerHTML = '<p class="act-msg bad" role="alert">The overview could not be loaded: ' + esc(actReason(e)) + "</p>" + button("Build the overview");
    return;
  }
  box.innerHTML = o
    ? '<details class="sec"' + (rebuild ? " open" : "") + '><summary><span class="sec-t">Store overview (free, no AI)</span> <span class="meta">Click to expand or fold</span></summary><div class="sec-b"><p class="meta">Saved as ' + esc(o.file) + "</p>" + o.html + button("Rebuild the overview") + "</div></details>"
    : '<details class="sec"><summary><span class="sec-t">Store overview (free, no AI)</span> <span class="meta">Click to expand or fold</span></summary><div class="sec-b"><p>Not built yet.</p>' + button("Build the overview") + "</div></details>";
}

document.addEventListener("click", (e) => {
  if (e.target.id === "startAnalysis") openApproval(e.target, null);
  if (e.target.id === "continueRun" && lastStatus && lastStatus.ledger) openApproval(e.target, { stage: lastStatus.stage, batchId: lastStatus.ledger.batchId });
  if (e.target.id === "approve") act(e.target, { busy: "Starting the run...", keep: true, run: approve });
  if (e.target.id === "rebuildOverview") act(e.target, { busy: "Building the overview (about a minute the first time)...", status: "overviewStatus", run: () => loadOverview(true), done: "The store overview is up to date." });
  if (e.target.id === "cancelApproval") closeApproval();
});
document.addEventListener("change", (e) => { if (e.target.id === "stage") loadReport(); });
// Past the pilot, the page opens on the core check batch.
if (["core", "recommendations", "expand"].includes(APP.stage)) document.getElementById("stage").value = "core";
document.getElementById("approvalDlg").addEventListener("close", () => { shownPlan = null; if (runInDialog) goTo("analysis"); runInDialog = false; });
if (location.protocol.startsWith("http")) { pollStatus(); document.getElementById("overview").innerHTML = '<p class="act-msg busy">' + ACT_SPIN() + "Loading the store overview...</p>"; loadOverview(false); }
else document.getElementById("status").innerHTML = '<h2>Analysis status</h2><p class="meta">Open this page with npm start to run and follow the analysis.</p>';
`;

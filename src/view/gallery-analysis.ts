/**
 * In-page analysis gate. "Start analysis" asks the local server for the approval numbers
 * (no AI). Only "Approve and run" starts model calls, for exactly the batch that was shown.
 */
export const ANALYSIS_SCRIPT = `
let shownPlan = null;
let pollTimer = null;

function money(n) { return "$" + Number(n).toFixed(2); }

function renderApproval(p) {
  const games = p.games.map((g) => "<li>" + esc(g.name) + ": positions " + (g.positions.join(", ") || "none") + "</li>").join("");
  const passes = p.estimate.passes.map((m) => "<tr><td>" + esc(m.role) + "</td><td>" + esc(m.model) + "</td><td>" + m.calls + "</td><td>" + m.images + "</td></tr>").join("");
  const excluded = p.excluded.length ? "<p class=\\"meta\\">Left out (shown raw, not analysed): " + p.excluded.length + " screenshots, e.g. " + esc(p.excluded[0].name + " position " + p.excluded[0].position + ": " + p.excluded[0].reason) + "</p>" : "";
  const blocked = !p.withinCap ? "<p class=\\"warn\\">This batch would take the core above its cap. It cannot run.</p>" : "";
  document.getElementById("approval").innerHTML = "<h3>" + (p.stage === "pilot" ? "Core pilot" : "Core check") + ": approval</h3>"
    + "<p>" + esc(p.market.label) + ". Full analysis: <strong>" + p.counts.full + "</strong>, marketing-layer diff: " + p.counts.layerDiff + ", identical (no AI): " + p.counts.identical + ". Core total after this batch: " + p.coreTotal + " of " + p.cap + ".</p>"
    + "<ul>" + games + "</ul>" + excluded
    + '<table class="passes"><tr><th>Step</th><th>Model</th><th>Calls</th><th>Images</th></tr>' + passes + "</table>"
    + "<p>Estimated cost: <strong>" + money(p.estimate.usd[0]) + " to " + money(p.estimate.usd[1]) + "</strong> on Claude, plus about " + Math.round(p.estimate.gptTokens / 1000) + "k GPT tokens. Provisional.</p>"
    + blocked
    + (p.withinCap && p.counts.newImages > 0 ? '<button id="approve" class="primary">Approve and run</button> ' : "") + '<button id="cancelApproval">Cancel</button>';
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
  if (!r.ok) { document.getElementById("approval").textContent = (r.body.problems || ["Not started."]).join(" "); return; }
  document.getElementById("approval").textContent = "Started.";
  pollStatus();
}

async function pollStatus() {
  clearTimeout(pollTimer);
  try {
    const res = await fetch("/api/analysis/status");
    const s = await res.json();
    const el = document.getElementById("approval");
    if (s.running) {
      const p = s.progress;
      el.textContent = p ? p.message + " (" + p.done + " of " + p.total + " screenshots, spent " + money(p.spentUsd) + ")" : "Starting...";
      pollTimer = setTimeout(pollStatus, 2000);
    } else if (s.error) el.textContent = "Stopped with a problem: " + s.error;
    else if (s.report) { el.textContent = "Finished. Report: " + s.report + ". Reloading the grid..."; setTimeout(() => location.reload(), 1500); }
  } catch {}
}

document.addEventListener("click", (e) => {
  if (e.target.id === "startAnalysis") showApproval();
  if (e.target.id === "approve") { e.target.disabled = true; approve(); }
  if (e.target.id === "cancelApproval") { shownPlan = null; document.getElementById("approval").textContent = ""; }
});
`;

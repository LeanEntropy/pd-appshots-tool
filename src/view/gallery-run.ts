/**
 * Live run panel. While a batch runs, the status box (and the approval dialog, which turns into
 * the run panel after "Approve and run") shows the current image and step, a progress bar,
 * elapsed and remaining time, cost against the estimate, every image of the batch with its state,
 * and errors in red. A sticky bar at the top of the page follows the run wherever the user
 * scrolls. The server keeps the status on disk, so a reload or restart shows the same panel.
 * Finished images get their caption and (i) in the grid as soon as they are saved.
 */
export const RUN_SCRIPT = `
let pollTimer = null;
let lastStatus = null;
let wasRunning = false;
let runInDialog = false;
let doneSeen = -1;
let savedIds = new Set();
let runbarClosed = false;

const STEP_WORDS = { start: "starting", analysis: "reading the image (first analysis)", review: "checking (second opinion)", settle: "settling a disagreement between the two models", patterns: "finding patterns across games", recommend: "writing recommendations", "recommend-review": "checking the recommendations", "recommend-revise": "revising the recommendations", report: "writing the report" };

function money(n) { return "$" + Number(n || 0).toFixed(2); }
function secs(from, to) { return from ? Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000)) : 0; }
function mins(s) { return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s"; }
function elapsed(from, to) { return from ? mins(secs(from, to)) : ""; }

// State of one batch image: done (analysis saved), failed (an error names it), current (named in
// the progress message), or queued.
function runState(it) {
  const s = lastStatus;
  if (!s) return "queued";
  if ((s.errors || []).some((e) => e.name === it.name && e.position === it.position)) return "failed";
  if (savedIds.has(it.imageId)) return "done";
  return isCurrent(it) ? "current" : "queued";
}

// True when the progress message names this image ("Checking Rogue Legend #4, #5 ...").
function isCurrent(it) {
  const s = lastStatus;
  const m = (s && s.running && s.progress && s.progress.message) || "";
  const at = m.indexOf(it.name + " #");
  return at >= 0 && !/: saved$/.test(m) && new RegExp("#" + it.position + "(?!\\\\d)").test(m.slice(at));
}

// Used by the grid: marks images of the running batch live.
function runMark(imageId) {
  const s = lastStatus;
  if (!s || !s.batch) return "";
  const it = s.batch.items.find((x) => x.imageId === imageId);
  if (!it) return "";
  const st = runState(it);
  return st === "failed" || (s.running && st === "current") ? st : "";
}

function imageLine(p) {
  if (!p.total) return "no new images; " + esc(STEP_WORDS[p.phase] || p.phase);
  return p.done >= p.total ? "all " + p.total + " images done, " + esc(STEP_WORDS[p.phase] || p.phase) : "image " + (p.done + 1) + " of " + p.total;
}

function remaining(s) {
  const p = s.progress; const t = secs(s.startedAt);
  if (!p || !p.total || p.done < 1) return "worked out after the first image";
  if (p.done >= p.total) return "images done; writing the patterns and the report";
  return "about " + mins(Math.round((t / p.done) * (p.total - p.done)));
}

function runPanelHtml(s) {
  const p = s.progress || { phase: "start", message: "Starting...", done: 0, total: 0 };
  const items = (s.batch && s.batch.items) || [];
  const est = s.batch && s.batch.estimateUsd ? " of an estimated " + money(s.batch.estimateUsd[0]) + " to " + money(s.batch.estimateUsd[1]) : "";
  const cur = items.filter(isCurrent).map((it) => it.name + " #" + it.position);
  const list = items.map((it) => { const st = runState(it); return '<li class="' + st + '">' + esc(it.name + " #" + it.position) + ' <span class="st">' + { done: "ok", failed: "failed", current: "in progress", queued: "waiting" }[st] + "</span></li>"; }).join("");
  const errs = (s.errors || []).map((e) => "<li>" + esc((e.name ? e.name + (e.position ? " #" + e.position : "") + ": " : "") + e.message) + "</li>").join("");
  let head;
  if (s.running) head = '<h2><span class="spin" aria-hidden="true"></span>Running: ' + imageLine(p) + (cur.length ? " &mdash; " + esc(cur.join(", ")) : "") + "</h2>"
    + '<p class="now">Step: ' + esc(STEP_WORDS[p.phase] || p.phase) + '</p><p class="meta">' + esc(p.message) + "</p>";
  else if (!s.finishedAt) head = '<h2 class="warn">Interrupted</h2><p class="warn"><strong>The gallery server stopped during this run.</strong> Finished images are kept; press Start analysis to run the rest.</p>';
  else head = (s.error ? '<h2 class="warn">Stopped</h2><p class="warn"><strong>' + esc(s.error) + "</strong></p>" : '<h2 class="ok">Finished</h2>')
    + '<p class="meta">Run of ' + esc(new Date(s.startedAt).toLocaleString()) + ".</p>"
    + (s.synthesisSkipped ? '<p class="meta">Patterns and recommendations not written: ' + esc(s.synthesisSkipped) + "</p>" : "")
    + (s.report ? '<p><a href="#report" class="toreport">Show the final report</a> <span class="meta">(saved as ' + esc(s.report) + ")</span></p>" : "");
  return head
    + '<progress max="' + (p.total || 1) + '" value="' + p.done + '"></progress><p>' + p.done + " of " + p.total + " images done</p>"
    + (s.running || s.finishedAt ? '<p>Elapsed: <span class="rt-elapsed">' + elapsed(s.startedAt, s.running ? null : s.finishedAt) + "</span>" : "<p>") + (s.running ? ' &middot; Remaining: <span class="rt-left">' + remaining(s) + "</span>" : "") + "</p>"
    + "<p>Cost so far: <strong>" + money(s.spentUsd) + "</strong>" + est + "</p>"
    + (errs ? '<div class="errs"><strong>' + (s.errors.length) + " problem" + (s.errors.length > 1 ? "s" : "") + '</strong><ul class="warn">' + errs + "</ul></div>" : "")
    + (list ? '<details class="runlist"' + (s.running ? " open" : "") + "><summary>Images in this batch</summary><ol>" + list + "</ol></details>" : "");
}

function renderRunbar(s) {
  const bar = document.getElementById("runbar");
  if (!bar) return;
  const show = s && (s.running || (wasRunning === "ended" && !runbarClosed));
  bar.hidden = !show;
  if (!show) return;
  const p = s.progress || { done: 0, total: 0 };
  bar.className = s.running ? "" : s.error ? "stopped" : "finished";
  bar.innerHTML = (s.running ? '<span class="spin" aria-hidden="true"></span>Running: ' + imageLine(p) + ' &middot; <span class="rt-elapsed">' + elapsed(s.startedAt) + "</span> &middot; " + money(s.spentUsd) : (s.error ? "Stopped: " + esc(s.error) : "Finished") + (s.report ? ' &middot; <a href="#report" class="toreport">Show the report</a>' : ""))
    + ' <button type="button" id="runbarDetails">Details</button>' + (s.running ? "" : ' <button type="button" id="runbarClose" aria-label="Hide this bar">Hide</button>');
}

function renderStatus() {
  const el = document.getElementById("status");
  const s = lastStatus;
  el.classList.toggle("running", !!(s && s.running));
  const start = document.getElementById("startAnalysis");
  if (start) start.disabled = !!(s && s.running);
  renderRunbar(s);
  if (!s) { el.innerHTML = '<p class="meta">Checking the analysis status...</p>'; return; }
  const h = s.startedAt ? runPanelHtml(s) : '<h2>Analysis status</h2><p class="meta">No analysis has run yet. Press Start analysis to see the numbers first.</p>';
  el.innerHTML = h;
  const box = document.getElementById("approval");
  const panel = runInDialog && box && box.querySelector(".runpanel");
  if (panel) panel.innerHTML = h;
}

function tick() {
  const s = lastStatus;
  if (!s || !s.running) return;
  document.querySelectorAll(".rt-elapsed").forEach((x) => { x.textContent = elapsed(s.startedAt); });
  document.querySelectorAll(".rt-left").forEach((x) => { x.textContent = remaining(s); });
}

// After "Approve and run": the approval dialog turns into the run panel in place.
function showRunInDialog() {
  runInDialog = true;
  const box = document.getElementById("approval");
  box.innerHTML = '<div class="runpanel"><h2><span class="spin" aria-hidden="true"></span>Starting the run...</h2></div><div class="actions"><button type="button" id="cancelApproval">Close this panel (the run continues)</button></div>';
  approvalDialog();
}

async function pollStatus() {
  clearTimeout(pollTimer);
  try {
    lastStatus = await (await fetch("/api/analysis/status")).json();
    const done = lastStatus.progress ? lastStatus.progress.done : 0;
    if (doneSeen === -1 || (lastStatus.running && done !== doneSeen)) {
      doneSeen = done;
      const caps = await refreshAnalyses();
      if (caps) savedIds = new Set(Object.keys(caps));
    }
    // While a run is active, the grid and report follow the running batch.
    const stageSel = document.getElementById("stage");
    if (lastStatus.running && stageSel && lastStatus.stage && stageSel.value !== lastStatus.stage) { stageSel.value = lastStatus.stage; loadReport(); }
    if (lastStatus.running) { wasRunning = true; pollTimer = setTimeout(pollStatus, 1500); }
    else if (wasRunning === true) {
      wasRunning = "ended";
      const caps = await refreshAnalyses();
      if (caps) savedIds = new Set(Object.keys(caps));
      const st = document.getElementById("stage");
      if (st && lastStatus.stage) st.value = lastStatus.stage;
      loadReport();
    }
    renderStatus();
    renderGrid();
  } catch {
    document.getElementById("status").innerHTML = '<h2>Analysis status</h2><p class="warn">The gallery server is not reachable. Start it with: npm run gallery</p>';
    pollTimer = setTimeout(pollStatus, 5000);
  }
}

setInterval(tick, 1000);
document.addEventListener("click", (e) => {
  if (e.target.id === "runbarDetails") { const st = document.getElementById("status"); st.scrollIntoView({ block: "center" }); st.focus(); }
  if (e.target.id === "runbarClose") { runbarClosed = true; renderRunbar(lastStatus); }
  if (e.target.classList && e.target.classList.contains("toreport") && runInDialog) closeApproval();
});
`;

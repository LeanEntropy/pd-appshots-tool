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
// The run whose Stop was pressed: its Stop buttons stay busy until it has ended.
let stopAsked = null;

// The words of Stop follow the phase: the images (several run at once), or one step after them.
// A run without a step list (Pilot, Full check) finishes its written parts before it stops.
function stopWords(s) {
  const text = !!s && inText(s);
  if (!text) return { label: "Stop after the running images", busy: "Stopping after the running images...", done: "Stopping: the run ends after the images in progress. Finished images are kept." };
  if ((s.steps || []).length) return { label: "Stop after this step", busy: "Stopping after this step...", done: "Stopping: the run ends after the step in progress. Finished work is kept." };
  return { label: "Stop", busy: "Stopping...", done: "Stopping: the patterns and recommendations in progress finish first. Finished images are kept." };
}

function stopButton(short) {
  const s = lastStatus;
  const asked = s && stopAsked === s.startedAt;
  const w = stopWords(s);
  return '<button type="button" class="stopbtn" data-stop="1" data-act-key="stop"' + (asked ? ' disabled aria-busy="true">' + ACT_SPIN() + w.busy : ">" + (short ? "Stop" : w.label)) + "</button>";
}

// True once the run is past its images (a step after them has started, or every image is done).
function inText(s) {
  const p = s.progress || {};
  return (s.steps || []).some((x) => x.state !== "waiting") || (p.total > 0 && p.done >= p.total) || (!p.total && p.phase !== "start");
}

const STEP_WORDS = { text: "starting the written parts", "layer-diff": "comparing the text on the images", "concept-map": "grouping the words used", "country-advice": "writing the advice per country", "ab-tests": "writing the A/B tests", start: "starting", analysis: "reading the image (first analysis)", review: "checking (second opinion)", settle: "settling a disagreement between the two models", patterns: "finding patterns across games", recommend: "writing recommendations", "recommend-review": "checking the recommendations", "recommend-revise": "revising the recommendations", report: "writing the report" };

function money(n) { return "$" + Number(n || 0).toFixed(2); }
function secs(from, to) { return from ? Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000)) : 0; }
function mins(s) { return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s"; }
function elapsed(from, to) { return from ? mins(secs(from, to)) : ""; }
function dur(s) { return s < 60 ? s + " s" : mins(s); }

// How an image ended, from the job (text compared, reused, skipped ... with the reason).
const OUT_WORDS = { running: "in progress", ok: "analysed", text: "text compared", reused: "reused, free", different: "different screen", skipped: "skipped", failed: "failed" };
const OUT_CLASS = { running: "current", ok: "done", text: "done", reused: "done", different: "info", skipped: "info", failed: "failed" };
function outcomeOf(it) { const o = lastStatus && lastStatus.outcomes; return (o && o[it.imageId]) || null; }
function tracked(s) { return Object.keys(s.outcomes || {}).length > 0 || (s.steps || []).length > 0; }

// State of one batch image: its outcome saved by the job when there is one; a job that keeps
// outcomes has not reached an image without one. Older jobs: done (analysis saved), failed (an
// error names it), current (named in the progress message), or queued.
function runState(it) {
  const s = lastStatus;
  if (!s) return "queued";
  const o = outcomeOf(it);
  if (o) return o.state === "running" ? (s.running ? "current" : "stopped") : OUT_CLASS[o.state];
  if (tracked(s)) return s.running ? "queued" : "stopped";
  if ((s.errors || []).some((e) => e.name === it.name && e.position === it.position)) return "failed";
  if (savedIds.has(it.imageId) || (!s.running && s.state === "finished")) return "done";
  return isCurrent(it) ? "current" : "queued";
}

function runWord(it, st) {
  const o = outcomeOf(it);
  if (o && o.state !== "running") return esc(OUT_WORDS[o.state] + (o.note ? ": " + o.note : ""));
  return { done: "ok", failed: "failed", current: "in progress", queued: "waiting", stopped: "not done (the run ended first)", info: "" }[st];
}

// The steps after the images, each waiting, running, done, failed or skipped, with time and cost.
function stepsHtml(s) {
  const steps = s.steps || [];
  if (!steps.length) return "";
  const ended = steps.filter((x) => x.state === "done" || x.state === "failed" || x.state === "skipped").length;
  const rows = steps.map((x) => {
    const st = x.state === "running" && !s.running ? "stopped" : x.state;
    const cls = { waiting: "queued", running: "current", done: "done", failed: "failed", skipped: "info", stopped: "info" }[st];
    const word = { waiting: "waiting", running: "running", done: "done", failed: "failed", skipped: "skipped", stopped: "not finished" }[st];
    const time = st === "running" ? '<span class="rt-step" data-from="' + esc(x.startedAt || "") + '">' + dur(secs(x.startedAt)) + "</span>" : x.startedAt && x.endedAt ? dur(secs(x.startedAt, x.endedAt)) : "";
    const meta = [time, x.usd != null && (st === "done" || st === "failed") ? money(x.usd) : ""].filter(Boolean).join(", ");
    return '<li class="' + cls + '">' + (st === "running" && s.running ? spinHtml("spin") : "") + esc(x.label) + ' <span class="st">' + word + (meta ? " &middot; " + meta : "") + "</span>" + (x.note ? ' <span class="note">' + esc(x.note) + "</span>" : "") + "</li>";
  }).join("");
  return '<details class="runlist runsteps" open><summary>After the images: ' + ended + " of " + steps.length + " steps done</summary><ol>" + rows + "</ol></details>";
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

// What runs now: the running step after the images, else the phase in plain words.
function nowWords(s) {
  const r = (s.steps || []).find((x) => x.state === "running");
  const p = s.progress || {};
  return r ? r.label : STEP_WORDS[p.phase] || p.phase || "";
}

function imageLine(s) {
  const p = s.progress || { done: 0, total: 0 };
  const steps = s.steps || [];
  const at = steps.findIndex((x) => x.state === "running");
  const what = at >= 0 ? "step " + (at + 1) + " of " + steps.length + ": " + nowWords(s) : nowWords(s);
  if (!p.total) return "no new images; " + esc(what);
  return p.done >= p.total ? "all " + p.total + " images done; " + esc(what) : "image " + Math.min(p.done + 1, p.total) + " of " + p.total;
}

function remaining(s) {
  const p = s.progress; const t = secs(s.startedAt);
  const steps = s.steps || [];
  if (p && p.total && p.done < p.total) {
    if (p.done < 1) return "worked out after the first image";
    return "about " + mins(Math.round((t / p.done) * (p.total - p.done))) + " for the images" + (steps.length ? ", then " + steps.length + " steps" : "");
  }
  if (!steps.length) return "images done; writing the patterns and the report";
  const left = steps.filter((x) => x.state === "waiting" || x.state === "running").length;
  const took = steps.filter((x) => (x.state === "done" || x.state === "failed") && x.startedAt && x.endedAt).map((x) => secs(x.startedAt, x.endedAt));
  if (!left) return "finishing";
  const est = took.length ? ", about " + mins(Math.round((took.reduce((a, b) => a + b, 0) / took.length) * left)) : "";
  return "images done; " + left + " of " + steps.length + " steps left" + est;
}

function runPanelHtml(s) {
  const p = s.progress || { phase: "start", message: "Starting...", done: 0, total: 0 };
  const items = (s.batch && s.batch.items) || [];
  const est = s.batch && s.batch.estimateUsd ? " of an estimated " + money(s.batch.estimateUsd[0]) + " to " + money(s.batch.estimateUsd[1]) : "";
  const cur = items.filter((it) => runState(it) === "current").map((it) => it.name + " #" + it.position);
  const list = items.map((it) => { const st = runState(it); return '<li class="' + st + '">' + esc(it.name + " #" + it.position) + ' <span class="st">' + runWord(it, st) + "</span></li>"; }).join("");
  const counts = {}; for (const it of items) { const st = runState(it); counts[st] = (counts[st] || 0) + 1; }
  const tally = ["done", "current", "info", "failed", "queued", "stopped"].filter((k) => counts[k]).map((k) => counts[k] + " " + { done: "done", current: "in progress", info: "skipped or different", failed: "failed", queued: "waiting", stopped: "not done" }[k]).join(", ");
  const errs = (s.errors || []).map((e) => "<li>" + esc((e.name ? e.name + (e.position ? " #" + e.position : "") + ": " : "") + e.message) + "</li>").join("");
  let head;
  const what = s.reportName ? " \u201c" + esc(s.reportName) + "\u201d" : "";
  if (s.running) head = '<h2>' + spinHtml("spin") + 'Running' + what + ': ' + imageLine(s) + (cur.length ? " &mdash; " + esc(cur.join(", ")) : "") + "</h2>"
    + '<p class="now">Step: ' + esc(nowWords(s)) + '</p><p class="meta">' + esc(p.message) + "</p>"
    + (s.stoppable ? '<p>' + stopButton() + ' <span class="meta">Finished work is kept; you can continue later.</span></p>' : "");
  else if (!s.finishedAt) head = '<h2 class="warn">Interrupted</h2><p class="warn"><strong>The tool stopped during this run.</strong> Finished images are kept.</p>' + continueBox(s);
  else head = (s.error ? '<h2 class="warn">Stopped</h2><p class="warn"><strong>' + esc(s.error) + "</strong></p>" : '<h2 class="ok">Finished</h2>')
    + '<p class="meta">Run of ' + esc(new Date(s.startedAt).toLocaleString()) + ".</p>"
    + (s.synthesisSkipped ? '<p class="meta">Patterns and recommendations not written: ' + esc(s.synthesisSkipped) + "</p>" : "")
    + (s.error ? continueBox(s) : "")
    + (s.report ? '<p><a href="#report' + (s.reportId ? "/" + esc(s.reportId) : "") + '" class="toreport">Show the ' + (s.reportId ? "report" : "final report") + '</a> <span class="meta">(saved as ' + esc(s.report) + ")</span></p>" : "");
  return head
    + '<progress max="' + (p.total || 1) + '" value="' + p.done + '"></progress><p>' + p.done + " of " + p.total + " images done</p>"
    + (s.running || s.finishedAt ? '<p>Elapsed: <span class="rt-elapsed">' + elapsed(s.startedAt, s.running ? null : s.finishedAt) + "</span>" : "<p>") + (s.running ? ' &middot; Remaining: <span class="rt-left">' + remaining(s) + "</span>" : "") + "</p>"
    + "<p>Cost so far: <strong>" + money(s.spentUsd) + "</strong>" + est + "</p>"
    + (s.ledger ? '<p class="meta">This batch across all its runs: ' + money(s.ledger.spentUsd) + " of its " + money(s.ledger.limitUsd) + " spending limit.</p>" : "")
    + (errs ? '<div class="errs"><strong>' + (s.errors.length) + " problem" + (s.errors.length > 1 ? "s" : "") + '</strong><ul class="warn">' + errs + "</ul></div>" : "")
    + stepsHtml(s)
    + (list ? '<details class="runlist"' + (s.running && !inText(s) ? " open" : "") + "><summary>Images in this batch" + (tally ? ": " + tally : "") + "</summary><ol>" + list + "</ol></details>" : "");
}

// "Analysis stopped at image 9 of 17. [Continue: 8 images left, about $1.60]"
function continueBox(s) {
  const c = s.continuable;
  if (!c) return "";
  const p = s.progress || { done: 0, total: 0 };
  return '<div class="contbox"><p><strong>Analysis stopped at image ' + Math.min(p.done + 1, p.total || 1) + " of " + (p.total || "?") + ".</strong> Already spent in this batch: " + money(s.ledger ? s.ledger.spentUsd : 0) + " of its " + money(s.ledger ? s.ledger.limitUsd : 0) + " limit.</p>"
    + '<button type="button" class="primary" id="continueRun">Continue: ' + c.remaining + " image" + (c.remaining === 1 ? "" : "s") + " left, about " + money(c.estimateUsd[0]) + (c.estimateUsd[1] !== c.estimateUsd[0] ? " to " + money(c.estimateUsd[1]) : "") + "</button>"
    + '<p class="meta">Opens the approval with the remaining numbers first. Nothing is sent to AI until you approve.</p></div>';
}

function renderRunbar(s) {
  const bar = document.getElementById("runbar");
  if (!bar) return;
  const show = s && (s.running || (wasRunning === "ended" && !runbarClosed));
  bar.hidden = !show;
  if (!show) return;
  const p = s.progress || { done: 0, total: 0 };
  bar.className = s.running ? "" : s.error ? "stopped" : "finished";
  bar.innerHTML = (s.running ? spinHtml("spin") + 'Running: ' + imageLine(s) + ' &middot; <span class="rt-elapsed">' + elapsed(s.startedAt) + "</span> &middot; " + money(s.spentUsd) + (s.stoppable ? " " + stopButton(true) : "") : (s.error ? "Stopped: " + esc(s.error) : "Finished") + (s.report ? ' &middot; <a href="#report" class="toreport">Show the report</a>' : ""))
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
  const other = s.otherAi ? '<p class="warn"><strong>' + esc(s.otherAi) + "</strong></p>" : "";
  const h = other + (s.startedAt ? runPanelHtml(s) : '<h2>Analysis status</h2><p class="meta">No analysis has run yet. Press Start analysis to see the numbers first.</p>');
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
  document.querySelectorAll(".rt-step").forEach((x) => { x.textContent = dur(secs(x.dataset.from)); });
}

// After "Approve and run": the approval dialog turns into the run panel in place.
function showRunInDialog() {
  runInDialog = true;
  const box = document.getElementById("approval");
  box.innerHTML = '<div class="runpanel"><h2>' + spinHtml("spin") + 'Starting the run...</h2></div><div class="actions"><button type="button" id="cancelApproval">Close this panel (the run continues)</button></div>';
  approvalDialog();
}

async function pollStatus() {
  clearTimeout(pollTimer);
  try {
    lastStatus = await getJson(API + "/analysis/status");
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
    document.getElementById("status").innerHTML = '<h2>Analysis status</h2><p class="warn">The gallery server is not reachable. Start it with: npm start</p>';
    pollTimer = setTimeout(pollStatus, 5000);
  }
}

setInterval(tick, 1000);
document.addEventListener("click", (e) => {
  if (e.target.id === "runbarDetails") { goTo("analysis"); const st = document.getElementById("status"); st.focus(); }
  if (e.target.id === "runbarClose") { runbarClosed = true; renderRunbar(lastStatus); }
  const stop = e.target.closest && e.target.closest("button[data-stop]");
  const w = stop && stopWords(lastStatus);
  if (stop) act(stop, { key: "stop", busy: w.busy, keep: true, run: async () => { const at = lastStatus && lastStatus.startedAt; await send(API + "/analysis/stop", {}); stopAsked = at; await pollStatus(); }, done: w.done });
  if (e.target.classList && e.target.classList.contains("toreport") && runInDialog) closeApproval();
});
`;

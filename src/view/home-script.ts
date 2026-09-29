/**
 * Projects home script: cards from the registry's cached summaries at once, then each card's
 * fresh state; the "Working now" strip polls /api/jobs (every 2 s while something runs); the
 * Import offer for a project made before the shared library (runs only when pressed).
 */
import { ACTION_SCRIPT } from "./action.ts";

export const HOME_SCRIPT = `${ACTION_SCRIPT}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LABEL = { setup: "Setting up", preview: "Ready to download", pick: "Pick competitors", pilot: "Pilot", core: "Core check", recommendations: "Recommendations ready", expand: "Expansions" };
let projects = [];
const states = {};
let jobTimer = null;
// The first poll finds no jobs: the states loadProjects() asks for are enough (each costs the tool seconds).
let lastLanes = "[]";
const shown = {};

function card(p) {
  const s = states[p.id];
  const stage = s ? s.stage : p.summary ? p.summary.stage : "setup";
  const sub = s && s.substate ? s.substate : "";
  const line = s ? s.line : p.summary ? p.summary.line : "Checking...";
  const pill = (LABEL[stage] || stage) + (sub === "running" ? " \\u00b7 running" : sub === "stopped" || sub === "failed" ? " \\u00b7 stopped" : "");
  const prog = s && s.progress ? '<progress max="' + (s.progress.total || 1) + '" value="' + s.progress.done + '"></progress><span class="meta">' + esc(s.progress.label) + "</span>" : "";
  const next = s ? '<a class="btn primary" href="' + esc(s.next.href) + '">' + esc(s.next.label) + "</a>" : "";
  const notices = (s ? s.notices.map((n) => '<p class="warn">' + esc(n) + "</p>").join("") : "")
    + (s && s.suggestion && !p.archived ? '<p class="meta"><strong>Next:</strong> ' + esc(s.suggestion.text) + ' <a class="btn" href="' + esc(s.suggestion.href) + '">See the suggestions</a></p>' : "");
  return '<article class="pcard st-' + esc(stage) + (sub ? " sub-" + esc(sub) : "") + (p.archived ? " archived" : "") + '" tabindex="-1" aria-labelledby="t-' + esc(p.id) + '">'
    + '<div class="phead">' + (p.iconFile ? '<img class="icon" alt="" src="/p/' + esc(p.id) + "/icons/" + esc(encodeURIComponent(p.iconFile)) + '">' : '<span class="icon" aria-hidden="true">' + esc((p.name || "?").slice(0, 1).toUpperCase()) + "</span>") + '<div class="who"><h2 id="t-' + esc(p.id) + '">' + esc(p.name) + '</h2><div class="meta">' + esc(p.ourAppId) + " &middot; " + p.competitors + " competitors &middot; " + p.countries + " countries</div></div>"
    + '<span class="pill">' + esc(pill) + "</span></div>"
    + '<p class="line">' + (sub === "running" ? spinHtml("spin", "border-color: var(--accent); border-right-color: transparent") : "") + esc(line) + "</p>"
    // Open comes first and what arrives with the fresh state goes under the buttons: a card that
    // grows while the pointer is on its way must not move Open away from it.
    + '<div class="actions"><a class="btn" href="/p/' + esc(p.id) + '/">Open</a>' + (p.archived ? "" : " " + next)
    + '<button type="button" class="btn right" data-archive="' + esc(p.id) + '" data-act-key="archive:' + esc(p.id) + '" data-to="' + (p.archived ? "false" : "true") + '">' + (p.archived ? "Show again" : "Archive") + "</button></div>" + prog + notices + "</article>";
}

function render() {
  // A project is opening: the page stays as it was pressed (nothing grows or moves under it).
  if (actLeaving) return;
  const live = projects.filter((p) => !p.archived);
  const arch = projects.filter((p) => p.archived);
  put("cards", live.map(card).join("")
    || '<div class="card empty"><p><strong>No projects yet.</strong></p><p class="meta">Import an existing project above, or start a new one with + New project.</p></div>');
  const t = document.getElementById("archivedToggle");
  t.hidden = !arch.length;
  const box = document.getElementById("archivedCards");
  const toggle = document.getElementById("showArchived");
  toggle.textContent = (box.hidden ? "Show archived (" : "Hide archived (") + arch.length + ")";
  toggle.setAttribute("aria-expanded", String(!box.hidden));
  toggle.setAttribute("aria-controls", "archivedCards");
  put("archivedCards", arch.map(card).join(""));
}

// Unchanged cards are left alone: a card rebuilt under the pointer loses the click on its buttons.
function put(id, html) {
  if (shown[id] === html) return;
  shown[id] = html;
  document.getElementById(id).innerHTML = html;
}

async function loadState(id) {
  // A project is opening: its page needs the tool now, and this page is about to go.
  if (actLeaving) return;
  try {
    const r = await fetch("/p/" + encodeURIComponent(id) + "/api/state?home=1");
    if (r.ok) { states[id] = await r.json(); render(); }
  } catch {}
}

async function loadProjects() {
  try {
    projects = (await (await fetch("/api/projects")).json()).projects || [];
    render();
    for (const p of projects) if (!p.archived) loadState(p.id);
  } catch { put("cards", '<p class="warn">The tool is not running. Start it with: npm start</p>'); }
}

async function pollJobs() {
  clearTimeout(jobTimer);
  let lanes = [];
  try { lanes = (await (await fetch("/api/jobs")).json()).lanes || []; } catch {}
  const bar = document.getElementById("working");
  bar.hidden = !lanes.length;
  bar.innerHTML = lanes.length ? "<span>Working now:</span>" + lanes.map((l) => '<span>' + spinHtml("spin") + '<a href="/p/' + esc(l.projectId) + '/">' + esc(l.name) + "</a>, " + esc(l.total ? "analysing image " + Math.min(l.done + 1, l.total) + " of " + l.total + " ($" + Number(l.spentUsd).toFixed(2) + " so far)" : l.message) + (l.total ? ' <progress max="' + l.total + '" value="' + l.done + '"></progress>' : "") + "</span>").join("") : "";
  const key = JSON.stringify(lanes.map((l) => [l.projectId, l.done]));
  if (key !== lastLanes) { lastLanes = key; for (const l of lanes) loadState(l.projectId); if (!lanes.length) for (const p of projects) if (!p.archived) loadState(p.id); }
  jobTimer = setTimeout(pollJobs, lanes.length ? 2000 : 10000);
}

// Follows a running import: live step and counts from the server until it is done or failed.
async function followImport(progress) {
  let misses = 0;
  for (;;) {
    let imp = null;
    try { imp = (await getJson("/api/import")).importing; misses = 0; }
    catch (e) { if (++misses >= 10) throw e; }
    if (imp && imp.state === "done") return imp;
    // No import known to the server (it was restarted): say so instead of waiting forever.
    if (!misses && !imp) { await loadProjects(); throw new Error("The tool was restarted, so this import's progress was lost. Your projects are listed below; if the project is still offered for import, import it again."); }
    if (imp && imp.state === "failed") throw new Error("The import did not finish: " + imp.text.split("\\n").slice(0, 3).join(" "));
    if (imp && imp.progress) progress(imp.progress.step, imp.progress.done, imp.progress.total);
    await new Promise((r) => setTimeout(r, 600));
  }
}

// After an import: the offer goes, the project card appears, and the page shows it.
async function afterImport(imp) {
  await loadProjects();
  await loadImport();
  const c = document.querySelector('article[aria-labelledby="t-' + CSS.escape(imp.id) + '"]');
  if (c) { c.scrollIntoView({ block: "center" }); c.classList.add("act-flash"); c.focus(); setTimeout(() => c.classList.remove("act-flash"), 4000); }
}

function importing(id, name, btn) {
  return act(btn, {
    key: "import",
    busy: "Importing " + name + "... this takes about a minute",
    status: "imp-status-" + id,
    keep: true,
    run: async (progress) => {
      if (btn) await send("/api/import", { id });
      return followImport(progress);
    },
    done: () => "Imported " + name + ". It now uses the shared library.",
  }).then((imp) => imp && afterImport(imp));
}

async function loadImport() {
  const el = document.getElementById("import");
  let r;
  try { r = await getJson("/api/import"); }
  catch (e) { el.innerHTML = '<p class="act-msg bad" role="alert">Projects to import could not be checked: ' + esc(actReason(e)) + "</p>"; return; }
  const imp = r.importing;
  const running = imp && imp.state === "running";
  const done = imp && !running ? '<div class="importbox"><h2>' + (imp.state === "done" ? "Import finished: " + esc(imp.name || imp.id) + " now uses the shared library" : '<span class="warn">The import did not finish</span>') + "</h2><details" + (imp.state === "done" ? "" : " open") + "><summary>What was checked</summary><pre>" + esc(imp.text) + "</pre></details></div>" : "";
  const found = r.found.filter((f) => !(running && f.id === imp.id));
  el.innerHTML = (running ? '<div class="importbox"><h2>Importing ' + esc(imp.name || imp.id) + '</h2><p>Checking every image and linking it into the shared library. Nothing is downloaded or sent to AI. This takes about a minute.</p><div id="imp-status-' + esc(imp.id) + '" class="act-msg" hidden></div></div>' : "")
    + done + found.map((f) => '<div class="importbox"><h2>Found an existing project: ' + esc(f.name) + "</h2><p>" + f.images.toLocaleString() + " images, " + f.analyses + " analyses. Importing moves it into the shared library: nothing is downloaded again, nothing is sent to AI, and its approval numbers stay the same.</p>"
    + '<p><button type="button" class="btn" data-dry="' + esc(f.id) + '" data-act-key="dry:' + esc(f.id) + '">Show what will happen</button> <button type="button" class="btn primary" data-import="' + esc(f.id) + '" data-name="' + esc(f.name) + '" data-act-key="import">Import it</button></p><div id="imp-status-' + esc(f.id) + '" class="act-msg" hidden></div><div id="dry-' + esc(f.id) + '"></div></div>').join("");
  // Opened (or reloaded) while an import runs: follow it here.
  if (running) importing(imp.id, imp.name || imp.id, null);
}

document.addEventListener("click", (e) => {
  const t = e.target.closest ? e.target.closest("button") : null;
  if (!t) return;
  if (t.id === "showArchived") { const b = document.getElementById("archivedCards"); b.hidden = !b.hidden; render(); }
  if (t.dataset.archive) {
    const id = t.dataset.archive; const to = t.dataset.to === "true";
    const name = (projects.find((p) => p.id === id) || { name: id }).name;
    act(t, {
      busy: to ? "Archiving..." : "Restoring...",
      run: async () => { await send("/p/" + encodeURIComponent(id) + "/api/archive", { archived: to }); await loadProjects(); },
      done: to ? name + " is archived. Its card is under Show archived." : name + " is back in your projects.",
    });
  }
  if (t.dataset.dry) {
    const id = t.dataset.dry;
    act(t, {
      busy: "Reading the project (nothing is changed)...",
      status: "imp-status-" + id,
      run: async () => { const r = await send("/api/import", { id, dryRun: true }); document.getElementById("dry-" + id).innerHTML = "<pre>" + esc(r.text) + "</pre>"; },
      done: "Here is what the import will do. Nothing was changed.",
    });
  }
  if (t.dataset.import) importing(t.dataset.import, t.dataset.name || t.dataset.import, t);
});

// Back from the project page (the page kept in memory): show what arrived while it was opening.
window.addEventListener("pageshow", (e) => { if (e.persisted) render(); });
loadProjects();
loadImport();
pollJobs();
`;

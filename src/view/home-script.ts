/**
 * Projects home script: cards from the registry's cached summaries at once, then each card's
 * fresh state; the "Working now" strip polls /api/jobs (every 2 s while something runs); the
 * Import offer for a project made before the shared library (runs only when pressed).
 */
export const HOME_SCRIPT = `
const TOKEN = (document.querySelector('meta[name="ssr-token"]') || {}).content || "";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LABEL = { setup: "Setting up", preview: "Ready to download", pick: "Pick competitors", pilot: "Pilot", core: "Core check", recommendations: "Recommendations ready", expand: "Expansions" };
let projects = [];
const states = {};
let jobTimer = null;
let lastLanes = "";

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-SSR-Token": TOKEN }, body: JSON.stringify(body) });
  return { ok: r.ok, body: await r.json() };
}

function card(p) {
  const s = states[p.id];
  const stage = s ? s.stage : p.summary ? p.summary.stage : "setup";
  const sub = s && s.substate ? s.substate : "";
  const line = s ? s.line : p.summary ? p.summary.line : "Checking...";
  const pill = (LABEL[stage] || stage) + (sub === "running" ? " \\u00b7 running" : sub === "stopped" || sub === "failed" ? " \\u00b7 stopped" : "");
  const prog = s && s.progress ? '<progress max="' + (s.progress.total || 1) + '" value="' + s.progress.done + '"></progress><span class="meta">' + esc(s.progress.label) + "</span>" : "";
  const next = s ? '<a class="btn primary" href="' + esc(s.next.href) + '">' + esc(s.next.label) + "</a>" : "";
  const notices = s ? s.notices.map((n) => '<p class="warn">' + esc(n) + "</p>").join("") : "";
  return '<article class="pcard st-' + esc(stage) + (sub ? " sub-" + esc(sub) : "") + (p.archived ? " archived" : "") + '" aria-labelledby="t-' + esc(p.id) + '">'
    + '<div class="phead"><span class="icon" aria-hidden="true">' + esc((p.name || "?").slice(0, 1).toUpperCase()) + '</span><div class="who"><h2 id="t-' + esc(p.id) + '">' + esc(p.name) + '</h2><div class="meta">' + esc(p.ourAppId) + " &middot; " + p.competitors + " competitors &middot; " + p.countries + " countries</div></div>"
    + '<span class="pill">' + esc(pill) + "</span></div>"
    + '<p class="line">' + (sub === "running" ? '<span class="spin" style="border-color: var(--accent); border-right-color: transparent" aria-hidden="true"></span>' : "") + esc(line) + "</p>" + prog + notices
    + '<div class="actions">' + (p.archived ? "" : next) + ' <a class="btn" href="/p/' + esc(p.id) + '/">Open</a>'
    + '<button type="button" class="btn right" data-archive="' + esc(p.id) + '" data-to="' + (p.archived ? "false" : "true") + '">' + (p.archived ? "Show again" : "Archive") + "</button></div></article>";
}

function render() {
  const live = projects.filter((p) => !p.archived);
  const arch = projects.filter((p) => p.archived);
  document.getElementById("cards").innerHTML = live.map(card).join("")
    || '<div class="card empty"><p><strong>No projects yet.</strong></p><p class="meta">Import an existing project above, or start a new one with + New project.</p></div>';
  const t = document.getElementById("archivedToggle");
  t.hidden = !arch.length;
  const box = document.getElementById("archivedCards");
  document.getElementById("showArchived").textContent = (box.hidden ? "Show archived (" : "Hide archived (") + arch.length + ")";
  box.innerHTML = arch.map(card).join("");
}

async function loadState(id) {
  try {
    const r = await fetch("/p/" + encodeURIComponent(id) + "/api/state");
    if (r.ok) { states[id] = await r.json(); render(); }
  } catch {}
}

async function loadProjects() {
  try {
    projects = (await (await fetch("/api/projects")).json()).projects || [];
    render();
    for (const p of projects) if (!p.archived) loadState(p.id);
  } catch { document.getElementById("cards").innerHTML = '<p class="warn">The tool is not running. Start it with: npm start</p>'; }
}

async function pollJobs() {
  clearTimeout(jobTimer);
  let lanes = [];
  try { lanes = (await (await fetch("/api/jobs")).json()).lanes || []; } catch {}
  const bar = document.getElementById("working");
  bar.hidden = !lanes.length;
  bar.innerHTML = lanes.length ? "<span>Working now:</span>" + lanes.map((l) => '<span><span class="spin" aria-hidden="true"></span><a href="/p/' + esc(l.projectId) + '/">' + esc(l.name) + "</a>, " + esc(l.total ? "analysing image " + Math.min(l.done + 1, l.total) + " of " + l.total + " ($" + Number(l.spentUsd).toFixed(2) + " so far)" : l.message) + (l.total ? ' <progress max="' + l.total + '" value="' + l.done + '"></progress>' : "") + "</span>").join("") : "";
  const key = JSON.stringify(lanes.map((l) => [l.projectId, l.done]));
  if (key !== lastLanes) { lastLanes = key; for (const l of lanes) loadState(l.projectId); if (!lanes.length) for (const p of projects) if (!p.archived) loadState(p.id); }
  jobTimer = setTimeout(pollJobs, lanes.length ? 2000 : 10000);
}

async function loadImport() {
  const el = document.getElementById("import");
  let r;
  try { r = await (await fetch("/api/import")).json(); } catch { return; }
  const imp = r.importing;
  if (imp && imp.state === "running") {
    el.innerHTML = '<div class="importbox" role="status"><h2><span class="spin" style="border-color: var(--accent-2); border-right-color: transparent" aria-hidden="true"></span>Importing ' + esc(imp.id) + "...</h2><p>Checking every image and linking it into the shared library. Nothing is downloaded or sent to AI. This takes about a minute.</p></div>";
    setTimeout(loadImport, 2000);
    return;
  }
  const done = imp && imp.state !== "running" ? '<div class="importbox"><h2>' + (imp.state === "done" ? "Import finished: " + esc(imp.id) + " now uses the shared library" : "The import did not finish") + "</h2><details" + (imp.state === "done" ? "" : " open") + "><summary>What was checked</summary><pre>" + esc(imp.text) + "</pre></details></div>" : "";
  if (imp && imp.state === "done") loadProjects();
  el.innerHTML = done + r.found.map((f) => '<div class="importbox"><h2>Found an existing project: ' + esc(f.name) + "</h2><p>" + f.images.toLocaleString() + " images, " + f.analyses + " analyses. Importing moves it into the shared library: nothing is downloaded again, nothing is sent to AI, and its approval numbers stay the same.</p>"
    + '<p><button type="button" class="btn" data-dry="' + esc(f.id) + '">Show what will happen</button> <button type="button" class="btn primary" data-import="' + esc(f.id) + '">Import it</button></p><div id="dry-' + esc(f.id) + '"></div></div>').join("");
}

document.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.id === "showArchived") { const b = document.getElementById("archivedCards"); b.hidden = !b.hidden; render(); }
  if (t.dataset && t.dataset.archive) {
    t.disabled = true;
    const r = await post("/p/" + encodeURIComponent(t.dataset.archive) + "/api/archive", { archived: t.dataset.to === "true" });
    if (!r.ok) alert((r.body.problems || ["Not changed."]).join(" "));
    loadProjects();
  }
  if (t.dataset && t.dataset.dry) {
    const box = document.getElementById("dry-" + t.dataset.dry);
    t.disabled = true; box.innerHTML = '<p class="meta">Reading the project (nothing is changed)...</p>';
    const r = await post("/api/import", { id: t.dataset.dry, dryRun: true });
    box.innerHTML = "<pre>" + esc(r.ok ? r.body.text : (r.body.problems || []).join(" ")) + "</pre>";
    t.disabled = false;
  }
  if (t.dataset && t.dataset.import) {
    t.disabled = true;
    const r = await post("/api/import", { id: t.dataset.import });
    if (!r.ok) alert((r.body.problems || ["Not started."]).join(" "));
    loadImport();
  }
});

loadProjects();
loadImport();
pollJobs();
`;

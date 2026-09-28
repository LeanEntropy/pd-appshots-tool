/**
 * Report tab (plan-reports 5): every report of the project as a folded card, newest first, with
 * its name, type, countries, competitor count, generation date, status and the "Newer data"
 * badge. Opening a card loads that report (nothing is fetched for folded cards) and draws it with
 * the report renderer inside the card. Per card: a version selector (earlier Pilot and Full check
 * versions are archived but readable), Rename, Archive or Restore, and Delete (not for the Pilot
 * or the Full check), and Export PDF of the version picked (report-export.ts). Every action gives
 * feedback through act(). #report/<id> opens that card.
 */
export const REPORT_LIST_CSS = `
.rcard { background: var(--card); border: 1px solid var(--line); border-left: 6px solid var(--accent); border-radius: 12px; margin-bottom: 12px; }
.rcard.t-core { border-left-color: var(--ok); } .rcard.t-country { border-left-color: var(--mid); } .rcard.t-compare { border-left-color: var(--accent-2); }
.rcard > summary { cursor: pointer; padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.rcard > summary .rc-name { font-size: 17px; font-weight: 700; }
.rcard > summary .rc-desc { flex-basis: 100%; color: var(--muted); font-size: 13px; }
.rcard > .rc-b { padding: 4px 14px 12px; border-top: 1px solid var(--line); }
.rc-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 8px 0; }
.pill.t-pilot { background: var(--accent); } .pill.t-core { background: var(--ok); } .pill.t-country { background: var(--mid); } .pill.t-compare { background: var(--accent-2); }
.pill.newer { background: var(--warn); } .pill.none { background: var(--muted); }
button.danger { color: var(--bad); border-color: var(--bad); }
`;

export const REPORT_LIST_SCRIPT = `
let reportList = [];
let showArchived = false;
let listSeq = 0;
// Open cards: report id -> { version, seq, loaded }.
const openState = new Map();
const TYPE_CLS = { pilot: "t-pilot", core: "t-core", country: "t-country", compare: "t-compare" };
const STATUS_CLS = { ready: "following", partial: "stale", running: "stale", none: "none", draft: "none" };
const rsafe = (id) => String(id || "").replace(/[^a-z0-9-]/g, "");
function fmtDate(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return String(iso || "");
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Writes other than POST (rename, archive: PATCH; delete: DELETE), with the page's token.
async function sendReq(method, url, body) {
  let res;
  try { res = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-SSR-Token": ACT_TOKEN }, body: JSON.stringify(body || {}) }); }
  catch { throw new Error(ACT_OFFLINE); }
  return actRead(res);
}

function versionOptions(r) {
  const opt = (v) => '<option value="' + esc(v.id) + '">Generated ' + esc(fmtDate(v.generatedAt)) + (v.format === "markdown" ? " (older format)" : "") + "</option>";
  const cur = r.versions.filter((v) => !v.archived);
  const old = r.versions.filter((v) => v.archived);
  return (r.canNow ? '<option value="now">Now (from the saved analyses)</option>' : "")
    + cur.map(opt).join("")
    + (old.length ? '<optgroup label="Earlier versions (archived)">' + old.map(opt).join("") + "</optgroup>" : "");
}

// "Pilot · United States (English) · 2 competitors: Archero 2, Capybara Go · 27 Sep 2026", from the report's own inputs.
function reportDescription(r) {
  const n = r.competitors;
  const who = n === null || n === undefined ? "" : n + (n === 1 ? " competitor" : " competitors") + ((r.competitorNames || []).length ? ": " + r.competitorNames.join(", ") : "");
  return [r.typeName, r.countries, who, r.generatedAt ? fmtDate(r.generatedAt) : "not generated yet"].filter(Boolean).join(" \\u00b7 ");
}

function reportCardHtml(r) {
  const id = rsafe(r.id);
  const summary = '<span class="rc-name">' + esc(r.name) + "</span>" + pill(TYPE_CLS[r.type] || "", r.typeName)
    + pill(STATUS_CLS[r.status.kind] || "none", r.status.text)
    + (r.newer ? '<span class="pill newer" title="' + esc(r.newer) + '">Newer data</span>' : "")
    + (r.archived ? pill("none", "Archived") : "")
    + '<span class="rc-desc">' + flagText(reportDescription(r)) + "</span>";
  const b =(cls, label, extra) => '<button type="button" class="' + cls + '" data-rid="' + id + '" data-act-key="' + cls.split(" ")[0] + "-" + id + '"' + (extra || "") + ">" + label + "</button>";
  return '<details class="rcard ' + (TYPE_CLS[r.type] || "") + '" data-rid="' + id + '" id="rc-' + id + '"><summary>' + summary + '</summary><div class="rc-b">'
    + (r.newer ? '<div class="banner stale"><p>' + pill("stale", "Newer data") + " " + esc(r.newer) + (r.canNow ? " Choose \\u201cNow\\u201d to see the report with the current data." : "") + "</p></div>" : "")
    + '<div class="rc-bar"><label>Version: <select class="rc-ver" data-rid="' + id + '">' + versionOptions(r) + "</select></label>"
    + (r.status.kind === "draft" ? b("rc-setup primary", "Continue setting up") : "")
    + (r.versions.length || r.canNow ? b("rc-pdf", "Export PDF") : "")
    + (r.versions.length || r.canNow ? b("rc-regen", "Regenerate") : "")
    + b("rc-rename", "Rename") + b("rc-archive", r.archived ? "Restore" : "Archive")
    + (r.deletable ? b("rc-delete danger", "Delete") : '<span class="meta">The ' + esc(r.typeName) + " can be archived, not deleted.</span>") + "</div>"
    + '<div class="rc-edit" id="re-' + id + '" hidden><label>New name: <input type="text" maxlength="120" class="rc-input" id="rn-' + id + '" data-rid="' + id + '"></label> '
    + b("rc-save primary", "Save name") + " " + b("rc-cancel", "Cancel") + "</div>"
    + '<p class="act-msg" id="rs-' + id + '" hidden></p><div class="rc-pdfres" id="rp-' + id + '"></div><p class="meta" id="rh-' + id + '"></p><div class="rbox" id="rb-' + id + '"></div></div></details>';
}

function renderReportList() {
  const box = document.getElementById("reportList");
  if (!box) return;
  const archived = reportList.filter((r) => r.archived).length;
  const shown = reportList.filter((r) => showArchived || !r.archived);
  box.innerHTML = (shown.length ? shown.map(reportCardHtml).join("") : '<p class="meta">No reports yet. The Pilot appears here after its first run from the Analysis page.</p>')
    + (archived ? '<p><button type="button" class="linkbtn" id="toggleArchived">' + (showArchived ? "Hide archived" : "Show archived (" + archived + ")") + "</button></p>" : "");
  // Cards that were open stay open (their content reloads when the toggle event fires).
  for (const [rid, st] of openState) {
    const c = document.getElementById("rc-" + rid);
    if (!c) { openState.delete(rid); continue; }
    const sel = c.querySelector(".rc-ver");
    if (sel && st.version && [...sel.options].some((o) => o.value === st.version)) sel.value = st.version;
    st.loaded = false;
    c.open = true;
  }
}

// The project step bar follows the saved reports (a finished run completes its step), without a reload.
async function refreshSteps() {
  const bar = document.querySelector("ol.steps");
  if (!bar) return;
  try {
    const s = await getJson(API + "/state");
    if (!s || !Array.isArray(s.steps)) return;
    bar.innerHTML = s.steps.map((x) => '<li class="' + esc(x.state) + '"' + (x.state === "current" ? ' aria-current="step"' : "") + ">" + esc(x.label) + (x.state === "done" ? '<span class="sr"> (done)</span>' : "") + "</li>").join("");
  } catch {}
}

// Called when the Report tab is shown and after a batch changes or ends: reloads the list.
async function loadReport() {
  const box = document.getElementById("reportList");
  if (!box || !location.protocol.startsWith("http")) return;
  refreshSteps();
  const page = box.closest ? box.closest("section") : null;
  if (page && page.hidden) return;
  const line = document.getElementById("reportStatus");
  const seq = ++listSeq;
  actLine(line, "busy", "Loading the reports...");
  try {
    const r = await getJson(API + "/reports");
    if (seq !== listSeq) return;
    if (line) line.hidden = true;
    if (r.notice) toast(r.notice, "ok");
    reportList = r.reports || [];
    if (typeof setPdfDefaults === "function") setPdfDefaults(r.pdf);
    const deep = rsafe((/^#report\\/(r-[a-z0-9-]+)/.exec(location.hash) || [])[1]);
    const target = deep && reportList.find((x) => x.id === deep);
    if (target && !openState.has(deep)) { openState.set(deep, {}); if (target.archived) showArchived = true; }
    renderReportList();
    if (target) { const c = document.getElementById("rc-" + deep); if (c && c.scrollIntoView) c.scrollIntoView({ block: "start" }); }
  } catch (e) { if (seq === listSeq) actLine(line, "bad", "The reports could not be loaded: " + actReason(e)); }
}

async function loadReportCard(rid) {
  const card = document.getElementById("rc-" + rid);
  if (!card) return;
  const st = openState.get(rid) || {};
  openState.set(rid, st);
  const sel = card.querySelector(".rc-ver");
  const vid = sel ? sel.value : "";
  const box = document.getElementById("rb-" + rid);
  if (!vid) { box.innerHTML = '<p class="meta">No saved version yet.</p>'; return; }
  st.version = vid; st.loaded = true;
  const seq = st.seq = (st.seq || 0) + 1;
  const line = document.getElementById("rs-" + rid);
  actLine(line, "busy", vid === "now" ? "Loading the report..." : "Loading this version...");
  try {
    const r = await getJson(API + "/reports/" + encodeURIComponent(rid) + "/versions/" + encodeURIComponent(vid));
    if (st.seq !== seq || openState.get(rid) !== st) return;
    if (line) line.hidden = true;
    showReportVersion(rid, r);
  } catch (e) { if (st.seq === seq) actLine(line, "bad", "The report could not be loaded: " + actReason(e)); }
}

function showReportVersion(rid, r) {
  const box = document.getElementById("rb-" + rid);
  const head = document.getElementById("rh-" + rid);
  const rep = reportList.find((x) => x.id === rid) || {};
  if (!box) return;
  box.classList.toggle("noimg", !showImgs);
  if (head) head.innerHTML = r.now ? "Now: computed from the saved analyses, with no AI call." : "Generated " + esc(fmtDate(r.generatedAt)) + (r.archived ? ". Earlier version (archived): kept as it was, never deleted." : ".");
  if (r.data || r.countries) {
    // "What to research next": a numbered section when the version kept its list and is about one
    // country (as in its markdown and PDF); otherwise after the report (the live list alone).
    const one = (!r.countries || r.countries.length === 1) && !!(r.research && Array.isArray(r.research.items));
    const research = typeof researchBody === "function" && one ? researchBody(r.research) : "";
    if (r.countries) {
      box.innerHTML = r.countries.map((c, i) => '<details class="sec" open><summary><span class="sec-t">' + esc(c.label) + '</span></summary><div class="sec-b" id="rbc-' + rid + "-" + i + '"></div></details>').join("");
      r.countries.forEach((c, i) => renderReport(document.getElementById("rbc-" + rid + "-" + i), c.data, rid + "-" + rsafe(c.gl), rep.type, research));
    } else renderReport(box, r.data, rid, rep.type, research);
    // Only the Pilot and the Full check are approved from the Analysis page.
    if (rep.type !== "pilot" && rep.type !== "core") for (const x of box.querySelectorAll("button.reportApprove")) x.remove();
    if (!one && typeof researchHtml === "function") box.insertAdjacentHTML("beforeend", researchHtml(r.research || null));
    return;
  }
  box.innerHTML = '<div class="banner stale"><p>' + esc(r.note || "This version was saved in an older format: shown as written then.") + (r.file ? " (" + esc(r.file) + ")" : "") + '</p></div><div class="card">' + (r.html || "") + "</div>";
}

function renameDone(rid, r) {
  const x = reportList.find((y) => y.id === rid);
  if (x) x.name = r.name;
  const c = document.getElementById("rc-" + rid);
  const nm = c && c.querySelector(".rc-name");
  if (nm) nm.textContent = r.name;
  const ed = document.getElementById("re-" + rid);
  if (ed) ed.hidden = true;
  return "Renamed to \\u201c" + r.name + "\\u201d.";
}

function saveName(btn, rid) {
  const input = document.getElementById("rn-" + rid);
  const name = input ? input.value.trim() : "";
  if (!name) { actLine(document.getElementById("rs-" + rid), "bad", "Type a name first."); return; }
  act(btn, { key: "rc-save-" + rid, busy: "Saving the name...", status: "rs-" + rid,
    run: () => sendReq("PATCH", API + "/reports/" + encodeURIComponent(rid), { name }),
    done: (r) => renameDone(rid, r) });
}

document.addEventListener("toggle", (e) => {
  const c = e.target;
  if (!c || !c.classList || !c.classList.contains("rcard")) return;
  const rid = c.dataset.rid;
  if (!c.open) { openState.delete(rid); return; }
  const st = openState.get(rid);
  if (!st || !st.loaded) loadReportCard(rid);
}, true);

document.addEventListener("change", (e) => {
  if (e.target.classList && e.target.classList.contains("rc-ver")) loadReportCard(e.target.dataset.rid);
});

document.addEventListener("keydown", (e) => {
  if (!e.target.classList || !e.target.classList.contains("rc-input")) return;
  const rid = e.target.dataset.rid;
  if (e.key === "Enter") { e.preventDefault(); saveName(document.querySelector('button.rc-save[data-rid="' + rid + '"]'), rid); }
  if (e.key === "Escape") { const ed = document.getElementById("re-" + rid); if (ed) ed.hidden = true; }
});

document.addEventListener("click", (e) => {
  if (e.target.id === "toggleArchived") { showArchived = !showArchived; renderReportList(); return; }
  const b = e.target.closest && e.target.closest(".rc-b button[data-rid]");
  if (!b) return;
  const rid = b.dataset.rid;
  const rep = reportList.find((x) => x.id === rid);
  if (!rep) return;
  const url = API + "/reports/" + encodeURIComponent(rid);
  if (b.classList.contains("rc-rename")) {
    const ed = document.getElementById("re-" + rid);
    const input = document.getElementById("rn-" + rid);
    if (ed) ed.hidden = false;
    if (input) { input.value = rep.name; input.focus(); input.select(); }
  } else if (b.classList.contains("rc-cancel")) {
    const ed = document.getElementById("re-" + rid);
    if (ed) ed.hidden = true;
  } else if (b.classList.contains("rc-save")) {
    saveName(b, rid);
  } else if (b.classList.contains("rc-pdf")) {
    // The version picked in this card; pictures as shown here (the sections hidden in this card are offered too).
    const sel = document.querySelector('.rc-ver[data-rid="' + rid + '"]');
    const version = sel ? sel.value : "";
    if (!version) { actLine(document.getElementById("rs-" + rid), "bad", "This report has no version to export yet."); return; }
    const hidden = [...hiddenImgSecs].filter((x) => x.startsWith(rid + ":")).map((x) => x.slice(rid.length + 1));
    exportReportPdf({ report: rid, version }, { button: b, status: "rs-" + rid, result: "rp-" + rid, images: showImgs && PDF_DEFAULTS.images, hiddenSections: hidden });
  } else if (b.classList.contains("rc-setup")) {
    act(b, { busy: "Opening the builder...", status: "rs-" + rid, run: async () => { const p = await getJson(url + "/plan"); await openBuilder({ id: rid, type: p.type, scope: p.scope, name: p.name }); }, done: "" });
  } else if (b.classList.contains("rc-regen")) {
    act(b, { busy: "Building a new version...", status: "rs-" + rid,
      run: async () => { const r = await send(url + "/build", {}); await loadReport(); if (typeof loadSuggestions === "function") loadSuggestions(); return r; },
      done: "Built a new version, from the saved analyses (no AI).",
      fail: () => { getJson(url + "/plan").then((p) => openBuilder({ id: isPresetType(rep.type) ? null : rid, type: p.type, scope: p.scope, name: isPresetType(rep.type) ? "" : p.name })).catch(() => {}); } });
  } else if (b.classList.contains("rc-archive")) {
    const archived = !rep.archived;
    act(b, { busy: archived ? "Archiving..." : "Restoring...", status: "reportStatus",
      run: async () => { const r = await sendReq("PATCH", url, { archived }); await loadReport(); return r; },
      done: archived ? "Archived \\u201c" + rep.name + "\\u201d. Find it under Show archived." : "Restored \\u201c" + rep.name + "\\u201d." });
  } else if (b.classList.contains("rc-delete")) {
    const n = rep.versions.length;
    if (!confirm("Delete the report \\u201c" + rep.name + "\\u201d and its " + n + (n === 1 ? " version" : " versions") + "? The analyses stay in the library and are reused by other reports.")) return;
    act(b, { busy: "Deleting...", status: "reportStatus",
      run: async () => { const r = await sendReq("DELETE", url, {}); openState.delete(rid); await loadReport(); return r; },
      done: "Deleted \\u201c" + rep.name + "\\u201d." });
  }
});
`;

/**
 * "Open a shared project" on the projects home (plan 12C, C1): choose the file a friend sent,
 * see what it holds (nothing is changed yet), then Import. A project that exists already is
 * imported as a copy, or replaces yours after a second, explicit confirmation.
 */
export const SHARE_IMPORT_CSS = `
.shareimp { margin: 0 0 18px; } .shareimp .pv { border: 3px solid var(--accent-2); background: var(--head-bg); border-radius: 14px; padding: 14px 16px; margin-top: 10px; }
.shareimp .pv h2 { margin: 0 0 6px; } .shareimp .pv ul { margin: 6px 0; padding-left: 20px; }
.shareimp .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
`;

export const SHARE_IMPORT_HTML = `<div class="shareimp"><div class="row"><button type="button" class="btn" id="openShared">Open a shared project</button><span class="meta">A project file a friend saved with "Share this project".</span><input type="file" id="sharedFile" accept=".zip,application/zip" hidden></div><div id="sharedStatus" class="act-msg" hidden></div><div id="sharedPreview"></div></div>`;

export const SHARE_IMPORT_SCRIPT = `
let sharedSeen = null;
const shMB = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : Math.max(1, Math.round(b / 1048576)) + " MB";

// The file goes to the tool with upload progress (a local copy; nothing leaves this computer).
function shareUpload(file, progress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/share/upload");
    x.setRequestHeader("X-SSR-Token", ACT_TOKEN);
    x.setRequestHeader("Content-Type", "application/zip");
    x.upload.onprogress = (e) => { if (e.lengthComputable) progress("Reading the file (" + shMB(e.loaded) + " of " + shMB(e.total) + ")", e.loaded, e.total); };
    x.onload = () => { let b = {}; try { b = JSON.parse(x.responseText); } catch {} if (x.status === 200) resolve(b); else reject(new Error((b.problems || []).join(" ") || "The file could not be read (" + x.status + ").")); };
    x.onerror = () => reject(new Error(ACT_OFFLINE));
    x.send(file);
  });
}

function sharePreview(v) {
  const c = v.counts;
  const coll = v.collision;
  const buttons = coll
    ? '<p class="warn"><strong>You already have a project "' + esc(coll.name) + '".</strong> Import this one as a separate copy, or replace yours with it.</p><div class="row"><button type="button" class="btn primary" data-shimport="copy">Import as a copy</button><button type="button" class="btn" data-shreplace="1">Replace my project...</button><button type="button" class="btn" data-shcancel="1">Cancel</button></div><div id="shConfirm"></div>'
    : '<div class="row"><button type="button" class="btn primary" data-shimport="new">Import</button><button type="button" class="btn" data-shcancel="1">Cancel</button></div>';
  return '<div class="pv" tabindex="-1" id="shPv"><h2>Shared project: ' + esc(v.project.name) + "</h2>"
    + '<p class="meta">Game ' + esc(v.project.ourAppId) + " &middot; shared " + esc(String(v.createdAt).slice(0, 10)) + " &middot; checked, nothing changed yet</p><ul>"
    + "<li>" + c.competitors + " competitors, " + c.countries + " countries</li>"
    + "<li>" + c.images.toLocaleString() + " pictures" + (v.kind === "light" ? " as small previews (full-size pictures can be downloaded later, free)" : " at full size") + ", " + c.analyses + " analyses</li>"
    + "<li>" + c.reports + " reports" + (v.reports.length ? ": " + esc(v.reports.slice(0, 8).join(", ")) + (v.reports.length > 8 ? " ..." : "") : "") + "</li>"
    + "<li>" + esc(v.sizeLine) + (v.newFiles < v.files ? " Pictures and analyses you already have are reused, not stored twice." : "") + "</li></ul>"
    + '<div id="shImpStatus" class="act-msg" hidden></div>' + buttons + "</div>";
}

async function followShareImport(progress) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 600));
    const t = (await getJson("/api/share/import")).importing;
    if (!t) throw new Error("The tool was restarted, so this import was lost. Choose the file again.");
    if (t.state === "failed") throw new Error(t.error || "The import did not finish.");
    if (t.state === "done") return t.result;
    if (t.progress) progress(t.progress.step, t.progress.done, t.progress.total);
  }
}

function shareImport(btn, mode) {
  act(btn, {
    busy: "Importing...",
    status: "shImpStatus",
    keep: true,
    fail: () => document.querySelectorAll("[data-shcancel],[data-shimport],[data-shreplace]").forEach((x) => { x.hidden = false; }),
    run: async (progress) => {
      // The other choices are closed while the import runs.
      document.querySelectorAll("[data-shcancel],[data-shimport],[data-shreplace]").forEach((x) => { if (x !== btn) x.hidden = true; });
      await send("/api/share/import", { uploadId: sharedSeen.uploadId, mode }); return followShareImport(progress); },
    done: (r) => "Imported " + r.name + "." + (r.kind === "light" ? " Its pictures are small previews until you download the full-size ones (Overview page)." : "") + (r.replacedTo ? " Your earlier copy is kept in the workspace folder " + r.replacedTo + "." : "") + (r.droppedLimits ? " The sender's spending limits were not copied: yours apply." : ""),
  }).then(async (r) => {
    if (!r) return;
    sharedSeen = null;
    document.getElementById("sharedPreview").innerHTML = '<p class="act-msg ok">Imported ' + esc(r.name) + '. <a class="btn primary" href="/p/' + encodeURIComponent(r.projectId) + '/">Open it</a></p>';
    await loadProjects();
    const c = document.querySelector('article[aria-labelledby="t-' + CSS.escape(r.projectId) + '"]');
    if (c) { c.classList.add("act-flash"); setTimeout(() => c.classList.remove("act-flash"), 4000); }
  });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest ? e.target.closest("button") : null;
  if (!b) return;
  if (b.id === "openShared") document.getElementById("sharedFile").click();
  if (b.dataset.shcancel) { sharedSeen = null; document.getElementById("sharedPreview").innerHTML = ""; toast("Nothing was imported.", "ok"); }
  if (b.dataset.shimport) shareImport(b, b.dataset.shimport);
  if (b.dataset.shreplace) document.getElementById("shConfirm").innerHTML = '<p class="warn">Replace your project "' + esc(sharedSeen.collision.name) + '" with the shared one? Yours is not deleted: it is moved aside in the workspace folder, but it no longer shows in the tool.</p><div class="row"><button type="button" class="btn primary" data-shimport="replace">Yes, replace it</button><button type="button" class="btn" data-shcancel="1">Cancel</button></div>';
});

document.getElementById("sharedFile").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  if (!file) return;
  document.getElementById("sharedPreview").innerHTML = "";
  act(document.getElementById("openShared"), {
    busy: "Reading " + file.name + "...",
    status: "sharedStatus",
    run: async (progress) => {
      const up = await shareUpload(file, progress);
      progress("Checking the file (nothing is changed)");
      return (await send("/api/share/inspect", { uploadId: up.uploadId })).inspection;
    },
    done: "",
  }).then((v) => {
    if (!v) return;
    sharedSeen = v;
    document.getElementById("sharedPreview").innerHTML = sharePreview(v);
    const pv = document.getElementById("shPv"); pv.scrollIntoView({ block: "center" }); pv.focus();
  });
});
`;

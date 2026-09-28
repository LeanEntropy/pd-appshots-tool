/**
 * "Add a competitor" in the Competitors tab (plan 1.4): search by name, link or package ID with
 * the wizard's Google Play cards, pick how close the game is, add it (not ticked for the core),
 * then check only its store pages, show the download approval, and download only what is new,
 * with live progress. The list below it removes a game after an in-page confirmation.
 */
export const ADD_CSS = `
#addComp h3 { margin: 0 0 6px; }
#addComp .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#addComp input[type=text] { flex: 1; min-width: min(100%, 260px); font: inherit; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); }
#addComp select { font: inherit; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); }
#addComp button { padding: 6px 12px; }
#addComp .ico { width: 44px; height: 44px; flex: none; border-radius: 11px; object-fit: cover; display: grid; place-items: center; font-weight: 800; font-size: 18px; color: #fff; background: var(--brand); }
#addComp .ico.sm { width: 34px; height: 34px; font-size: 15px; border-radius: 9px; }
.addlist { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 6px; }
.addlist li { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
.addlist .who { flex: 1; min-width: 0; } .addlist .who .meta { overflow-wrap: anywhere; }
.addwarn { border-left: 6px solid var(--mid); background: var(--card); padding: 8px 12px; border-radius: 8px; margin: 8px 0; }
.addapprove { border: 3px solid var(--accent); border-radius: 12px; padding: 12px 16px; background: var(--tint); margin: 12px 0; }
.addapprove:focus { outline: 3px solid var(--accent-2); outline-offset: 2px; }
.addapprove ul { margin: 6px 0 10px; padding-left: 20px; }
.addconfirm { flex-basis: 100%; border: 2px solid var(--bad); border-radius: 10px; padding: 8px 12px; background: var(--bg); }
.addconfirm p { margin: 0 0 8px; }
`;

export const ADD_SCRIPT = `
const ADD = { list: [], ourAppId: "", hits: null, card: null, preview: null, confirm: null };
const addEl = (id) => document.getElementById(id);
const addProject = () => decodeURIComponent(API.split("/")[2] || "");
const addWaitMs = (ms) => new Promise((r) => setTimeout(r, ms));

function addWhy(id) { return id === ADD.ourAppId ? "Your game" : ADD.list.some((c) => c.id === id) ? "In the project" : ""; }
function addBtn(id, name) {
  const why = addWhy(id);
  return why ? '<button type="button" disabled>' + esc(why) + "</button>"
    : '<button type="button" class="primary" data-addcomp="' + esc(id) + '" data-name="' + esc(name) + '" data-act-key="addcomp:' + esc(id) + '">Add</button>';
}
function addBytes(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

function renderAdd() {
  const box = addEl("addComp");
  if (!box) return;
  if (!canSave) { box.innerHTML = '<p class="meta">To add competitors, open this page with: npm start</p>'; return; }
  box.innerHTML = "<h3>Add a competitor</h3>"
    + '<p class="meta"><label for="addq">Type a game&#39;s name, or paste its Google Play link or package ID.</label> Only the new game is read and downloaded; nothing is sent to AI.</p>'
    + '<div class="row"><input type="text" id="addq" placeholder="Survivor.io, or a Google Play link" autocomplete="off">'
    + '<label>How close is it? <select id="addTier">' + TIERS.map(([v, l]) => '<option value="' + v + '"' + (v === "same_audience" ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select></label>"
    + '<button type="button" class="primary" id="addSearch">Search</button></div>'
    + '<div id="addLine" class="act-msg" hidden></div><div id="addHits"></div>'
    + '<div id="addFlow"></div><div id="addFlowLine" class="act-msg" hidden></div>'
    + '<details id="addListBox" open><summary>Competitors in this project</summary><div id="addList"></div></details>';
  drawAddHits(); drawAddList(); drawAddFlow();
}

function drawAddHits(warnings) {
  const box = addEl("addHits");
  if (!box) return;
  const warn = (w) => '<p class="addwarn">' + esc(w) + "</p>";
  if (warnings) { box.innerHTML = warnings.map(warn).join(""); return; }
  const row = (id, title, ic, meta) => "<li>" + icon(googleIcon(ic), title) + '<div class="who"><strong>' + esc(title) + '</strong><div class="meta">' + meta + "</div></div>" + addBtn(id, title) + "</li>";
  if (ADD.card) {
    const a = ADD.card;
    const meta = [a.developer, category(a.genreId), a.installs ? a.installs + " downloads" : "", stars(a.score)].filter(Boolean).map(esc).join(" &middot; ");
    box.innerHTML = '<ul class="addlist">' + row(a.appId, a.title, a.icon, meta) + "</ul>"
      + (a.warnings || []).filter((w) => w.indexOf("Charts will be switched off") < 0).map(warn).join("");
    return;
  }
  box.innerHTML = ADD.hits ? '<ul class="addlist">' + ADD.hits.map((h) => row(h.appId, h.title, h.icon, esc(h.developer) + " &middot; " + esc(stars(h.score)))).join("") + "</ul>" : "";
}

function drawAddList() {
  const el = addEl("addList");
  if (!el) return;
  const sum = document.querySelector("#addListBox summary");
  if (sum) sum.textContent = "Competitors in this project (" + ADD.list.length + ")";
  el.innerHTML = '<ul class="addlist">' + ADD.list.map((c) => {
    const tier = (TIERS.find((t) => t[0] === c.tier) || [c.tier, c.tier])[1];
    const state = c.downloaded ? (c.inPick ? "Downloaded, in your core pick" : "Downloaded") : c.incomplete ? "Download incomplete: check the store to fetch what is missing" : "Not downloaded yet";
    const actions = ADD.confirm === c.id
      ? '<div class="addconfirm" role="group" aria-label="Confirm removal"><p><strong>Remove ' + esc(c.name) + " from this project?</strong> It leaves the competitor list" + (c.inPick ? " and your core pick" : "") + ". Its screenshots and analyses stay in the shared library, so adding it back later costs nothing.</p>"
        + '<button type="button" class="primary" data-rmyes="' + esc(c.id) + '" data-act-key="rm:' + esc(c.id) + '">Yes, remove it</button> <button type="button" data-rmno="1">Cancel</button></div>'
      : (c.downloaded ? "" : '<button type="button" class="primary" data-addcheck="' + esc(c.id) + '" data-act-key="check:' + esc(c.id) + '">Check the store</button>')
        + '<button type="button" data-rm="' + esc(c.id) + '">Remove</button>';
    const ref = c.reference ? '<div class="meta">Not on Google Play in the United States; using ' + esc(c.reference.label) + " as its reference</div>" : "";
    return "<li>" + icon(c.iconFile ? "../icons/" + encodeURIComponent(c.iconFile) : "", c.name, true) + '<div class="who"><strong>' + esc(c.name) + '</strong><div class="meta">' + esc(tier) + " &middot; " + esc(state) + "</div>" + ref + "</div>" + actions + "</li>";
  }).join("") + "</ul>";
}

function drawAddFlow(focus) {
  const el = addEl("addFlow");
  if (!el) return;
  const p = ADD.preview;
  if (!p) { el.innerHTML = ""; return; }
  const by = (s) => p.countries.filter((c) => c.status === s);
  const ok = by("ok"); const na = by("unavailable"); const err = by("error");
  el.innerHTML = '<div class="addapprove" id="addApprove" tabindex="-1" role="region" aria-label="Download approval"><h3>Download ' + esc(p.name) + "?</h3><ul>"
    + "<li>Store pages with screenshots: " + ok.length + " of " + p.countries.length + " countries" + (ok.length ? " (" + ok.map((c) => esc(c.label) + ": " + c.images).join(", ") + ")" : "") + ".</li>"
    + (na.length ? "<li>Not available in: " + na.map((c) => esc(c.label)).join(", ") + ".</li>" : "")
    + (err.length ? "<li>Could not be read: " + err.map((c) => esc(c.label)).join(", ") + ". Check the store again later to fill the gap.</li>" : "")
    + "<li>Different images: " + p.images + ". Already in the shared library, not downloaded again: " + p.inLibrary + ".</li>"
    + "<li><strong>Images to download: " + p.toDownload + "</strong>. Disk space: about " + addBytes(p.bytes) + (p.bytesSource === "measured" ? " (measured from a sample)" : " (rough estimate)") + ".</li>"
    + "<li>Images sent to AI: 0. AI calls: 0. Analysing it later needs its own approval.</li></ul>"
    + (p.notInCore ? '<p class="addwarn">' + esc(p.notInCore) + "</p>" : "")
    + (p.problem
      ? '<p class="act-msg bad">' + esc(p.problem) + '</p><button type="button" class="primary" data-addcheck="' + esc(p.appId) + '" data-act-key="check:' + esc(p.appId) + '">Check the store again</button>'
      : '<button type="button" class="primary" id="addGo" data-act-key="dl:' + esc(p.appId) + '">' + (p.toDownload ? "Download " + p.toDownload + " images" : "Add its decks (nothing to download)") + '</button> <button type="button" id="addLater">Not now</button>')
    + "</div>";
  if (focus) { const box = addEl("addApprove"); box.scrollIntoView({ block: "center", behavior: "smooth" }); box.focus({ preventScroll: true }); }
}

async function addLoad() {
  const r = await getJson(API + "/competitors");
  ADD.list = r.competitors; ADD.ourAppId = r.ourAppId;
  drawAddList();
  return r;
}

// Polls this project's store job until it is no longer running.
async function addWait(progress) {
  for (;;) {
    const j = (await getJson(API + "/competitors/job")).job;
    if (!j || j.state !== "running") return j;
    if (progress) progress(j.progress.message, j.progress.done, j.progress.total);
    await addWaitMs(1000);
  }
}
const addEnded = (j, what) => { if (!j || j.state !== "finished") throw new Error((j && j.error) || what + " stopped. Try again."); return j; };
async function addShowPreview(id, focus) {
  ADD.preview = (await getJson(API + "/competitors/preview?id=" + encodeURIComponent(id))).preview;
  drawAddFlow(focus);
}

function addSearch(btn) {
  const q = addEl("addq").value.trim();
  if (!q) { actLine(addEl("addLine"), "bad", "Type a game's name, or paste its Google Play link."); return; }
  return act(btn, { key: "addSearch", busy: "Searching Google Play...", status: "addLine",
    run: async () => {
      ADD.hits = null; ADD.card = null; drawAddHits();
      const r = await getJson("/api/play/search?q=" + encodeURIComponent(q) + "&project=" + encodeURIComponent(addProject()));
      if (r.app) { ADD.card = r.app; drawAddHits(); return "Found " + r.app.title + "."; }
      ADD.hits = r.hits; drawAddHits();
      return r.hits.length + " matches for " + q + ". Pick the right one: nothing is added on its own.";
    },
    done: (m) => m });
}

async function addGame(btn, id, name) {
  const tier = addEl("addTier").value;
  const r = await act(btn, { busy: "Adding " + name + "...", status: "addLine", keep: true,
    run: () => send(API + "/competitors/add", { id, tier }), done: (x) => x.message });
  if (!r) return;
  ADD.hits = null; ADD.card = null; addEl("addq").value = "";
  drawAddHits(r.warnings || []);
  await addLoad().catch(() => {});
  addCheck(null, id);
}

function addCheck(btn, id) {
  const name = (ADD.list.find((c) => c.id === id) || { name: id }).name;
  ADD.preview = null; drawAddFlow();
  return act(btn, { key: "check:" + id, busy: "Checking the store pages of " + name + " (no images yet)...", status: "addFlowLine",
    run: async (progress) => {
      await send(API + "/competitors/check", { id });
      addEnded(await addWait(progress), "The store check");
      await addShowPreview(id, true);
    },
    done: "Store pages of " + name + " checked. Nothing is downloaded until you approve." });
}

function addDownload(btn) {
  const p = ADD.preview;
  if (!p) return;
  return act(btn, { busy: "Starting the download...", status: "addFlowLine", keep: true,
    run: async (progress) => {
      await send(API + "/competitors/download", { id: p.appId, planHash: p.planHash });
      addEnded(await addWait(progress), "The download");
    },
    fail: () => { ADD.preview = null; drawAddFlow(); addLoad().catch(() => {}); },
    done: () => { setTimeout(() => location.reload(), 1500); return p.name + " downloaded. Reloading the page to show it..."; } });
}

function addRemove(btn, id) {
  return act(btn, { key: "rm:" + id, busy: "Removing...", status: "addLine", keep: true,
    run: () => send(API + "/competitors/remove", { id }),
    done: (r) => { setTimeout(() => location.reload(), 1500); return r.message + " Reloading the page..."; } });
}

// After a reload: follow a running store job, or show the approval of a checked game again.
async function addInit() {
  renderAdd();
  if (!canSave) return;
  let j = null;
  try { j = (await addLoad()).job; } catch (e) { actLine(addEl("addLine"), "bad", "The competitor list could not be loaded: " + actReason(e)); return; }
  const game = j && ADD.list.find((c) => c.id === j.appId);
  if (!j || !game) return;
  if (j.state === "running")
    act(null, { key: "addFollow", busy: j.progress.message, status: "addFlowLine",
      run: async (progress) => {
        addEnded(await addWait(progress), j.kind === "download" ? "The download" : "The store check");
        if (j.kind === "download") setTimeout(() => location.reload(), 1500);
        else await addShowPreview(game.id, true);
      },
      done: j.kind === "download" ? game.name + " downloaded. Reloading the page..." : "Store pages of " + game.name + " checked." });
  else if (!game.downloaded && j.state !== "running") {
    try { await addShowPreview(game.id, false); } catch { return; }
    if (j.state !== "finished") actLine(addEl("addFlowLine"), "bad", (j.kind === "download" ? "The download of " : "The store check of ") + game.name + " stopped: " + (j.error || "unknown reason") + " Press the button to continue; images already downloaded are not fetched again.");
  }
}

document.addEventListener("click", (e) => {
  const t = e.target.closest ? e.target.closest("#addComp button") : null;
  if (!t || t.disabled) return;
  if (t.id === "addSearch") addSearch(t);
  else if (t.dataset.addcomp) addGame(t, t.dataset.addcomp, t.dataset.name);
  else if (t.dataset.addcheck) addCheck(t, t.dataset.addcheck);
  else if (t.id === "addGo") addDownload(t);
  else if (t.id === "addLater") { ADD.preview = null; drawAddFlow(); toast("Not downloaded. Use Check the store in the list below when you want it.", "ok"); }
  else if (t.dataset.rm) { ADD.confirm = t.dataset.rm; drawAddList(); const y = document.querySelector("[data-rmyes]"); if (y) y.focus(); }
  else if (t.dataset.rmno) { ADD.confirm = null; drawAddList(); }
  else if (t.dataset.rmyes) addRemove(t, t.dataset.rmyes);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "addq") { e.preventDefault(); addSearch(addEl("addSearch")); }
});
`;

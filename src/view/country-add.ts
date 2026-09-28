/**
 * "Add countries" (from a multi-country suggestion, the "What next?" card, the builder or the
 * coverage map), in the approval dialog: a picker of the Google Play countries not in the project
 * (flag, name, language), with what adding one means. Adding saves them to the project's
 * settings, checks only their store pages (free), then shows the download approval (images, disk
 * space, no AI) and downloads only what is new, with live progress, as "Add a competitor" does.
 */
export const COUNTRY_ADD_CSS = `
.cpick fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; padding: 6px 10px; }
.cpick .cplist { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: 2px 12px; }
.cpick .cplist label { display: flex; gap: 6px; align-items: center; padding: 3px 0; cursor: pointer; }
.cpick .cplist .meta { margin-left: auto; }
.cpnote { border-left: 5px solid var(--mid); background: var(--bg); padding: 6px 10px; border-radius: 6px; font-weight: 600; }
.cpick .cpscroll { max-height: min(52vh, 460px); overflow-y: auto; }
`;

export const COUNTRY_ADD_SCRIPT = `
const CP = { view: null, preview: null };
const CP_NOTE = "Adding a country downloads its store pages and screenshots (free, uses disk space).";
const cpWait = (ms) => new Promise((r) => setTimeout(r, ms));
function cpBytes(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

function cpPickerHtml(v) {
  const regions = [...new Set(v.addable.map((c) => c.region))];
  const saved = v.notDownloaded || [];
  const box = (c) => '<label><input type="checkbox" name="cpgl" value="' + esc(c.gl) + '"> ' + countryLabel(c.gl, c.label) + ' <span class="meta">' + esc(c.language) + "</span></label>";
  return '<div class="cpick"><h3 id="approvalTitle">Add countries to this project</h3>'
    + '<p>In the project now: ' + v.countries.map((m) => countryLabel(m.gl, countryOf(m.label))).join(", ") + ".</p>"
    + '<p class="cpnote">' + esc(CP_NOTE) + " Nothing is sent to AI; you see the number of images and the disk space before anything is downloaded.</p>"
    + (saved.length ? '<p>Added but not downloaded yet: ' + saved.map((m) => countryLabel(m.gl, countryOf(m.label))).join(", ") + ' <button type="button" id="cpResume" data-act-key="cpResume">Check their store pages</button></p>' : "")
    + (v.fixed ? '<p class="act-msg bad">This project\\u2019s settings come from a config file, so its countries cannot be changed here.</p>'
      : v.addable.length ? '<div class="cpscroll">' + regions.map((r) => "<fieldset><legend>" + esc(r) + '</legend><div class="cplist">' + v.addable.filter((c) => c.region === r).map(box).join("") + "</div></fieldset>").join("") + "</div>"
      : "<p>Every Google Play country the tool knows is in the project already.</p>")
    + '<p class="act-msg" id="cpLine" hidden></p><div class="actions">'
    + (v.fixed || !v.addable.length ? "" : '<button type="button" class="primary" id="cpAdd" data-act-key="cpAdd" disabled>Tick the countries to add</button>')
    + '<button id="cancelApproval">Close</button></div></div>';
}

function cpApprovalHtml(p) {
  return '<div class="cpick"><h3 id="approvalTitle">Download the new countries?</h3><ul>'
    + p.countries.map((c) => "<li>" + countryLabel(c.gl, countryOf(c.label)) + ": store pages found for " + c.found + " of " + c.pages + " games, " + c.images + " screenshots.</li>").join("")
    + "<li>Different images: " + p.images + ". Already in the shared library, not downloaded again: " + p.inLibrary + ".</li>"
    + "<li><strong>Images to download: " + p.toDownload + "</strong>. Disk space: about " + cpBytes(p.bytes) + (p.bytesSource === "measured" ? " (measured from a sample)" : " (rough estimate)") + ".</li>"
    + "<li>Images sent to AI: 0. Cost: none. Analysing them later needs its own approval.</li></ul>"
    + (p.incomplete.length ? '<p class="meta">' + esc(p.incomplete.join(" ")) + "</p>" : "")
    + '<p class="act-msg" id="cpLine" hidden></p>'
    + (p.problem ? '<p class="act-msg bad">' + esc(p.problem) + '</p><div class="actions"><button type="button" class="primary" id="cpResume" data-act-key="cpResume">Check the store again</button><button id="cancelApproval">Close</button></div>'
      : '<div class="actions"><button type="button" class="primary" id="cpGo" data-act-key="cpGo">' + (p.toDownload ? "Download " + p.toDownload + " images" : "Add their store pages (nothing to download)") + '</button><button type="button" id="cpLater">Not now</button></div>')
    + "</div>";
}

function cpShow(html) {
  const box = document.getElementById("approval");
  box.innerHTML = html;
  approvalDialog();
  const t = document.getElementById("approvalTitle");
  if (t) { t.setAttribute("tabindex", "-1"); t.focus(); }
}

// Polls the project's store job until it is no longer running.
async function cpFollow(progress) {
  for (;;) {
    const j = (await getJson(API + "/project-countries/job")).job;
    if (!j || j.state !== "running") { if (!j || j.state !== "finished") throw new Error((j && j.error) || "It stopped. Try again."); return j; }
    if (progress) progress(j.progress.message, j.progress.done, j.progress.total);
    await cpWait(1000);
  }
}

async function cpCheck(progress, gls) {
  await send(API + "/project-countries/check", { gls });
  await cpFollow(progress);
  CP.preview = (await getJson(API + "/project-countries/preview")).preview;
  cpShow(cpApprovalHtml(CP.preview));
}

async function cpOpen(btn) {
  await act(btn, { busy: "Opening the country list...", run: async () => {
    CP.view = await getJson(API + "/project-countries");
    const j = CP.view.job;
    if (j && j.state === "running") {
      cpShow('<div class="cpick"><h3 id="approvalTitle">Adding countries</h3><p class="act-msg" id="cpLine" hidden></p><div class="actions"><button id="cancelApproval">Close</button></div></div>');
      act(null, { key: "cpFollow", busy: j.progress.message, status: "cpLine", run: async (progress) => {
        await cpFollow(progress);
        if (j.kind === "download") setTimeout(() => location.reload(), 1500);
        else { CP.preview = (await getJson(API + "/project-countries/preview")).preview; cpShow(cpApprovalHtml(CP.preview)); }
      }, done: j.kind === "download" ? "Downloaded. Reloading the page..." : "" });
      return;
    }
    cpShow(cpPickerHtml(CP.view));
  }, done: "" });
}

function cpTicked() { return [...document.querySelectorAll('input[name="cpgl"]:checked')].map((x) => x.value); }

document.addEventListener("change", (e) => {
  if (!e.target || e.target.name !== "cpgl") return;
  const b = document.getElementById("cpAdd");
  const n = cpTicked().length;
  if (b) { b.disabled = !n; b.textContent = n ? "Add " + n + (n === 1 ? " country" : " countries") : "Tick the countries to add"; }
});

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("cpOpen")) { cpOpen(b); return; }
  if (b.id === "cpAdd") {
    const gls = cpTicked();
    if (!gls.length) return;
    act(b, { busy: "Saving the countries to the project...", status: "cpLine", keep: true, run: async (progress) => {
      const r = await send(API + "/project-countries/add", { gls });
      toast(r.message, "ok");
      progress("Checking their store pages (free, no images yet)");
      await cpCheck(progress, gls);
    }, done: "" });
  } else if (b.id === "cpResume") {
    const gls = (CP.preview && CP.preview.gls) || ((CP.view && CP.view.notDownloaded) || []).map((m) => m.gl);
    act(b, { busy: "Checking the store pages (free, no images yet)...", status: "cpLine", keep: true, run: (progress) => cpCheck(progress, gls), done: "" });
  } else if (b.id === "cpGo" && CP.preview) {
    const p = CP.preview;
    act(b, { busy: "Starting the download...", status: "cpLine", keep: true, run: async (progress) => {
      await send(API + "/project-countries/download", { planHash: p.planHash });
      await cpFollow(progress);
    }, done: () => { setTimeout(() => location.reload(), 1500); return "The new countries are downloaded. Reloading the page to show them..."; } });
  } else if (b.id === "cpLater") {
    closeApproval();
    toast("Not downloaded. The countries are saved in the project; use Add countries again to download them.", "ok");
  }
});
`;

/**
 * "Share this project" on the Overview page (plan 12C, milestone 3b): Light or Full, with the
 * exact size shown before anything is built, live progress while the file is written, and the
 * browser's download at the end. A project that came as a Light copy also offers to download
 * its full-size pictures again (free) and says why analysing needs them.
 */
export const SHARE_PANEL_CSS = `
#sharePanel { margin-bottom: 14px; }
#sharePanel .share-box { background: var(--head-bg); border: 1px solid var(--line); border-radius: 12px; padding: 12px 16px; }
#sharePanel h3 { margin: 0 0 4px; font-size: 17px; }
#sharePanel .opts { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
#sharePanel .opt { flex: 1 1 260px; display: flex; gap: 8px; align-items: flex-start; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; cursor: pointer; }
#sharePanel .opt:has(input:checked) { border-color: var(--accent); box-shadow: 0 0 0 2px var(--accent) inset; }
#sharePanel .opt b { display: block; } #sharePanel .opt .chip { margin-left: 6px; font-weight: 700; }
#sharePanel .preview-note { border-left: 6px solid var(--warn); background: var(--card); border-radius: 8px; padding: 8px 12px; margin: 0 0 10px; }
`;

export const SHARE_PANEL_HTML = '<div id="sharePanel" aria-live="polite"></div>';

export const SHARE_PANEL_SCRIPT = `
let shareInfo = null;
let shareLoaded = false;
const shareSize = (b) => b >= 1073741824 ? (b / 1073741824).toFixed(1) + " GB" : b >= 1048576 ? Math.max(1, Math.round(b / 1048576)) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";

function sharePreviewNote(s) {
  if (!s.previewOnly) return "";
  return '<div class="preview-note"><p><strong>' + s.previewOnly + (s.previewOnly === 1 ? " picture is a small preview" : " pictures are small previews") + " only</strong> (this project was shared with you as a Light copy). They show everywhere, but analysing them needs the full-size pictures first.</p>"
    + '<p><button type="button" id="shareOriginals" class="primary">Download full-size pictures (free)</button> <span class="meta">From Google Play, about ' + Math.max(1, Math.round(s.previewOnly / 120)) + " min for all of them. No AI, no cost.</span></p>"
    + '<div id="shareOrigStatus" class="act-msg" hidden></div></div>';
}

function renderShare() {
  const box = document.getElementById("sharePanel");
  if (!box || !shareInfo) return;
  const s = shareInfo;
  const from = s.shared ? '<p class="meta">This project came from a shared file (' + esc(s.shared.kind === "light" ? "Light" : "Full") + ", shared " + esc(String(s.shared.sharedAt).slice(0, 10)) + ").</p>" : "";
  if (!s.sizes) { box.innerHTML = '<div class="share-box"><h3>Share this project</h3>' + sharePreviewNote(s) + '<p class="meta">' + esc(s.problem || "Nothing to share yet.") + "</p>" + from + "</div>"; return; }
  const z = s.sizes;
  const big = z.full.bytes > 500 * 1048576;
  box.innerHTML = '<div class="share-box"><h3>Share this project</h3>' + sharePreviewNote(s)
    + '<p>Save the whole project to one file and send it to a friend. They open it with <strong>Open a shared project</strong> on the tool\\'s home page and see the same screens, analyses and reports. Nothing is analysed or paid again.</p>'
    + '<div class="opts" role="radiogroup" aria-label="What to include">'
    + '<label class="opt"><input type="radio" name="shareKind" value="light" checked><span><b>Light<span class="chip">up to ' + shareSize(z.light.bytes) + "</span></b>"
    + '<span class="meta">Small previews of all ' + z.images.toLocaleString() + " pictures, " + z.analyses + " analyses, " + z.reports.length + " reports. Full-size pictures can be downloaded again later (free).</span></span></label>"
    + (z.fullSize ? '<label class="opt"><input type="radio" name="shareKind" value="full"><span><b>Full<span class="chip">up to ' + shareSize(z.full.bytes) + "</span></b>"
    + '<span class="meta">Everything in Light plus ' + z.fullSize.toLocaleString() + " pictures at full size." + (big ? ' <strong class="warn">A large file: too big for e-mail; use a file-transfer service, and allow time to copy it.</strong>' : "") + "</span></span></label>" : "") + "</div>"
    + (z.fullSize ? "" : '<p class="meta">Full (with full-size pictures) is offered once the full-size pictures are downloaded.</p>')
    + '<p><button type="button" id="shareExport" class="primary">Save to a file</button> <span class="meta">It contains competitors\\' store screenshots: share it only with people working on your game.</span></p>'
    + '<div id="shareStatus" class="act-msg" hidden></div>' + from + "</div>";
}

async function loadShare() {
  shareLoaded = true;
  const box = document.getElementById("sharePanel");
  if (box && !shareInfo) box.innerHTML = '<div class="share-box"><h3>Share this project</h3><p class="meta">Counting files and sizes...</p></div>';
  try { shareInfo = await getJson(API + "/share"); renderShare(); }
  catch (e) { if (box) box.innerHTML = '<div class="share-box"><h3>Share this project</h3><p class="act-msg bad">' + esc(actReason(e)) + "</p></div>"; }
}

// Polls a background share task until it ends; progress goes to the action's line.
async function shareFollow(pick, progress) {
  for (;;) {
    await new Promise((r) => setTimeout(r, 700));
    const s = await getJson(API + "/share?sizes=0");
    const t = pick(s);
    if (!t) throw new Error("The tool was restarted, so this was lost. Try again.");
    if (t.state === "failed") throw new Error(t.error || "It did not finish.");
    if (t.state === "done") return t.result;
    if (t.progress) progress(t.progress.step, t.progress.done, t.progress.total);
  }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest ? e.target.closest("button") : null;
  if (!b) return;
  if (b.id === "shareExport") {
    const kind = (document.querySelector('input[name="shareKind"]:checked') || {}).value || "light";
    act(b, {
      busy: "Saving the project to a file...",
      status: "shareStatus",
      run: async (progress) => {
        await send(API + "/share/export", { kind });
        const r = await shareFollow((s) => s.export, progress);
        const a = document.createElement("a");
        a.href = API + "/share/file?id=" + encodeURIComponent(r.exportId);
        a.download = r.fileName;
        document.body.appendChild(a); a.click(); a.remove();
        return r;
      },
      done: (r) => "Saved " + r.fileName + " (" + shareSize(r.bytes) + "). Your browser is downloading it: send that file to your friend.",
    });
  }
  if (b.id === "shareOriginals") {
    act(b, {
      busy: "Downloading full-size pictures...",
      status: "shareOrigStatus",
      run: async (progress) => {
        await send(API + "/share/originals", {});
        return shareFollow((s) => s.originals, progress);
      },
      done: (r) => "Downloaded " + r.recovered + " of " + r.total + " full-size pictures." + (r.changed ? " " + r.changed + " changed on Google Play since the project was shared: those keep their preview and their earlier analysis." : "") + (r.gone ? " " + r.gone + " are no longer on Google Play." : "") + (r.failed ? " " + r.failed + " could not be downloaded now; press the button again later." : ""),
    }).then((r) => { if (r) { shareInfo = null; loadShare(); } });
  }
});

function shareMaybeLoad() { if (!shareLoaded && pageFromHash(location.hash) === "overview") loadShare(); }
window.addEventListener("hashchange", shareMaybeLoad);
shareMaybeLoad();
`;

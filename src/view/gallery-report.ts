/**
 * Report page: the report as it stands now (from the saved analyses, no AI) or an earlier run.
 * Numbered sections with a table of contents: 1 overview (verdict and prioritised key points),
 * 2 patterns with our fit, 3 one row per store position (ours first), 4 recommendations,
 * 5 detailed statistics. Everything but the AI wording and the recommendations is computed by
 * code and always shown; when the AI parts are missing or out of date it says why and offers the
 * approval (nothing runs without it). Images fold globally (remembered per viewer) or per section.
 */
export const REPORT_SCRIPT = `
let reportData = null;
let reportSeq = 0;
const hiddenImgSecs = new Set();
let showImgs = true;
try { showImgs = localStorage.getItem("ssr.reportImages") !== "off"; } catch {}
const SECTIONS = ["Overview", "Patterns across competitors", "Position by position", "Recommendations", "Detailed statistics"];
const SEC_IDS = ["overview", "patterns", "positions", "recs", "stats"];

const L = (k) => (reportData && reportData.labels && reportData.labels[k]) || String(k || "").replace(/_/g, " ");
const pc = (n) => Math.round((n || 0) * 100) + "%";
function bar(share) { return '<span class="bar" aria-hidden="true"><span style="width:' + Math.round(Math.max(0, Math.min(1, share || 0)) * 100) + '%"></span></span>'; }
function rthumb(id, thumb, file, alt) {
  if (!thumb) return "";
  return '<span class="rthumb rimgs"><a href="' + IMG + esc(file || thumb) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + IMG + esc(thumb) + '" alt="' + esc(alt) + '"></a>' + (id ? infoBtn(id) : "") + "</span>";
}
function pill(cls, text) { return '<span class="pill ' + esc(cls) + '">' + esc(text) + "</span>"; }
function sec(n, title, body, imgs, closed) {
  const id = SEC_IDS[n];
  return '<details class="sec' + (hiddenImgSecs.has(id) ? " noimg" : "") + '"' + (closed ? "" : " open") + ' data-sec="' + id + '" id="rep-' + id + '"><summary><span class="sec-t"><span class="secno">' + (n + 1) + ".</span> " + esc(title) + "</span>"
    + (imgs ? '<button type="button" class="imgbtn" data-imgsec="' + id + '">' + (hiddenImgSecs.has(id) ? "Show images" : "Hide images") + "</button>" : "")
    + '</summary><div class="sec-b">' + body + "</div></details>";
}

const VERDICT_CLS = { optimised: "following", "on par": "following", "slightly different": "slightly", "relatively different": "slightly", "very different": "very", "not enough data": "none" };

function overviewHtml(d) {
  const f = d.fit;
  const ai = d.ai && d.ai.current ? d.ai.interpretation : null;
  const pts = f ? f.keyPoints : [];
  // The AI wording is used only when it matches the computed verdict and key points.
  const worded = !!(f && ai && ai.keyPoints && ai.keyPoints.length === pts.length && ai.verdictText && ai.verdictText.toLowerCase().includes(f.verdict));
  const points = worded ? ai.keyPoints : pts;
  const s = d.synthesis;
  const status = s.state === "current" ? ""
    : '<div class="banner ' + s.state + '"><p>' + pill(s.state, s.state === "stale" ? "AI parts out of date" : "AI parts not written yet") + " " + esc(s.reason) + "</p><p><strong>How to get them:</strong> " + esc(s.howTo) + '</p><p><button type="button" class="primary" id="reportApprove">Open the approval</button> <span class="meta">Shows the exact images and cost first; nothing runs until you approve.</span></p></div>';
  return '<div class="verdict ' + (f ? VERDICT_CLS[f.verdict] || "" : "none") + '"><div class="vlabel">Our deck is</div><div class="vword">' + esc(f ? f.verdict : "not enough data") + "</div>"
    + (f && f.score !== null ? '<div class="meta">Fits ' + pc(f.score) + " of the weighted competitor patterns (" + f.patterns.filter((x) => x.fits === true).length + " fit, " + f.patterns.filter((x) => x.fits === false).length + " different).</div>" : "") + "</div>"
    + (worded ? "<p>" + esc(ai.verdictText) + "</p>" : "")
    + "<h3>Key points to optimise, most important first</h3>"
    + (points.length ? '<ol class="keypoints">' + points.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ol>" : "<p>None: our deck fits every competitor pattern found.</p>")
    + status + (d.approved ? "" : '<p class="meta">No batch is approved for this stage yet: the games below are the batch Start analysis would propose.</p>');
}

function tocHtml() {
  return '<nav class="card toc" aria-label="Report contents"><strong>Contents</strong><ol>' + SECTIONS.map((s, i) => '<li><button type="button" class="linkbtn" data-goto="rep-' + SEC_IDS[i] + '">' + esc(s) + "</button></li>").join("") + "</ol></nav>";
}

function renderReport() {
  const box = document.getElementById("report");
  box.classList.toggle("noimg", !showImgs);
  const d = reportData;
  if (!d) return;
  box.innerHTML = tocHtml()
    + sec(0, SECTIONS[0], overviewHtml(d), false)
    + sec(1, SECTIONS[1], fitHtml(d), false)
    + sec(2, SECTIONS[2], positionsHtml(d), true)
    + sec(3, SECTIONS[3], recsHtml(d), true)
    + sec(4, SECTIONS[4], patternsHtml(d.patterns), false, true);
}

async function loadReport() {
  const box = document.getElementById("report");
  if (!box || !location.protocol.startsWith("http")) return;
  const stage = (document.getElementById("stage") || {}).value || "pilot";
  const sel = document.getElementById("reportRun");
  const run = sel ? sel.value : "current";
  const seq = ++reportSeq;
  try {
    if (run === "current") {
      const r = await (await fetch("/api/report/current?stage=" + encodeURIComponent(stage))).json();
      if (seq !== reportSeq) return;
      reportData = r.data;
      if (sel) sel.innerHTML = '<option value="current">Now (from the saved analyses)</option>' + (r.runs || []).map((x) => '<option value="' + esc(x.runId) + '">Run ' + esc(x.runId) + (x.hasData ? "" : " (older format)") + "</option>").join("");
      renderReport();
      return;
    }
    const r = await (await fetch("/api/report/run?stage=" + encodeURIComponent(stage) + "&id=" + encodeURIComponent(run))).json();
    if (seq !== reportSeq) return;
    if (r.data) { reportData = r.data; renderReport(); return; }
    if (!r.html) { box.innerHTML = '<p class="warn">' + esc((r.problems || ["This run could not be found."]).join(" ")) + "</p>"; return; }
    box.innerHTML = '<div class="banner stale"><p>Run ' + esc(r.runId || run) + " was saved in an older format: shown as written then (" + esc(r.file || "") + ").</p></div>" + (r.html ? '<div class="card">' + r.html + "</div>" : '<p class="warn">' + esc((r.problems || ["Not found."]).join(" ")) + "</p>");
  } catch { box.innerHTML = '<p class="warn">The report could not be loaded. Is the gallery server running (npm run gallery)?</p>'; }
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button.imgbtn");
  if (b) {
    e.preventDefault();
    const id = b.dataset.imgsec;
    if (hiddenImgSecs.has(id)) hiddenImgSecs.delete(id); else hiddenImgSecs.add(id);
    const s = b.closest("details.sec");
    if (s) s.classList.toggle("noimg", hiddenImgSecs.has(id));
    b.textContent = hiddenImgSecs.has(id) ? "Show images" : "Hide images";
  }
  const g = e.target.dataset && e.target.dataset.goto;
  if (g) { const t = document.getElementById(g); if (t) { t.open = true; t.scrollIntoView({ block: "start" }); } }
  if (e.target.id === "reportApprove") { goTo("analysis"); showApproval(); }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "reportRun") loadReport();
  // A saved run belongs to one batch: switching the batch goes back to the current report.
  if (e.target.id === "stage") { const sel = document.getElementById("reportRun"); if (sel) sel.value = "current"; }
  if (e.target.id === "showImages") {
    showImgs = e.target.checked;
    try { localStorage.setItem("ssr.reportImages", showImgs ? "on" : "off"); } catch {}
    document.getElementById("report").classList.toggle("noimg", !showImgs);
  }
});
{ const cb = document.getElementById("showImages"); if (cb) cb.checked = showImgs; }
`;

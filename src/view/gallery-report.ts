/**
 * One report's content (rendered into its card by report-list.ts): the report as it stands now
 * (from the saved analyses, no AI) or a saved version. Parameterised by container and report id:
 * every element id is prefixed with the report id, so several open reports never clash.
 * Numbered sections, the summary first and then a table of contents: 1 summary (short answer,
 * verdict, key points, key recommendations, A/B tests to run next, dates), 2 patterns with our
 * fit, 3 one row per store position (ours first), 4 recommendations, 5 A/B test details,
 * 6 store text and derived keywords per country, then (when the version kept it) what to research
 * next, and last the detailed statistics. Everything but the AI wording and the recommendations is computed by
 * code and always shown; when the AI parts are missing or out of date it says why and offers the
 * approval (nothing runs without it). Images fold globally (remembered per viewer) or per section.
 */
export const REPORT_SCRIPT = `
// The report being rendered (read by L() and the part renderers while one report is drawn).
let reportData = null;
let repRid = "";
let repStage = "pilot";
// Hidden image sections, as "<report id>:<section>".
const hiddenImgSecs = new Set();
let showImgs = true;
try { showImgs = localStorage.getItem("ssr.reportImages") !== "off"; } catch {}
const SECTIONS = ["Summary: the bottom line", "Patterns across competitors", "Position by position", "Recommendations", "A/B test details", "Store text and keywords", "Detailed statistics"];
const SEC_IDS = ["summary", "patterns", "positions", "recs", "abtests", "store", "stats"];

const L = (k) => (reportData && reportData.labels && reportData.labels[k]) || String(k || "").replace(/_/g, " ");
const pc = (n) => Math.round((n || 0) * 100) + "%";
function bar(share) { return '<span class="bar" aria-hidden="true"><span style="width:' + Math.round(Math.max(0, Math.min(1, share || 0)) * 100) + '%"></span></span>'; }
function rthumb(id, thumb, file, alt) {
  if (!thumb) return "";
  return '<span class="rthumb rimgs"><a href="' + IMG + esc(file || thumb) + '" target="_blank" rel="noopener"><img loading="lazy" src="' + IMG + esc(thumb) + '" alt="' + esc(alt) + '"></a>' + (id ? infoBtn(id) : "") + "</span>";
}
function pill(cls, text) { return '<span class="pill ' + esc(cls) + '">' + esc(text) + "</span>"; }
// The sections of the report being drawn: the seven above, plus "What to research next" before
// the statistics when the version kept that list (plan-reports 5A.5).
let repSecs = [];
function secList(research) {
  const l = SECTIONS.map((t, i) => ({ id: SEC_IDS[i], t }));
  if (research) l.splice(6, 0, { id: "research", t: "What to research next" });
  return l;
}
// A saved "What to research next" list (the version's suggestions.json items).
function researchList(list) {
  return "<ol>" + list.map((s) => "<li><strong>" + esc(s.title) + "</strong> (" + esc(s.costText) + "). " + esc(s.why) + (s.older ? ' <span class="older">(based on older data)</span>' : "") + "</li>").join("") + "</ol>";
}
function sec(n, body, imgs, closed) {
  const id = repSecs[n].id;
  const title = repSecs[n].t;
  const hid = hiddenImgSecs.has(repRid + ":" + id);
  return '<details class="sec' + (hid ? " noimg" : "") + '"' + (closed ? "" : " open") + ' data-sec="' + id + '" id="rep-' + repRid + "-" + id + '"><summary><span class="sec-t"><span class="secno">' + (n + 1) + ".</span> " + esc(title) + "</span>"
    + (imgs ? '<button type="button" class="imgbtn" data-rid="' + repRid + '" data-imgsec="' + id + '">' + (hid ? "Show images" : "Hide images") + "</button>" : "")
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
    : '<div class="banner ' + s.state + '"><p>' + pill(s.state, s.state === "stale" ? "AI parts out of date" : "AI parts not written yet") + " " + esc(s.reason) + "</p><p><strong>How to get them:</strong> " + esc(s.howTo) + '</p><p><button type="button" class="primary reportApprove" data-stage="' + esc(repStage) + '">Open the approval</button> <span class="meta">Shows the exact images and cost first; nothing runs until you approve.</span></p></div>';
  return '<div class="verdict ' + (f ? VERDICT_CLS[f.verdict] || "" : "none") + '"><div class="vlabel">Our deck is</div><div class="vword">' + esc(f ? f.verdict : "not enough data") + "</div>"
    + (f && f.score !== null ? '<div class="meta">Fits ' + pc(f.score) + " of the weighted competitor patterns (" + f.patterns.filter((x) => x.fits === true).length + " fit, " + f.patterns.filter((x) => x.fits === false).length + " different).</div>" : "") + "</div>"
    + (d.summary ? shortAnswerHtml(d) : worded ? "<p>" + esc(ai.verdictText) + "</p>" : "")
    + "<h3>Key points to optimise, most important first</h3>"
    + (points.length ? '<ol class="keypoints">' + points.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ol>" : "<p>None: our deck fits every competitor pattern found.</p>")
    + status + (d.approved ? "" : '<p class="meta">No batch is approved for this stage yet: the games below are the batch Start analysis would propose.</p>')
    + (d.leftOut && d.leftOut.length ? '<p class="meta">Not in this check: ' + esc(d.leftOut.join(", ")) + " (not on Google Play in " + esc(d.market) + "). They are shown in the countries where they exist.</p>" : "");
}

function tocHtml() {
  return '<nav class="card toc" aria-label="Report contents"><strong>Contents</strong><ol>' + repSecs.map((s) => '<li><button type="button" class="linkbtn" data-goto="rep-' + repRid + "-" + s.id + '">' + esc(s.t) + "</button></li>").join("") + "</ol></nav>";
}

// Draws report data d into box, for report rid (ids prefixed with it) of the given batch.
// research: the body of "What to research next" (HTML), or "" when the report has none.
function renderReport(box, d, rid, stage, research) {
  if (!box || !d) return;
  reportData = d;
  repRid = String(rid || "").replace(/[^a-z0-9-]/g, "");
  repStage = stage === "core" ? "core" : "pilot";
  repSecs = secList(!!research);
  box.classList.toggle("noimg", !showImgs);
  // Bottom line first: the summary, then the contents, then the details (plan-reports 3C).
  box.innerHTML = sec(0, summaryHtml(d), false)
    + tocHtml()
    + sec(1, fitHtml(d), false)
    + sec(2, positionsHtml(d), true)
    + sec(3, recsHtml(d), true)
    + sec(4, abDetailsHtml(d), false)
    + sec(5, storeTextHtml(d), false)
    + (research ? sec(6, research, false) : "")
    + sec(repSecs.length - 1, patternsHtml(d.patterns), false, true);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button.imgbtn");
  if (b) {
    e.preventDefault();
    const id = (b.dataset.rid || "") + ":" + b.dataset.imgsec;
    if (hiddenImgSecs.has(id)) hiddenImgSecs.delete(id); else hiddenImgSecs.add(id);
    const s = b.closest("details.sec");
    if (s) s.classList.toggle("noimg", hiddenImgSecs.has(id));
    b.textContent = hiddenImgSecs.has(id) ? "Show images" : "Hide images";
  }
  const g = e.target.dataset && e.target.dataset.goto;
  if (g) { const t = document.getElementById(g); if (t) { t.open = true; t.scrollIntoView({ block: "start" }); } }
  const ap = e.target.closest && e.target.closest("button.reportApprove");
  if (ap) {
    // The approval is for this report's batch (Pilot or Full check).
    const st = document.getElementById("stage");
    if (st && st.value !== ap.dataset.stage) { st.value = ap.dataset.stage; st.dispatchEvent(new Event("change", { bubbles: true })); }
    goTo("analysis");
    openApproval(ap, null);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "showImages") {
    showImgs = e.target.checked;
    try { localStorage.setItem("ssr.reportImages", showImgs ? "on" : "off"); } catch {}
    document.querySelectorAll(".rbox").forEach((b) => b.classList.toggle("noimg", !showImgs));
  }
});
{ const cb = document.getElementById("showImages"); if (cb) cb.checked = showImgs; }
`;

/**
 * One report's content (rendered into its card by report-list.ts): the report as it stands now
 * (from the saved analyses, no AI) or a saved version. Parameterised by container and report id:
 * every element id is prefixed with the report id, so several open reports never clash.
 * Numbered sections, the summary first and then a table of contents: 1 summary (short answer,
 * verdict, key points, key recommendations, A/B tests to run next, dates), 2 patterns with our
 * fit, 3 one row per store position (ours first), 4 recommendations, 5 A/B test details,
 * 6 store text and derived keywords per country, then (when the version kept it) what to research
 * next, and last the detailed statistics. Open by default (user, 2026-09-29): the summary, the
 * patterns with our fit, the position table and the recommended order; the A/B test details,
 * store text, research list and statistics start folded, and method notes, dates and long specs
 * sit in folds ("Details", "Show all", one per slot). Everything but the AI wording and the recommendations is computed by
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
  // Flags where the page has them (the print page does not).
  const t = typeof flagText === "function" ? flagText : esc;
  return "<ol>" + list.map((s) => "<li><strong>" + t(s.title) + "</strong> (" + esc(s.costText) + "). " + esc(s.why) + (s.older ? ' <span class="older">(based on older data)</span>' : "") + "</li>").join("") + "</ol>";
}
function sec(n, body, imgs, closed) {
  const id = repSecs[n].id;
  const title = repSecs[n].t;
  const hid = hiddenImgSecs.has(repRid + ":" + id);
  return '<details class="sec' + (hid ? " noimg" : "") + '"' + (closed ? "" : " open") + ' data-sec="' + id + '" id="rep-' + repRid + "-" + id + '"><summary><span class="sec-t"><span class="secno">' + (n + 1) + ".</span> " + esc(title) + "</span>"
    + (imgs ? '<button type="button" class="imgbtn" data-rid="' + repRid + '" data-imgsec="' + id + '">' + (hid ? "Show images" : "Hide images") + "</button>" : "")
    + '</summary><div class="sec-b">' + body + "</div></details>";
}

// "12 of 15 pattern points"; reports saved before the points: from the saved patterns.
function fitPoints(f) {
  const w = (x) => (x.strength === "pattern" ? 2 : 1);
  const judged = f.patterns.filter((x) => x.fits !== null);
  const p = f.points || { fit: judged.filter((x) => x.fits).reduce((n, x) => n + w(x), 0), total: judged.reduce((n, x) => n + w(x), 0) };
  return p.fit + " of " + p.total + " pattern points";
}
// Fewer competitors than this: the verdict line says the sample is small (said once, there).
const SMALL_SAMPLE = 10;
function sampleText(n) { return n ? n + (n === 1 ? " competitor" : " competitors") + (n < SMALL_SAMPLE ? " (a small sample: read patterns as strong hints)" : "") : ""; }
// What is open by default stays short; the rest goes behind one fold per block.
function fold(summary, body, cls) { return body ? '<details class="fold' + (cls ? " " + cls : "") + '"><summary>' + summary + '</summary><div class="fold-b">' + body + "</div></details>" : ""; }
function detailsFold(parts) { return fold("Details", parts.filter(Boolean).join(""), "more"); }
// A long list: its first n items, the rest behind "Show all".
function capList(tag, cls, items, n) {
  const open = "<" + tag + (cls ? ' class="' + cls + '"' : "");
  if (items.length <= n) return items.length ? open + ">" + items.join("") + "</" + tag + ">" : "";
  return open + ">" + items.slice(0, n).join("") + "</" + tag + ">"
    + fold("Show all (" + items.length + ")", open + (tag === "ol" ? ' start="' + (n + 1) + '"' : "") + ">" + items.slice(n).join("") + "</" + tag + ">", "showall");
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
    + (f && f.score !== null ? '<div class="meta">' + esc([fitPoints(f), sampleText(d.patterns ? d.patterns.games.length : 0)].filter(Boolean).join(" \\u00b7 ")) + "</div>" : "") + "</div>"
    + (d.summary ? shortAnswerHtml(d) : worded ? "<p>" + esc(ai.verdictText) + "</p>" : "")
    + "<h3>Key points to optimise, most important first</h3>"
    + (points.length ? capList("ol", "keypoints", points.map((p) => "<li>" + esc(p) + "</li>"), 3) :"<p>None: our deck fits every competitor pattern found.</p>")
    + status;
}
// The summary's fold: how the verdict is scored and the notes about the batch.
function overviewDetails(d) {
  const f = d.fit;
  return [f && f.score !== null ? "<p>" + f.patterns.filter((x) => x.fits === true).length + " patterns fit, " + f.patterns.filter((x) => x.fits === false).length + " differ. A pattern (nearly every competitor) counts 2 points, a partial pattern (at least half of them) 1.</p>" : "",
    d.approved ? "" : "<p>No batch is approved for this stage yet: the games below are the batch Start analysis would propose.</p>",
    d.leftOut && d.leftOut.length ? "<p>Not in this check: " + esc(d.leftOut.join(", ")) + " (not on Google Play in " + esc(d.market) + "). They are shown in the countries where they exist.</p>" : ""].join("");
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
    + sec(4, abDetailsHtml(d), false, true)
    + sec(5, storeTextHtml(d), false, true)
    + (research ? sec(6, research, false, true) : "")
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

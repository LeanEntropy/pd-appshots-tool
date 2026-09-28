/**
 * The approval of a One country or Compare countries report's AI batch (milestone R4), in the
 * same highlighted dialog as the Pilot's: first the doubtful picture matches still unanswered
 * (they block the run: Same screen keeps the cheap text comparison, Different screens makes it a
 * full analysis), then exactly which images go to AI per game and country, marked by kind, the
 * text-only steps with their model, calls and cost, and the total against the spending limit.
 * Nothing is sent before "Approve and run"; the dialog then turns into the run panel.
 */
export const REPORT_APPROVE_SCRIPT = `
let shownReport = null;
const RTIER = { full: "full analysis", "layer-diff": "text comparison" };

function reportPairHtml(x) {
  const img = (t, alt) => (t ? '<img src="' + IMG + esc(t) + '" alt="' + esc(alt) + '">' : "");
  return '<div class="pair">' + img(x.anchor.thumb, "the analysed picture") + img(x.image.thumb, x.country) + "<div><strong>" + esc(x.game) + "</strong>, position " + x.position + " in " + esc(theCountryOf(x.country)) + ": the same screen as the analysed picture (left), with new text?<br>"
    + '<button type="button" class="pairr" data-img="' + esc(x.image.id) + '" data-anchor="' + esc(x.anchor.id) + '" data-same="true">Same screen</button> <button type="button" class="pairr" data-img="' + esc(x.image.id) + '" data-anchor="' + esc(x.anchor.id) + '" data-same="false">Different screens</button></div></div>';
}

function reportApprovalHtml(r) {
  const p = r.plan;
  const paid = p.items.filter((i) => i.tier !== "identical");
  const groups = new Map();
  for (const it of paid) { const k = it.name + " \\u00b7 " + countryOf(it.country); groups.set(k, (groups.get(k) || []).concat([it])); }
  const blocks = [...groups].map(([k, list]) => '<div class="agame"><strong>' + esc(k) + "</strong>: " + list.length + '<div class="athumbs">'
    + list.map((it) => '<figure class="' + esc(it.tier) + '" title="' + esc(it.reason) + '">' + (it.thumb ? '<img src="' + IMG + esc(it.thumb) + '" alt="' + esc(it.name + " position " + it.position) + '">' : "") + "<figcaption>#" + it.position + " " + esc(RTIER[it.tier] || it.tier) + "</figcaption></figure>").join("") + "</div></div>").join("");
  const passes = p.images.passes.filter((x) => x.calls > 0).map((x) => "<tr><td>" + esc(x.role) + "</td><td>" + esc(x.model) + "</td><td>" + x.calls + "</td><td>" + x.images + "</td><td></td></tr>").join("");
  const text = p.text.parts.map((t) => "<tr><td>" + esc(t.label) + "</td><td>" + esc(t.model) + "</td><td>" + t.calls + "</td><td>0</td><td>" + usdRange(t.usd) + "</td></tr>").join("");
  const doubt = r.doubtful.length ? '<div class="contbox"><h4>First, ' + r.doubtful.length + " doubtful picture " + (r.doubtful.length === 1 ? "match" : "matches") + "</h4><p>These pictures are close to the line between \\u201csame picture, new text\\u201d (a cheap text comparison) and \\u201cdifferent screen\\u201d (a full analysis). Answer each one, or all at once; the numbers below update.</p>"
    + '<p><button type="button" class="pairall" data-same="true">All: the same screen (text comparison)</button> <button type="button" class="pairall" data-same="false">All: different screens (full analysis)</button></p>'
    + r.doubtful.map(reportPairHtml).join("") + "</div>" : "";
  const blocked = r.doubtful.length ? "Answer the doubtful picture matches above first." : p.overLimit ? "This is over the spending limit of " + money(p.limitUsd) + ": leave some games or countries out in the report setup first." : "";
  const nothing = !paid.length && !p.text.parts.length;
  return '<h3 id="approvalTitle">Approve \\u201c' + esc(r.name) + "\\u201d?</h3>" + doubt
    + '<p class="big"><strong>' + paid.length + " images will be sent to AI</strong> (full analysis: " + p.counts.full + ", text comparison: " + p.counts.layerDiff + "). Already analysed or identical, free: " + p.counts.identical + ".</p>"
    + blocks
    + '<table class="passes"><tr><th>Step</th><th>Model</th><th>Calls</th><th>Images</th><th>Cost</th></tr>' + passes + text + "</table>"
    + '<p class="big">Estimated total: <strong>' + usdRange(p.usd) + "</strong> (limit " + money(p.limitUsd) + " for this report). The run never spends more than the limit; it stops before and keeps what is finished.</p>"
    + (blocked ? '<p class="warn">' + esc(blocked) + "</p>" : "")
    + '<div class="actions">' + (nothing ? "<p>Nothing to run: everything is analysed and written. Use Build report instead.</p>" : '<button id="approveReport" class="primary"' + (blocked ? " disabled" : "") + ">Approve and run</button>") + '<button id="cancelApproval">Cancel</button></div>';
}

async function showReportApproval(rid) {
  approvalDialog("Working out the numbers (no AI)... this takes a few seconds", "busy");
  try {
    const r = await send(API + "/reports/" + encodeURIComponent(rid) + "/approval", {});
    shownReport = r;
    const box = document.getElementById("approval");
    box.innerHTML = reportApprovalHtml(r);
    approvalDialog();
  } catch (e) { shownReport = null; approvalDialog("The numbers could not be worked out: " + actReason(e), "bad"); }
}

function openReportApproval(btn, rid) {
  return act(btn, { key: "rapprove-" + rid, busy: "Working out the numbers...", run: () => showReportApproval(rid) });
}

async function approveReport() {
  const r = shownReport;
  if (!r) return;
  try { await send(API + "/reports/" + encodeURIComponent(r.id) + "/run", { planHash: r.plan.planHash }); }
  catch (e) { approvalDialog("The run did not start: " + actReason(e), "bad"); shownReport = null; return; }
  shownReport = null;
  showRunInDialog();
  await pollStatus();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button");
  if (!b) return;
  if (b.classList.contains("rc-approve")) openReportApproval(b, b.dataset.rid);
  else if (b.id === "approveReport") act(b, { busy: "Starting the run...", keep: true, run: approveReport });
  else if (b.classList.contains("pairr") && shownReport) {
    const rid = shownReport.id;
    act(b, { busy: "Saving your answer...", run: async () => { await send(API + "/reports/match-check", { image: b.dataset.img, anchor: b.dataset.anchor, same: b.dataset.same === "true" }); await showReportApproval(rid); }, done: "" });
  } else if (b.classList.contains("pairall") && shownReport) {
    const rid = shownReport.id;
    const list = shownReport.doubtful.slice();
    act(b, { busy: "Saving " + list.length + " answers...", run: async () => { for (const x of list) await send(API + "/reports/match-check", { image: x.image.id, anchor: x.anchor.id, same: b.dataset.same === "true" }); await showReportApproval(rid); }, done: "" });
  } else if (b.id === "continueRun" && lastStatus && lastStatus.reportId) openReportApproval(b, lastStatus.reportId);
});
`;

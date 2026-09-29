/**
 * The builder's "What this report needs" box and its actions (plan-reports 1.2, 2.2): counts per
 * kind (free, text comparison, full analysis), the text-only steps, the total against the
 * spending limit, the store dates, the "Leave these out" proposal when over the limit, and the
 * buttons: Build report (only when nothing new is needed), Review and approve (the Pilot and the
 * Full check: the existing approval), or Review the images (the exact images and cost; the paid
 * steps of the other reports arrive with the next update, so nothing is sent), plus the free
 * picture-match check. Every button goes through act().
 */
export const BUILDER_REVIEW_SCRIPT = `
const TIER_TEXT = { full: "full analysis", "layer-diff": "text comparison", identical: "already analysed" };
function usdRange(u) { return money(u[0]) + " to " + money(u[1]); }
function shortDate(d) { const t = new Date(d + "T00:00:00Z"); return isNaN(t.getTime()) ? String(d) : t.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }); }

function needsHtml(p) {
  const c = p.counts;
  const row = (label, n) => "<tr><td>" + esc(label) + '</td><td class="n">' + n + "</td></tr>";
  const dates = p.decks.map((d) => d.orderDate).filter(Boolean).sort();
  const gone = p.decks.filter((d) => d.state === "not-sold" || d.state === "not-downloaded");
  const left = p.decks.filter((d) => d.state === "left-out");
  const lines = [row("Already analysed or identical to an analysed image (free)", c.identical), row("Same picture, new text: compare the text layer", c.layerDiff), row("Different picture: full analysis", c.full)];
  if (c.newImages) lines.push(row("Images: estimated cost", usdRange(p.images.usd)));
  for (const t of p.text.parts) lines.push(row(t.label, usdRange(t.usd)));
  return "<h4>What this report needs</h4><table>" + lines.join("") + "</table>"

    + '<p class="total">Total about ' + usdRange(p.usd) + (p.cap ? "" : ' <span class="meta">(limit ' + money(p.limitUsd) + " per report)</span>") + "</p>"
    + (p.cap ? '<p class="meta">Core total after this batch: ' + p.cap.coreTotal + " of " + p.cap.cap + " images.</p>" : "")
    + (p.overLimit ? '<p class="over">This is over the spending limit of ' + money(p.limitUsd) + ".</p>" : "")
    + (p.drop ? '<p>Proposal: leave out ' + esc(p.drop.leaveOut.map((x) => x.name + " in " + theCountryOf(x.country)).join(", ")) + ", saves about " + money(p.drop.savesUsd) + (p.drop.fits ? "" : " (still over the limit)") + '. <button type="button" id="bLeave">Leave these out</button></p>' : "")
    + (left.length ? '<p class="meta">Left out to stay within the limit: ' + esc(left.map((d) => d.name + " in " + theCountryOf(d.country)).join(", ")) + '. <button type="button" class="linkbtn" id="bPutBack">Put them back</button></p>' : "")
    + (gone.length ? '<p class="meta">Not in this report: ' + esc(gone.map((d) => d.name + (d.state === "not-sold" ? " (not sold in " : " (not downloaded in ") + theCountryOf(d.country) + ")").join(", ")) + ".</p>" : "")
    + '<p class="meta">Data: store pages from ' + (dates.length ? esc(shortDate(dates[0])) + (dates.at(-1) !== dates[0] ? " to " + esc(shortDate(dates.at(-1))) : "") : "no saved date") + ". Analyses as of now.</p>";
}

function renderNeeds(p) {
  const needs = document.getElementById("bNeeds");
  if (needs) { needs.className = ""; needs.removeAttribute("role"); needs.innerHTML = needsHtml(p); }
  const acts = document.getElementById("bActs");
  if (!acts) return;
  const n = p.counts.newImages;
  let main;
  if (p.instant) main = '<button type="button" class="primary" id="bBuild">Build report</button><span class="meta">Free: nothing is sent to AI' + (isPresetType(bld.type) ? "" : "; written parts already paid for are reused, the rest are marked missing") + ".</span>"
    + (p.usd[1] > 0 ? '<button type="button" id="bApprove">Review and approve the written parts</button><span class="meta">Text-only AI: shown with the steps and cost first.</span>' : "");
  else main = '<button type="button" class="primary" id="bApprove">Review and approve</button><span class="meta">Opens the approval with the exact ' + n + " images, the text-only steps and the cost. Nothing runs until you approve.</span>";
  acts.innerHTML = main + (!isPresetType(bld.type) && p.counts.layerDiff ? '<button type="button" id="bMatch">Check the picture matches (free)</button>' : "") + '<button type="button" id="bClose">Close</button>';
}

function reviewHtml(p) {
  const items = p.items.filter((i) => i.tier !== "identical");
  const groups = new Map();
  for (const it of items) { const k = it.name + " \\u00b7 " + countryOf(it.country); groups.set(k, (groups.get(k) || []).concat([it])); }
  const blocks = [...groups].map(([k, list]) => '<div class="agame"><strong>' + flagText(k) + "</strong>: " + list.length + '<div class="athumbs">'
    + list.map((it) => '<figure class="' + esc(it.tier) + '" title="' + esc(it.reason) + '">' + (it.thumb ? '<img src="' + IMG + esc(it.thumb) + '" alt="' + esc(it.name + " position " + it.position) + '">' : "") + "<figcaption>#" + it.position + " " + esc(TIER_TEXT[it.tier]) + "</figcaption></figure>").join("") + "</div></div>").join("");
  return '<h3 id="approvalTitle">What this report would send to AI</h3><p class="big"><strong>' + items.length + " images</strong>: full analysis " + p.counts.full + ", text comparison " + p.counts.layerDiff + ". Already analysed (free): " + p.counts.identical + ". Estimated total " + usdRange(p.usd) + " (limit " + money(p.limitUsd) + ").</p>"
    + blocks + '<p class="warn">Running the paid steps of One country and Compare countries reports comes with the next update of the tool. Nothing has been sent and nothing is spent.</p><div class="actions"><button id="cancelApproval">Close</button></div>';
}

function pairHtml(x) {
  const now = x.treatedAs === "same" ? "treated as the same picture (text comparison only)" : "treated as different screens (full analysis)";
  return '<div class="pair">' + pgPictures(x) + "<div><strong>" + esc(x.game) + "</strong>: position " + x.position + " in " + esc(theCountryOf(x.country)) + " vs position " + x.anchor.position + " in the main country. " + esc(now) + (x.userSaid ? " (your answer)" : "") + "." + esc(pgChanged(x)) + '<br><button type="button" class="pairv" data-img="' + esc(x.image.id) + '" data-anchor="' + esc(x.anchor.id) + '" data-same="false">Different screens</button> <button type="button" class="pairv" data-img="' + esc(x.image.id) + '" data-anchor="' + esc(x.anchor.id) + '" data-same="true">Same screen</button></div></div>';
}

async function showMatchCheck() {
  const r = await getJson(API + "/reports/match-check");
  const box = document.getElementById("approval");
  // The pixel check's one-click block and the answers given there, then the rest one by one.
  const done = pgAnswered("m");
  const grouped = pgGroupHtml("m", r.doubtful) + pgDoneHtml("m") + pgDecidedHtml("m", r.doubtful);
  const one = r.doubtful.filter((x) => !x.group && !done.has(pgKey(x)));
  box.innerHTML = '<h3 id="approvalTitle">Check the picture matches (free, no AI)</h3><p>Checked ' + r.checked + " images of our game and your pick in the other countries: " + r.identical + " the same file as in the main country, " + r.same + " the same picture with new text, " + r.different + " different pictures.</p>"
    + grouped
    + (one.length ? "<p>These matches are close to the line. If the screen under the text is different, press Different screens: that image then gets a full analysis.</p>" + one.map(pairHtml).join("") : grouped ? "" : "<p>No doubtful matches.</p>")
    + '<div class="actions"><button id="cancelApproval">Close</button></div>';
  approvalDialog();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button");
  if (!b) return;
  if (b.id === "newReport") { act(b, { busy: "Opening the builder...", run: () => openBuilder(null), done: "" }); return; }
  if (b.id === "bClose") { closeBuilder(); return; }
  if (b.classList.contains("pairv")) {
    act(b, { busy: "Saving your answer...", run: async () => { await send(API + "/reports/match-check", { image: b.dataset.img, anchor: b.dataset.anchor, same: b.dataset.same === "true" }); await showMatchCheck(); builderChanged(false); }, done: "Saved. The numbers use your answer." });
    return;
  }
  if (!b.closest("#builder")) return;
  if (b.id === "bSameOk") { bld.adopted = null; renderSame(); const m = document.querySelector("#bActs button.primary"); if (m) m.focus(); return; }
  if (b.classList.contains("bSameOpen")) {
    const rid = b.dataset.rid;
    if (b.dataset.draft) act(b, { busy: "Opening the draft...", run: async () => { const x = await getJson(API + "/reports/" + encodeURIComponent(rid) + "/plan"); await openBuilder({ id: rid, type: x.type, scope: x.scope, name: x.name }); }, done: "" });
    else { closeBuilder(); openState.set(rid, {}); location.hash = "#report/" + rid; loadReport(); }
    return;
  }
  const p = bld.plan;
  if (b.id === "bLeave" && p && p.drop) { bld.leftOut = bld.leftOut.concat(p.drop.leaveOut.map((x) => ({ appId: x.appId, gl: x.gl }))); builderChanged(true); }
  else if (b.id === "bPutBack") { bld.leftOut = []; builderChanged(true); }
  else if (b.id === "bReview" && p) { document.getElementById("approval").innerHTML = reviewHtml(p); approvalDialog(); }
  else if (b.id === "bMatch") act(b, { busy: "Checking the picture matches...", status: "bStatus", run: showMatchCheck, done: "" });
  else if (b.id === "bApprove" && !isPresetType(bld.type)) {
    act(b, { busy: "Working out the numbers...", status: "bStatus", run: async () => { await ensureDraft(); await showReportApproval(bld.id); }, done: "" });
  } else if (b.id === "bApprove") {
    const st = document.getElementById("stage");
    if (st) { st.value = bld.type; st.dispatchEvent(new Event("change", { bubbles: true })); }
    goTo("analysis");
    openApproval(b, null);
  } else if (b.id === "bBuild") {
    act(b, { busy: "Building the report...", status: "bStatus",
      run: async () => {
        await ensureDraft();
        const id = isPresetType(bld.type) ? bld.opts.presets[bld.type] : bld.id;
        if (!id) throw new Error("This report is not in the list yet. Reload the page.");
        return send(API + "/reports/" + encodeURIComponent(id) + "/build", {});
      },
      done: (r) => { closeBuilder(); openState.set(r.id, {}); location.hash = "#report/" + r.id; loadReport(); return "Built a new version of \\u201c" + r.name + "\\u201d."; } });
  }
});
`;

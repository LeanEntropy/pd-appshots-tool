import { ACTION_SCRIPT } from "./action.ts";
import { page } from "./pages-html.ts";
import { appBar } from "./shell.ts";

/**
 * The knowledge base's review list (decision D8, until a Knowledge page exists): entries that can
 * drive recommendations are approved one by one; unverified entries are approved in bulk (D4).
 * Every decision is saved at once (kb/approvals.json in the tool's folder); nothing to handle by
 * hand. The list is drawn in the browser from GET /api/kb/review.
 */
const KB_REVIEW_CSS = `
.kb-item { border-top: 1px solid var(--line); padding: 10px 0; }
.kb-item:first-child { border-top: none; }
.kb-item .claim { font-weight: 700; margin: 0 0 4px; }
.kb-item .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0; }
.chip { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--tint); border: 1px solid var(--line); }
.chip.official, .chip.established { background: #e7f6ec; color: var(--ok); } .chip.corroborated { background: #eef3fd; color: var(--accent); }
.chip.unverified, .chip.contested, .chip.stale { background: #fdf0e6; color: var(--next); } .chip.enforced { background: #fde8e8; color: var(--bad); }
.kb-item details { margin: 4px 0; } .kb-item details li { margin: 4px 0; font-size: 13px; }
.kb-item .btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; align-items: center; }
.status-approved { color: var(--ok); font-weight: 700; } .status-rejected { color: var(--bad); font-weight: 700; } .status-changed, .status-pending { color: var(--next); font-weight: 700; }
`;

export const KB_REVIEW_SCRIPT = `
const KB_STATUS = { pending: "Waiting for you", approved: "Approved", rejected: "Rejected", changed: "Changed since you decided: decide again" };
function kbItemHtml(i, bulk) {
  const chips = ['<span class="chip ' + esc(i.trust) + '">' + esc(i.trustLabel) + "</span>"]
    .concat(i.ruleClass === "enforced_rule" ? ['<span class="chip enforced">Enforced store rule</span>'] : [])
    .concat(i.ruleClass === "official_guidance" ? ['<span class="chip">Official guidance, not enforced</span>'] : [])
    .concat(i.contested ? ['<span class="chip contested">Contested</span>'] : [])
    .concat(i.stale ? ['<span class="chip stale">Past its review date</span>'] : [])
    .concat(i.vendorOnly ? ['<span class="chip">Industry sources only</span>'] : [])
    .concat(['<span class="chip">' + esc(i.stores.join(", ").replace(/google_play/g, "Google Play").replace(/app_store/g, "App Store")) + " | " + esc(i.countries.join(", ")) + "</span>"]);
  const src = i.sources.map((s) => "<li>" + (/^https?:\\/\\//i.test(s.url) ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + "</a>" : esc(s.title)) + " (" + esc(s.publisher) + ", " + esc(s.published) + (s.counted ? "" : ", not counted: page not read") + (s.snapshot ? ", a researcher's snapshot of store listings: the tool's own competitor data replaces it" : "") + ")<br><em>" + esc(s.excerpt) + "</em></li>").join("");
  const counter = i.counter.map((s) => "<li>Against: " + (/^https?:\\/\\//i.test(s.url) ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title) + "</a>" : esc(s.title)) + "<br><em>" + esc(s.excerpt) + "</em></li>").join("");
  const enf = i.enforcement ? "<p class=\\"meta\\">Policy: " + esc(i.enforcement.exactWording) + " Consequence: " + esc(i.enforcement.consequence) + "</p>" : "";
  const id = "kb-" + i.id;
  const buttons = bulk ? "" : '<button type="button" class="btn primary" data-act-key="' + esc(id) + '-a" onclick="kbDecide(this, \\'' + esc(i.id) + '\\', \\'approved\\')">Approve</button><button type="button" class="btn" data-act-key="' + esc(id) + '-r" onclick="kbDecide(this, \\'' + esc(i.id) + '\\', \\'rejected\\')">Reject</button>';
  return '<div class="kb-item" id="' + esc(id) + '"><p class="claim">' + esc(i.claim) + "</p>"
    + (i.appliesWhen ? '<p class="meta">Applies when: ' + esc(i.appliesWhen) + "</p>" : "")
    + '<div class="chips">' + chips.join("") + "</div>" + enf
    + "<details><summary>" + i.sources.length + " source" + (i.sources.length === 1 ? "" : "s") + " (" + i.origins + " independent)" + (i.counter.length ? ", " + i.counter.length + " against" : "") + "</summary><ul>" + src + counter + "</ul>" + (i.note ? '<p class="meta">' + esc(i.note) + "</p>" : "") + "</details>"
    + '<div class="btns">' + buttons + '<span class="status-' + esc(i.status) + '" id="' + esc(id) + '-s">' + esc(KB_STATUS[i.status] || i.status) + '</span><p class="act-msg" id="' + esc(id) + '-m" hidden></p></div></div>';
}
function kbRender(list) {
  const el = document.getElementById("kbReview");
  const c = list.counts;
  const waitingBulk = list.bulk.filter((i) => i.status !== "approved" && i.status !== "rejected").length;
  el.innerHTML = '<p class="meta">' + c.pending + " waiting, " + c.changed + " changed since you decided, " + c.approved + " approved, " + c.rejected + " rejected.</p>"
    + (list.problems.length ? '<div class="card"><p class="warn">Problems in the imported files (these entries cannot be used until fixed):</p><ul>' + list.problems.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul></div>" : "")
    + '<section class="card"><h2>One by one: these can drive recommendations (' + list.one.length + ")</h2><p class=\\"meta\\">Official store rules and entries with 2 or more independent sources, plus every policy or regulation note.</p>"
    + (list.one.map((i) => kbItemHtml(i, false)).join("") || "<p>None yet.</p>") + "</section>"
    + '<section class="card"><h2>In bulk: unverified, test ideas only (' + list.bulk.length + ")</h2><p class=\\"meta\\">One source each. They can only inspire a labelled test idea, never a recommendation.</p>"
    + '<div class="btns"><button type="button" class="btn primary" id="kbBulk" onclick="kbBulk(this)"' + (waitingBulk ? "" : " disabled") + ">Approve all " + waitingBulk + " waiting</button></div><p class=\\"act-msg\\" id=\\"kbBulkMsg\\" hidden></p>"
    + "<details><summary>Show them</summary>" + (list.bulk.map((i) => kbItemHtml(i, false)).join("") || "<p>None.</p>") + "</details></section>";
}
async function kbLoad() { kbRender(await getJson("/api/kb/review")); }
async function kbDecide(btn, id, decision) {
  const r = await act(btn, { busy: decision === "approved" ? "Approvingâ€¦" : "Rejectingâ€¦", status: "kb-" + id + "-m",
    run: () => send("/api/kb/decision", { entryId: id, decision }), done: decision === "approved" ? "Approved. Saved." : "Rejected. Saved." });
  if (r) { const s = document.getElementById("kb-" + id + "-s"); if (s) { s.className = "status-" + decision; s.textContent = KB_STATUS[decision]; } }
}
async function kbBulk(btn) {
  const r = await act(btn, { busy: "Approving the unverified entriesâ€¦", status: "kbBulkMsg", run: () => send("/api/kb/approve-bulk", {}),
    done: (x) => x.approved + " unverified entries approved. Saved." });
  if (r) kbLoad();
}
kbLoad().catch((e) => { document.getElementById("kbReview").innerHTML = '<p class="warn">' + esc(actReason(e)) + "</p>"; });
`;

export function kbReviewPage(token: string): string {
  const body = `${appBar(null)}
<style>${KB_REVIEW_CSS}</style>
<main><h1>Knowledge base: review</h1>
<p class="meta">What the research found, before the tool may use it. Approve what can drive recommendations one by one; approve the unverified entries in bulk. Every decision is saved at once. After your review, a new release is made (npm run kb -- release) and the tool uses it only when the knowledge base is switched on in a project's Settings.</p>
<div id="kbReview"><p class="meta">Loadingâ€¦</p></div>
</main>`;
  const esc = `const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);`;
  return page(
    "Knowledge base review",
    body,
    token,
    `${ACTION_SCRIPT}\n${esc}\n${KB_REVIEW_SCRIPT}`,
  );
}

/**
 * "Layouts for earlier images" on the Analysis page (plan-layout-wireframes 2.6, user decision
 * D3): the images analysed before layouts existed that reports need first (ours, competitors'
 * positions 1-3), their count and cost, and one button that opens an approval dialog. Nothing is
 * sent to an AI model before "Approve and add layouts" in that dialog. Images whose layout failed
 * are listed with why ("N failed — why?"), and are tried again only through their own approval.
 */
export const LAYOUT_BACKFILL_SCRIPT = `
let layoutScope = null;
let layoutRetry = null;
let layoutPicked = null;
let layoutTimer = null;

function layoutWhy(list, label, retry) {
  if (!list || !list.length) return "";
  return '<details class="layout-why"><summary>' + list.length + " " + label + " \\u2014 why?</summary><ul class=\\"meta\\">"
    + list.map((f) => "<li><strong>" + esc(f.game) + "</strong> " + esc((f.where || []).join(", ")) + ": " + esc(f.reason) + " (" + money(f.usd) + " spent, " + f.calls + (f.calls === 1 ? " call" : " calls") + ")</li>").join("")
    + "</ul>"
    + (retry && retry.items.length ? '<button id="layoutRetryOpen">Try these ' + retry.items.length + " again (" + money(retry.usd[0]) + " to " + money(retry.usd[1]) + ")</button>" : "")
    + "</details>";
}

function layoutCard(s, retry, p) {
  const box = document.getElementById("layoutBackfill");
  if (!box) return;
  const head = "<h2>Layouts for earlier images</h2>";
  if (p && p.state === "running") {
    box.hidden = false;
    box.innerHTML = head + '<p class="act-msg busy" role="status">' + ACT_SPIN() + esc(p.message) + " &middot; spent " + money(p.spentUsd) + "</p>"
      + layoutWhy(p.failed, "failed", null) + '<button id="layoutStop">Stop</button>';
    return;
  }
  const failed = s ? s.failed : [];
  if ((!s || !s.items.length) && !failed.length) { box.hidden = !p; if (p) box.innerHTML = head + "<p>" + esc(p.message) + "</p>"; return; }
  box.hidden = false;
  box.innerHTML = head
    + (p ? '<p class="act-msg">' + esc(p.message) + "</p>" : "")
    + (s.items.length ? "<p><strong>" + s.items.length + " images</strong> were analysed before layouts existed: " + s.ours + " of ours and " + s.competitors + " at competitors' positions 1 to 3.</p>"
      + '<button id="layoutOpen" class="primary">Add layouts (' + money(s.usd[0]) + " to " + money(s.usd[1]) + ")</button>" : "")
    + layoutWhy(failed, "failed", retry)
    + '<p class="meta">A separate AI call per image; the analyses themselves never change. Shows the list first; nothing runs before you approve.</p>';
}

async function loadLayoutBackfill() {
  try {
    const r = await getJson(API + "/layout-backfill");
    layoutScope = r.scope;
    layoutRetry = r.retry;
    layoutCard(r.scope, r.retry, r.progress);
    clearTimeout(layoutTimer);
    if (r.progress && r.progress.state === "running") layoutTimer = setTimeout(loadLayoutBackfill, 2000);
  } catch { /* the card stays hidden */ }
}

function layoutApproval(s) {
  if (!s) return;
  layoutPicked = s;
  approvalDialog();
  const games = {};
  for (const it of s.items) games[it.game] = (games[it.game] || 0) + 1;
  const why = {};
  for (const f of s.failed) why[f.imageId] = f.reason;
  const title = s.retryFailed ? "Try again the " + s.items.length + " images whose layout failed?" : "Add layouts to " + s.items.length + " earlier images?";
  document.getElementById("approval").innerHTML = '<h3 id="approvalTitle">' + title + "</h3>"
    + '<p class="big"><strong>' + s.items.length + " images will be sent to AI</strong>, one layout call each (3 at a time; a rejected answer is asked again, up to 3 calls). Estimated cost: <strong>" + money(s.usd[0]) + " to " + money(s.usd[1]) + "</strong>; it stops at " + money(s.limitUsd) + ".</p>"
    + '<p class="meta">About ' + money(s.perImageUsd[0]) + " to " + money(s.perImageUsd[1]) + " per image, " + esc(s.basis) + ".</p>"
    + "<ul>" + Object.entries(games).map(([g, n]) => "<li>" + esc(g) + ": " + n + "</li>").join("") + "</ul>"
    + '<details><summary>Every image</summary><ul class="meta">' + s.items.map((it) => "<li>" + esc(it.game) + " " + esc(it.where.join(", ")) + (why[it.imageId] ? " \\u2014 failed before: " + esc(why[it.imageId]) : "") + "</li>").join("") + "</ul></details>"
    + '<div class="actions"><button id="layoutApprove" class="primary">' + (s.retryFailed ? "Approve and try again" : "Approve and add layouts") + '</button><button id="cancelApproval">Cancel</button></div>';
}

async function layoutApprove() {
  const s = layoutPicked;
  if (!s) return;
  try { await send(API + "/layout-backfill", { scopeHash: s.scopeHash, retryFailed: s.retryFailed }); }
  catch (e) { approvalDialog("The layouts did not start: " + actReason(e), "bad"); return; }
  closeApproval();
  await loadLayoutBackfill();
}

document.addEventListener("click", (e) => {
  if (e.target.id === "layoutOpen") layoutApproval(layoutScope);
  if (e.target.id === "layoutRetryOpen") layoutApproval(layoutRetry);
  if (e.target.id === "layoutApprove") act(e.target, { busy: "Starting...", keep: true, run: layoutApprove });
  if (e.target.id === "layoutStop") act(e.target, { busy: "Stopping after the images in progress...", run: () => send(API + "/layout-backfill/stop", {}).then(loadLayoutBackfill) });
});
if (location.protocol.startsWith("http")) loadLayoutBackfill();
`;

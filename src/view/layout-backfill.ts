/**
 * "Layouts for earlier images" on the Analysis page (plan-layout-wireframes 2.6, user decision
 * D3): the images analysed before layouts existed that reports need first (ours, competitors'
 * positions 1-3), their count and cost, and one button that opens an approval dialog. Nothing is
 * sent to an AI model before "Approve and add layouts" in that dialog.
 */
export const LAYOUT_BACKFILL_SCRIPT = `
let layoutScope = null;
let layoutTimer = null;

function layoutCard(s, p) {
  const box = document.getElementById("layoutBackfill");
  if (!box) return;
  if (p && p.state === "running") {
    box.hidden = false;
    box.innerHTML = "<h2>Layouts for earlier images</h2>" + '<p class="act-msg busy" role="status">' + ACT_SPIN() + esc(p.message) + " &middot; spent " + money(p.spentUsd) + '</p><button id="layoutStop">Stop</button>';
    return;
  }
  if (!s || !s.items.length) { box.hidden = !p; if (p) box.innerHTML = "<h2>Layouts for earlier images</h2><p>" + esc(p.message) + "</p>"; return; }
  box.hidden = false;
  box.innerHTML = "<h2>Layouts for earlier images</h2>"
    + (p ? '<p class="act-msg">' + esc(p.message) + "</p>" : "")
    + "<p><strong>" + s.items.length + " images</strong> were analysed before layouts existed: " + s.ours + " of ours and " + s.competitors + " at competitors' positions 1 to 3.</p>"
    + '<button id="layoutOpen" class="primary">Add layouts (' + money(s.usd[0]) + " to " + money(s.usd[1]) + ")</button>"
    + '<p class="meta">A separate AI call per image; the analyses themselves never change. Shows the list first; nothing runs before you approve.</p>';
}

async function loadLayoutBackfill() {
  try {
    const r = await getJson(API + "/layout-backfill");
    layoutScope = r.scope;
    layoutCard(r.scope, r.progress);
    clearTimeout(layoutTimer);
    if (r.progress && r.progress.state === "running") layoutTimer = setTimeout(loadLayoutBackfill, 2000);
  } catch { /* the card stays hidden */ }
}

function layoutApproval() {
  const s = layoutScope;
  if (!s) return;
  approvalDialog();
  const games = {};
  for (const it of s.items) games[it.game] = (games[it.game] || 0) + 1;
  document.getElementById("approval").innerHTML = '<h3 id="approvalTitle">Add layouts to ' + s.items.length + " earlier images?</h3>"
    + '<p class="big"><strong>' + s.items.length + " images will be sent to AI</strong>, one layout call each (3 at a time). Estimated cost: <strong>" + money(s.usd[0]) + " to " + money(s.usd[1]) + "</strong>; it stops at " + money(s.usd[1]) + ".</p>"
    + "<ul>" + Object.entries(games).map(([g, n]) => "<li>" + esc(g) + ": " + n + "</li>").join("") + "</ul>"
    + '<details><summary>Every image</summary><ul class="meta">' + s.items.map((it) => "<li>" + esc(it.game) + " " + esc(it.where.join(", ")) + "</li>").join("") + "</ul></details>"
    + '<div class="actions"><button id="layoutApprove" class="primary">Approve and add layouts</button><button id="cancelApproval">Cancel</button></div>';
}

async function layoutApprove() {
  if (!layoutScope) return;
  try { await send(API + "/layout-backfill", { scopeHash: layoutScope.scopeHash }); }
  catch (e) { approvalDialog("The layouts did not start: " + actReason(e), "bad"); return; }
  closeApproval();
  await loadLayoutBackfill();
}

document.addEventListener("click", (e) => {
  if (e.target.id === "layoutOpen") layoutApproval();
  if (e.target.id === "layoutApprove") act(e.target, { busy: "Starting...", keep: true, run: layoutApprove });
  if (e.target.id === "layoutStop") act(e.target, { busy: "Stopping after the images in progress...", run: () => send(API + "/layout-backfill/stop", {}).then(loadLayoutBackfill) });
});
if (location.protocol.startsWith("http")) loadLayoutBackfill();
`;

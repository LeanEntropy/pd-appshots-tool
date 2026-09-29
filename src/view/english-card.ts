/**
 * "English for marketing texts" on the Analysis page (plan-games-library I1b): how many texts of
 * the analysed pictures have no English yet, the cost, and one button that opens the approval
 * dialog. Nothing is sent to an AI model before "Approve and add English" in that dialog.
 */
export const ENGLISH_CARD_SCRIPT = `
let englishScopeNow = null;
let englishTimer = null;

function englishCard(s, p) {
  const box = document.getElementById("englishTexts");
  if (!box) return;
  if (p && p.state === "running") {
    box.hidden = false;
    box.innerHTML = "<h2>English for marketing texts</h2>" + '<p class="act-msg busy" role="status">' + ACT_SPIN() + esc(p.message) + " &middot; spent " + money(p.spentUsd) + '</p><progress max="' + p.total + '" value="' + p.done + '"></progress> <button id="englishStop">Stop</button>';
    return;
  }
  if (!s || !s.texts) { box.hidden = !p; if (p) box.innerHTML = "<h2>English for marketing texts</h2><p>" + esc(p.message) + "</p>"; return; }
  box.hidden = false;
  box.innerHTML = "<h2>English for marketing texts</h2>"
    + (p ? '<p class="act-msg">' + esc(p.message) + "</p>" : "")
    + "<p><strong>" + s.texts + " texts</strong> on " + s.pictures + " analysed pictures have no English saved yet (image pages say \\"English not saved yet\\").</p>"
    + '<button id="englishOpen" class="primary">Add English for ' + s.texts + " texts (" + money(s.usd[0]) + " to " + money(s.usd[1]) + ")</button>"
    + '<p class="meta">Text only (no pictures), ' + s.calls + " small AI " + (s.calls === 1 ? "call" : "calls") + ". Saved once per text, so the same words are never paid for twice. Shows the list first; nothing runs before you approve.</p>";
}

async function loadEnglish() {
  try {
    const r = await getJson(API + "/english");
    englishScopeNow = r.scope;
    englishCard(r.scope, r.progress);
    clearTimeout(englishTimer);
    if (r.progress && r.progress.state === "running") englishTimer = setTimeout(loadEnglish, 2000);
  } catch { /* the card stays hidden */ }
}

function englishApproval() {
  const s = englishScopeNow;
  if (!s) return;
  approvalDialog();
  const langs = {};
  for (const it of s.items) langs[it.language] = (langs[it.language] || 0) + 1;
  document.getElementById("approval").innerHTML = '<h3 id="approvalTitle">Add English to ' + s.texts + " texts?</h3>"
    + '<p class="big"><strong>' + s.texts + " texts will be sent to AI</strong> (text only, no pictures), " + s.calls + " " + (s.calls === 1 ? "call" : "calls") + " of up to 40 texts. Estimated cost: <strong>" + money(s.usd[0]) + " to " + money(s.usd[1]) + "</strong>; it stops at " + money(s.limitUsd) + ".</p>"
    + "<ul>" + Object.entries(langs).map(([l, n]) => "<li>" + esc(l) + ": " + n + " texts</li>").join("") + "</ul>"
    + '<details><summary>Every text</summary><ul class="meta">' + s.items.map((it) => "<li>[" + esc(it.language) + "] " + esc(it.text) + "</li>").join("") + (s.more ? "<li>... and " + s.more + " more</li>" : "") + "</ul></details>"
    + '<div class="actions"><button id="englishApprove" class="primary">Approve and add English</button><button id="cancelApproval">Cancel</button></div>';
}

async function englishApprove() {
  if (!englishScopeNow) return;
  try { await send(API + "/english", { scopeHash: englishScopeNow.scopeHash }); }
  catch (e) { approvalDialog("The English step did not start: " + actReason(e), "bad"); return; }
  closeApproval();
  await loadEnglish();
}

document.addEventListener("click", (e) => {
  if (e.target.id === "englishOpen") englishApproval();
  if (e.target.id === "englishApprove") act(e.target, { busy: "Starting...", keep: true, run: englishApprove });
  if (e.target.id === "englishStop") act(e.target, { busy: "Stopping after the texts in progress...", run: () => send(API + "/english/stop", {}).then(loadEnglish) });
});
if (location.protocol.startsWith("http")) loadEnglish();
`;

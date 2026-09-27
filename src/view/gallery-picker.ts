/**
 * Core competitor picker: ordered list with pointer drag (mouse and touch) and keyboard moves,
 * live whole-deck count, and autosave to the local gallery server (npm run gallery).
 * Opened from a plain file, it stays read-only and says how to open it with saving.
 */
export const PICKER_SCRIPT = `
const named = new Map(DATA.named.map((a) => [a.appId, a]));
const ourLen = DATA.ours[0] ? DATA.ours[0].analysedLength : 0;
const ourWhole = DATA.ours[0] ? DATA.ours[0].baselineLength : 0;
const canSave = location.protocol === "http:" || location.protocol === "https:";
let saveTimer = null;
let saveChain = Promise.resolve();
let revision = 0;
let touched = false;
let saveState = canSave ? "" : "Read-only. To save your pick, open this page with: npm run gallery";

// Same whole-deck rule as the tool (src/core/fit.ts). The server's answer is authoritative.
function fit() {
  let total = ourLen; const kept = []; const skipped = [];
  for (const id of selection) {
    const a = named.get(id); const n = a ? a.analysedLength : 0;
    if (kept.length >= DATA.core.max) skipped.push([id, "the maximum number of decks is reached"]);
    else if (n <= 0) skipped.push([id, "no English deck"]);
    else if (total + n > DATA.core.cap) skipped.push([id, "does not fit within the cap"]);
    else { kept.push(id); total += n; }
  }
  return { total, kept, skipped, ok: kept.length >= DATA.core.min };
}

function setSelection(next) {
  selection = next;
  touched = true;
  // A different pick means a different batch: any approval panel shown before is withdrawn.
  if (typeof shownPlan !== "undefined" && shownPlan) { shownPlan = null; const ap = document.getElementById("approval"); if (ap) ap.textContent = "The pick changed. Press Start analysis again to see the new numbers."; }
  document.querySelectorAll("input[data-id]").forEach((el) => { el.checked = selection.includes(el.dataset.id); });
  renderPanel();
  renderGrid();
  scheduleSave();
}

function scheduleSave() {
  if (!canSave) return;
  saveState = "Saving...";
  renderSaveState();
  clearTimeout(saveTimer);
  // Saves run one after another in order, so an older save can never overwrite a newer one.
  saveTimer = setTimeout(() => { const rev = ++revision; const snapshot = selection.slice(); saveChain = saveChain.then(() => save(snapshot, rev)); }, 300);
}

async function save(snapshot, rev) {
  try {
    const r = await apiPost("/api/selection", { coreCompetitors: snapshot });
    if (rev !== revision) return;
    saveState = r.ok ? "Saved. " + r.body.summary : "Not saved: " + (r.body.problems || ["unknown problem"]).join(" ");
  } catch {
    saveState = "Not saved: the gallery server is not running. Start it with: npm run gallery";
  }
  renderSaveState();
}

async function loadSaved() {
  const box = document.getElementById("analysisBox");
  if (box && !canSave) box.innerHTML = '<h2>Analysis</h2><p class="meta">Analysis starts from this page only when it is opened with: npm run gallery</p>';
  if (!canSave) { renderSaveState(); return; }
  try {
    const res = await fetch("/api/selection");
    if (res.ok && !touched) { const body = await res.json(); selection = body.coreCompetitors; render(); saveState = "Loaded your saved pick. " + body.summary; }
  } catch {}
  renderSaveState();
}

function renderSaveState() {
  const el = document.getElementById("saveStatus");
  if (el) el.textContent = saveState;
}

function move(from, to) {
  if (to < 0 || to >= selection.length || from === to) return;
  const next = selection.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  setSelection(next);
  const li = document.querySelector('#order li[data-index="' + to + '"]');
  if (li) li.focus();
}

function renderPanel() {
  const f = fit();
  const rows = selection.map((id, i) => {
    const a = named.get(id); const skip = f.skipped.find((s) => s[0] === id);
    return '<li tabindex="0" data-index="' + i + '"' + (skip ? ' class="skip"' : "") + ' aria-label="' + esc((a ? a.name : id) + ", position " + (i + 1)) + '"><span class="grip" aria-hidden="true">&#8801;</span><span class="nm">' + esc(a ? a.name : id) + " (" + (a ? a.analysedLength : 0) + ")" + (skip ? " &ndash; " + skip[1] : "") + '</span><button data-remove="' + i + '" aria-label="Remove">Remove</button></li>';
  }).join("");
  const status = f.ok ? "Ready" : "Needs at least " + DATA.core.min + " whole competitor decks";
  const whole = f.kept.reduce((n, id) => n + (named.get(id) ? named.get(id).baselineLength : 0), ourWhole);
  const wholeNote = whole !== f.total ? " Whole decks including tablet-shaped: " + whole + "." : "";
  document.getElementById("panel").innerHTML = "<h2>Core check</h2><p>Our deck " + ourLen + " + " + f.kept.length + " competitor decks = <strong>" + f.total + "</strong> images analysed (target about " + DATA.core.target + ", hard stop " + DATA.core.cap + "). " + status + "." + wholeNote + '</p><p class="meta">Drag to reorder, or focus a name and press Alt+Up / Alt+Down. Changes save automatically.</p><ol id="order">' + rows + '</ol><p id="saveStatus" class="meta" role="status"></p>';
  renderSaveState();
}

document.addEventListener("click", (e) => {
  const r = e.target.dataset && e.target.dataset.remove;
  if (r !== undefined) setSelection(selection.filter((_, i) => i !== Number(r)));
});

document.addEventListener("keydown", (e) => {
  const li = e.target.closest && e.target.closest("#order li");
  if (!li || !e.altKey) return;
  const i = Number(li.dataset.index);
  if (e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1); }
  if (e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1); }
});

// Pointer drag works for mouse, pen and touch. Items move in the page while dragging;
// the new order is saved once on release.
let drag = null;
document.addEventListener("pointerdown", (e) => {
  const li = e.target.closest && e.target.closest("#order li");
  if (!li || e.target.dataset.remove !== undefined) return;
  drag = { li, id: e.pointerId };
  li.classList.add("dragging");
  li.setPointerCapture(e.pointerId);
  e.preventDefault();
});
document.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const list = drag.li.parentElement;
  const after = [...list.children].find((c) => c !== drag.li && e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
  list.insertBefore(drag.li, after || null);
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const order = [...drag.li.parentElement.children].map((c) => selection[Number(c.dataset.index)]);
  drag.li.classList.remove("dragging");
  drag = null;
  if (order.join() !== selection.join()) setSelection(order);
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
`;

/**
 * The pixel check's one-click block in the picture-match questions (plan-analysis-speed item 8,
 * suggest mode): the pairs it calls "same picture, new text" (and the full analyses it would turn
 * into text comparisons) as one compact block with a thumbnail strip, "Confirm all as same" (one
 * request, POST reports/match-check/pairs) and a "Review one by one" disclosure with the changed
 * areas outlined. Answers given here are kept for the session so they can be undone or changed
 * pair by pair. In automatic mode the decided pairs are listed folded, each can be re-opened.
 * Used by the report approval (ctx "r:<report id>") and the builder's match check (ctx "m").
 * Only unanswered pairs are ever grouped: the user's saved answers always win.
 */
export const PAIR_GROUP_CSS = `
#approvalDlg .pgroup { background: var(--a-green); border-radius: 10px; padding: 10px 14px; margin: 10px 0; }
#approvalDlg .pgroup.done { background: var(--a-grey); } #approvalDlg .pgroup.decided { background: var(--a-blue); }
#approvalDlg .pgroup summary { cursor: pointer; font-weight: 600; padding: 4px 0; }
#approvalDlg .pg-h { font-size: 16px; margin: 0 0 4px; }
#approvalDlg .pstrip { display: flex; flex-wrap: wrap; gap: 4px; margin: 8px 0; align-items: center; }
#approvalDlg .pstrip .pimg img { height: 44px; width: auto; max-width: 80px; }
#approvalDlg .pstrip .more { font-size: 13px; color: var(--muted); margin-left: 4px; }
#approvalDlg .pimg { position: relative; display: inline-block; line-height: 0; flex: none; }
#approvalDlg .pimg img, #approvalDlg .pair .pimg img { display: block; width: auto; height: auto; max-width: 110px; max-height: 130px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); object-fit: fill; }
#approvalDlg .parea { position: absolute; border: 2px solid #e11d48; box-sizing: border-box; pointer-events: none; }
#approvalDlg .pgroup .pair { border-bottom: 1px solid var(--a-div); }
#approvalDlg .pgroup .pair:last-child { border-bottom: none; }
#approvalDlg .pair > div { flex: 1 1 200px; min-width: 0; }
#approvalDlg .pg-acts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 6px 0; }
#approvalDlg .pg-acts .primary { font-size: 15px; padding: 8px 16px; }
@media (max-width: 520px) { #approvalDlg .pg-acts .primary { width: 100%; } }
`;

export const PAIR_GROUP_SCRIPT = `
// ctx -> Map(pair key -> { pair, same }): answers given in these blocks this session (Undo, Change).
const pgSession = new Map();
// ctx -> Map(pair key -> pair): every pair the blocks show now (the buttons find their pair here).
const pgPairs = new Map();
// ctx -> the pairs "Confirm all" answers now.
const pgBlock = new Map();

const pgKey = (x) => x.image.id + "|" + x.anchor.id;
const pgPct = (v) => (Math.round(Number(v || 0) * 1000) / 10) + "%";
const pgInGroup = (x) => x.group === "same-new-text" || x.group === "moved";
function pgAnswered(ctx) { return new Set((pgSession.get(ctx) || new Map()).keys()); }
function pgNote(ctx, list) { const m = pgPairs.get(ctx) || new Map(); for (const x of list) m.set(pgKey(x), x); pgPairs.set(ctx, m); }

function pgThumb(t, alt, areas) {
  if (!t) return "";
  const n = (v) => Math.max(0, Math.min(100, Number(v) || 0));
  const boxes = (areas || []).map((a) => '<span class="parea" style="left:' + n(a.x) + "%;top:" + n(a.y) + "%;width:" + n(a.w) + "%;height:" + n(a.h) + '%"></span>').join("");
  return '<span class="pimg"><img src="' + IMG + esc(t) + '" alt="' + esc(alt) + '" loading="lazy">' + boxes + "</span>";
}

// The two pictures of a pair: the analysed one, then the country one with its changed areas.
function pgPictures(x) {
  return pgThumb(x.anchor.thumb, "the analysed picture") + pgThumb(x.image.thumb, x.game + " in " + x.country, x.pixel ? x.pixel.areas : []);
}

// What the pixel check found, in one plain sentence (empty when it did not run).
function pgChanged(x) {
  const p = x.pixel;
  if (!p) return "";
  const where = p.outside > 0.0005 ? pgPct(p.outside) + " of the picture changed outside the text and band" : "changes only in the text or band";
  return " Free pixel check: " + where + (p.areas && p.areas.length ? " (outlined)" : "") + ".";
}

function pgButtons(ctx, x, labels) {
  const btn = (same, label) => '<button type="button" class="pg-one" data-ctx="' + esc(ctx) + '" data-key="' + esc(pgKey(x)) + '" data-same="' + same + '" data-act-key="pg-' + esc(ctx + "-" + pgKey(x) + "-" + same) + '">' + esc(label) + "</button>";
  return labels.map(([same, label]) => btn(same, label)).join(" ");
}

function pgRow(ctx, x, answer) {
  const head = "<strong>" + esc(x.game) + "</strong>, position " + x.position + " in " + esc(theCountryOf(x.country)) + "." + esc(pgChanged(x));
  const moved = x.group === "moved" ? " Without your answer it gets a full analysis." : "";
  const btns = answer === undefined
    ? pgButtons(ctx, x, [[true, "Same screen"], [false, "Different screens"]])
    : "Your answer: <strong>" + (answer ? "same screen" : "different screens") + "</strong>. " + pgButtons(ctx, x, [[!answer, answer ? "Change to different screens" : "Change to same screen"]]);
  return '<div class="pair">' + pgPictures(x) + "<div>" + head + esc(moved) + "<br>" + btns + "</div></div>";
}

// The one-click block: the grouped pairs not answered yet (in this session or before).
function pgGroupHtml(ctx, pairs) {
  const done = pgAnswered(ctx);
  const list = pairs.filter((x) => pgInGroup(x) && !done.has(pgKey(x)));
  pgBlock.set(ctx, list);
  pgNote(ctx, list);
  if (!list.length) return "";
  const moved = list.filter((x) => x.group === "moved").length;
  const strip = list.slice(0, 12).map((x) => pgThumb(x.image.thumb, x.game + " position " + x.position + " in " + x.country)).join("") + (list.length > 12 ? '<span class="more">+' + (list.length - 12) + " more</span>" : "");
  const n = list.length;
  return '<div class="pgroup"><p class="pg-h"><strong>' + n + (n === 1 ? " pair looks" : " pairs look") + " like the same picture with new text</strong></p>"
    + '<p class="meta">The free pixel check found that little or nothing changed outside the text and the band. Confirmed pairs get a cheap text comparison instead of a full analysis.' + (moved ? " " + moved + " of them would otherwise get a full analysis." : "") + "</p>"
    + '<div class="pstrip">' + strip + "</div>"
    + '<div class="pg-acts"><button type="button" class="primary pg-all" data-ctx="' + esc(ctx) + '" data-act-key="pg-all-' + esc(ctx) + '">Confirm all ' + n + " as same</button></div>"
    + "<details><summary>Review one by one</summary>" + list.map((x) => pgRow(ctx, x)).join("") + "</details></div>";
}

// The answers given in these blocks this session: Undo all, or change one.
function pgDoneHtml(ctx) {
  const m = pgSession.get(ctx);
  if (!m || !m.size) return "";
  const all = [...m.values()];
  pgNote(ctx, all.map((e) => e.pair));
  const same = all.filter((e) => e.same).length;
  const diff = all.length - same;
  return '<div class="pgroup done"><p class="pg-acts"><span>Saved: <strong>' + same + (same === 1 ? " pair" : " pairs") + "</strong> confirmed as the same picture" + (diff ? ", " + diff + " marked as different screens" : "") + '.</span><button type="button" class="pg-undo" data-ctx="' + esc(ctx) + '" data-act-key="pg-undo-' + esc(ctx) + '">Undo</button></p>'
    + "<details><summary>Show or change one</summary>" + all.map((e) => pgRow(ctx, e.pair, e.same)).join("") + "</details></div>";
}

// Automatic mode: the pairs the pixel check decided, folded; each can be answered.
function pgDecidedHtml(ctx, pairs) {
  const done = pgAnswered(ctx);
  const list = pairs.filter((x) => x.group === "decided" && !done.has(pgKey(x)));
  pgNote(ctx, list);
  if (!list.length) return "";
  return '<details class="pgroup decided"><summary>Decided by the pixel check: ' + list.length + (list.length === 1 ? " pair" : " pairs") + " treated as the same picture with new text (show)</summary>" + list.map((x) => pgRow(ctx, x)).join("") + "</details>";
}

function pgRemember(ctx, list, same) {
  const m = pgSession.get(ctx) || new Map();
  for (const x of list) m.set(pgKey(x), { pair: x, same });
  pgSession.set(ctx, m);
}

async function pgRefresh(ctx) {
  if (ctx === "m") { await showMatchCheck(); builderChanged(false); }
  else await showReportApproval(ctx.slice(2));
}

const pgSend = (list, same) => send(API + "/reports/match-check/pairs", { pairs: list.map((x) => ({ image: x.image.id, anchor: x.anchor.id, same })) });

// One save at a time per dialog: a click while one is saving says so and does nothing else.
const pgBusy = new Set();
function pgRun(ctx, b, o) {
  if (pgBusy.has(ctx)) { toast("Still saving your previous answer. Try again in a moment."); return; }
  pgBusy.add(ctx);
  Promise.resolve(act(b, o)).finally(() => pgBusy.delete(ctx));
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button");
  if (!b || !b.dataset.ctx) return;
  const ctx = b.dataset.ctx;
  if (b.classList.contains("pg-all")) {
    const list = (pgBlock.get(ctx) || []).slice();
    if (!list.length) return;
    pgRun(ctx, b, { busy: "Saving " + list.length + " answers...", run: async () => { await pgSend(list, true); pgRemember(ctx, list, true); await pgRefresh(ctx); },
      done: "Saved: " + list.length + (list.length === 1 ? " pair" : " pairs") + " confirmed as the same picture. You can undo this in the dialog." });
  } else if (b.classList.contains("pg-one")) {
    const x = (pgPairs.get(ctx) || new Map()).get(b.dataset.key);
    if (!x) return;
    const same = b.dataset.same === "true";
    pgRun(ctx, b, { busy: "Saving your answer...", run: async () => { await pgSend([x], same); pgRemember(ctx, [x], same); await pgRefresh(ctx); }, done: "Saved. The numbers use your answer." });
  } else if (b.classList.contains("pg-undo")) {
    const list = [...(pgSession.get(ctx) || new Map()).values()].map((v) => v.pair);
    if (!list.length) return;
    pgRun(ctx, b, { busy: "Undoing...", run: async () => { await pgSend(list, null); pgSession.delete(ctx); await pgRefresh(ctx); },
      done: "Undone: " + list.length + (list.length === 1 ? " pair is" : " pairs are") + " open again." });
  }
});
`;

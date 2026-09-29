/**
 * The Reports tab's cards (user design, 2026-09-29): one card per report type, side by side and
 * wrapping by width. The Full check first, then Compare countries and one card per single-country
 * report country (flag in the title) by their newest report, and the Pilot always last. A card
 * shows its title, the date and status of the report picked (the newest by default), a dropdown
 * of its reports when it has more than one, and Open. The cards only choose what to read: the one
 * report opened is drawn below them (report-list.ts). The last opened report is kept per project
 * in this browser, and the URL hash names it (#report/<id>) so a reload keeps it.
 * The "What next?" options (gallery-expand.ts) follow as cards in a different colour.
 */
const S = 'section[data-page="report"]';

export const REPORT_CARDS_CSS = `
${S} .rtypes { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 10px; margin: 0 0 12px; }
${S} .rtcard { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--a-div, var(--line)); background: var(--a-surface, var(--card)); }
${S} .rtcard.is-open { border-color: var(--a-accent, var(--accent)); box-shadow: inset 0 0 0 1px var(--a-accent, var(--accent)); }
${S} .rtcard.rt-act { border-color: transparent; background: var(--a-teal, var(--tint)); }
${S} .rt-top { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
${S} .rtcard h4 { margin: 0; min-width: 0; font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--a-h, var(--text)); overflow-wrap: anywhere; }
${S} .rtcard h4 .cty { white-space: normal; }
${S} .rtcard.rt-act .rt-top { flex-direction: column-reverse; align-items: flex-start; gap: 4px; }
${S} .rtcard .pill, ${S} .rtcard .chip { flex: none; font-size: 11.5px; padding: 1px 8px; white-space: nowrap; }
${S} .rt-date, ${S} .rtcard .why { margin: 0; font-size: 12.5px; line-height: 1.4; color: var(--muted); }
${S} .rtcard select { width: 100%; max-width: 100%; font-size: 13px; padding: 3px 4px; border-radius: 6px; }
${S} .rt-acts { margin-top: auto; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
${S} .rtcard details.offer-more > summary { cursor: pointer; font-size: 12.5px; color: var(--muted); }
${S} .rtcard details.offer-more p { margin: 4px 0; font-size: 12.5px; }
${S} .rt-more { margin: -4px 0 12px; }
`;

export const REPORT_CARDS_SCRIPT = `
// The report drawn below the cards, and each card's dropdown choice (card key -> report id).
let openRid = null;
let cardsReady = false;
const cardPick = {};
const OPEN_KEY = "ssr.report.open:" + API;
const STATUS_WORD = { draft: "Draft", partial: "Partial", ready: "Ready", running: "Running", none: "Not written yet" };
const cardKey = (r) => (r.type === "country" ? "country:" + ((r.markets || [])[0] || "") : r.type);

// One group per card, each with its reports newest first (the list's own order): the Full check
// first, the others by their newest report, the Pilot last.
function typeGroups(list) {
  const groups = [];
  const byKey = {};
  for (const r of list) {
    const k = cardKey(r);
    if (!byKey[k]) { byKey[k] = { key: k, type: r.type, reports: [] }; groups.push(byKey[k]); }
    byKey[k].reports.push(r);
  }
  const rank = (g) => (g.type === "core" ? 0 : g.type === "pilot" ? 2 : 1);
  return groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
}

// The report to show when none is asked for: the newest one (the list's order: drafts, then by
// date), the Pilot only when it is the only one.
function defaultRid(list) {
  const r = list.find((x) => x.type !== "pilot") || list[0];
  return r ? r.id : null;
}

function rememberedRid() { try { return localStorage.getItem(OPEN_KEY); } catch { return null; } }
function rememberOpen(rid) {
  try { if (rid) localStorage.setItem(OPEN_KEY, rid); else localStorage.removeItem(OPEN_KEY); } catch {}
  try { if (typeof history !== "undefined" && pageFromHash(location.hash) === "report") history.replaceState(null, "", rid ? "#report/" + rid : "#report"); } catch {}
}
// The shown report is gone (deleted or archived): the next one is chosen on the next render.
function forgetOpen(rid) { if (openRid === rid) { openRid = null; rememberOpen(null); } }

// Which report to draw: the one the link asks for, the one shown, the one kept, or the default.
function chooseOpen(visible, deep) {
  const has = (id) => !!id && visible.some((r) => r.id === id);
  const rid = has(deep) ? deep : has(openRid) ? openRid : has(rememberedRid()) ? rememberedRid() : defaultRid(visible);
  rememberOpen(rid);
  return rid;
}

function cardTitle(g) {
  const r = g.reports[0];
  return g.type === "country" ? countryLabel((r.markets || [])[0], (r.countryNames || [])[0]) : esc(r.typeName);
}
const statusWord = (r) => (r.archived ? "Archived" : STATUS_WORD[r.status.kind] || r.status.text);
const cardDate = (r) => (r.generatedAt ? rowDate(r.generatedAt) : "Not generated yet");

function typeCardHtml(g) {
  const ids = g.reports.map((r) => r.id);
  const pick = ids.includes(cardPick[g.key]) ? cardPick[g.key] : ids.includes(openRid) ? openRid : ids[0];
  const r = g.reports.find((x) => x.id === pick);
  const k = rsafe(g.key.replace(":", "-"));
  const sel = g.reports.length > 1
    ? '<label><span class="sr">Which report</span><select class="rt-sel" data-group="' + esc(g.key) + '">' + g.reports.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === pick ? " selected" : "") + ">"
      + esc([shortTitle(x), cardDate(x), statusWord(x)].join(" \\u00b7 ")) + "</option>").join("") + "</select></label>"
    : "";
  return '<div class="rtcard ' + (TYPE_CLS[r.type] || "") + (ids.includes(openRid) ? " is-open" : "") + '" data-group="' + esc(g.key) + '"' + (ids.includes(openRid) ? ' aria-current="true"' : "") + ">"
    + '<div class="rt-top"><h4>' + cardTitle(g) + "</h4>" + pill(STATUS_CLS[r.status.kind] || "none", statusWord(r)) + "</div>"
    + '<p class="rt-date">' + esc(cardDate(r)) + "</p>" + sel
    + '<div class="rt-acts"><button type="button" class="rt-open' + (pick === openRid ? "" : " primary") + '" data-rid="' + rsafe(pick) + '" data-act-key="rt-open-' + k + '">Open</button></div></div>';
}

// The cards row: one card per report type, then the "What next?" options (another colour).
function renderCards() {
  const box = document.getElementById("reportCards");
  if (!box || !cardsReady) return;
  const archived = reportList.filter((r) => r.archived).length;
  const shown = reportList.filter((r) => showArchived || !r.archived);
  const next = typeof whatNextCards === "function" ? whatNextCards() : "";
  box.innerHTML = (shown.length || next ? '<div class="rtypes">' + typeGroups(shown).map(typeCardHtml).join("") + next + "</div>" : "")
    + (shown.length ? "" : '<p class="meta">No reports yet. The Pilot appears here after its first run from the Analysis page.</p>')
    + (archived ? '<p class="rt-more"><button type="button" class="linkbtn" id="toggleArchived">' + (showArchived ? "Hide archived" : "Show archived (" + archived + ")") + "</button></p>" : "");
}

// Opens a report below the cards (from a card's Open): drawn, loaded, kept and scrolled to.
async function openReport(rid) {
  openRid = rid;
  rememberOpen(rid);
  const loading = renderReportList();
  const c = document.getElementById("rc-" + rid);
  if (c && c.scrollIntoView) c.scrollIntoView({ block: "start", behavior: "smooth" });
  await loading;
}

document.addEventListener("change", (e) => {
  if (!e.target.classList || !e.target.classList.contains("rt-sel")) return;
  cardPick[e.target.dataset.group] = e.target.value;
  renderCards();
  const s = document.querySelector('.rt-sel[data-group="' + e.target.dataset.group + '"]');
  if (s && s.focus) s.focus();
});

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button.rt-open");
  if (!b) return;
  const rid = b.dataset.rid;
  const r = reportList.find((x) => x.id === rid);
  if (!r) return;
  act(b, { busy: "Opening...", status: "reportStatus", run: () => openReport(rid), done: "Showing \\u201c" + r.name + "\\u201d below." });
});
`;

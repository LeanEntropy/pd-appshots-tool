/**
 * The Reports tab's cards (user design, 2026-09-29): one card per report type, side by side and
 * wrapping by width. The Full check first, then Compare countries, then one card per single-country
 * report country (flag in the title) in the newest comparison's country order (the rest by their
 * newest report), and the Pilot always last; the action cards after them. A card
 * shows its title, the date and status of the report picked (the newest by default), a meta line
 * (its competitor count; for Compare countries, the Full check and the Pilot also the flags of its
 * countries, named in tooltips), a dropdown of its reports when it has more than one, and Open
 * ("Showing", disabled, for the report drawn below). The cards only choose what to read: the one
 * report opened is drawn below them (report-list.ts). The last opened report is kept per project
 * in this browser, and the URL hash names it (#report/<id>) so a reload keeps it.
 * The "What next?" options (gallery-expand.ts) follow as cards in a different colour.
 */
const S = 'section[data-page="report"]';

export const REPORT_CARDS_CSS = `
${S} .rtypes { display: grid; align-items: start; grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr)); gap: 10px; margin: 0 0 12px; }
${S} .rtcard { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--a-div, var(--line)); background: var(--a-surface, var(--card)); }
${S} .rtcard.is-open { border-color: var(--a-accent, var(--accent)); box-shadow: inset 0 0 0 1px var(--a-accent, var(--accent)); }
${S} .rtcard.rt-act { border-color: transparent; background: var(--a-teal, var(--tint)); }
${S} .rt-top { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
${S} .rtcard h4 { margin: 0; min-width: 0; font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--a-h, var(--text)); overflow-wrap: anywhere; }
${S} .rtcard h4 .cty { white-space: normal; }
${S} .rtcard.rt-act .rt-top { flex-direction: column; align-items: flex-start; gap: 4px; }
${S} .rtcard .pill, ${S} .rtcard .chip { flex: none; font-size: 11.5px; padding: 1px 8px; white-space: nowrap; }
${S} .rt-date, ${S} .rtcard .why { margin: 0; font-size: 12.5px; line-height: 1.4; color: var(--muted); }
${S} .rt-meta { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; font-size: 13px; line-height: 1.4; color: var(--muted); }
${S} .rt-flags { display: inline-flex; flex-wrap: wrap; gap: 3px; }
${S} .rt-flag { display: inline-flex; font-size: 11px; }
${S} .rt-flag img.flag { margin: 0; }
${S} .rtcard button.rt-open:disabled { cursor: default; opacity: 1; background: transparent; color: var(--muted); border-color: var(--a-div, var(--line)); }
${S} .rtcard select { width: 100%; max-width: 100%; font-size: 13px; padding: 3px 4px; border-radius: 6px; }
${S} .rt-acts { margin-top: 2px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
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

// One group per card, each with its reports newest first (the list's own order). Big reports first
// (user, 2026-09-29): the Full check, Compare countries, the one-country cards in the order of the
// newest comparison's countries (the others after them, by their newest report), the Pilot last.
function typeGroups(list) {
  const groups = [];
  const byKey = {};
  for (const r of list) {
    const k = cardKey(r);
    if (!byKey[k]) { byKey[k] = { key: k, type: r.type, reports: [] }; groups.push(byKey[k]); }
    byKey[k].reports.push(r);
  }
  const rank = (g) => (g.type === "core" ? 0 : g.type === "compare" ? 1 : g.type === "pilot" ? 3 : 2);
  const cmpMarkets = (list.find((r) => r.type === "compare") || {}).markets || [];
  const inCmp = (g) => { const k = g.type === "country" ? cmpMarkets.indexOf((g.reports[0].markets || [])[0]) : -1; return k < 0 ? cmpMarkets.length : k; };
  return groups.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || inCmp(a.g) - inCmp(b.g) || a.i - b.i).map((x) => x.g);
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
const competitorsText = (n) => n + (n === 1 ? " competitor" : " competitors");

// A small flag with the country's name (and language, when chosen) as its tooltip and label.
function metaFlag(gl, label) {
  const img = flagImg(gl);
  return '<span class="rt-flag" role="img" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + (img || esc(String(gl || "").toUpperCase())) + "</span>";
}

// The meta line of the report picked: its competitors, and the flags of its countries (Compare
// countries: every one; the Full check and the Pilot: the main country; a one-country card has its
// flag in the title already).
function cardMeta(r) {
  const markets = r.markets || [];
  const labels = r.countryLabels || r.countryNames || [];
  const gls = r.type === "compare" ? markets : r.type === "core" || r.type === "pilot" ? markets.slice(0, 1) : [];
  const parts = [];
  if (r.competitors != null) parts.push("<span>" + competitorsText(r.competitors) + "</span>");
  if (gls.length) parts.push('<span class="rt-flags">' + gls.map((gl, i) => metaFlag(gl, labels[i] || FLAG_NAMES[gl] || gl)).join("") + "</span>");
  return parts.length ? '<p class="rt-meta">' + parts.join("") + "</p>" : "";
}

// A dropdown option: short title, date and status, with the counts when the name does not give
// them and the whole still fits the option (OPTION_FIT characters).
const OPTION_FIT = 60;
function optionText(r) {
  const n = (r.markets || []).length;
  const counts = /competitor/i.test(r.name || "") ? [] : [
    ...(r.type === "compare" && n ? [n + (n === 1 ? " country" : " countries")] : []),
    ...(r.competitors != null ? [competitorsText(r.competitors)] : []),
  ];
  const full = [shortTitle(r), ...counts, cardDate(r), statusWord(r)].join(" \\u00b7 ");
  return full.length <= OPTION_FIT ? full : [shortTitle(r), cardDate(r), statusWord(r)].join(" \\u00b7 ");
}

function typeCardHtml(g) {
  const ids = g.reports.map((r) => r.id);
  const pick = ids.includes(cardPick[g.key]) ? cardPick[g.key] : ids.includes(openRid) ? openRid : ids[0];
  const r = g.reports.find((x) => x.id === pick);
  const k = rsafe(g.key.replace(":", "-"));
  const sel = g.reports.length > 1
    ? '<label><span class="sr">Which report</span><select class="rt-sel" data-group="' + esc(g.key) + '">' + g.reports.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === pick ? " selected" : "") + ">"
      + esc(optionText(x)) + "</option>").join("") + "</select></label>"
    : "";
  return '<div class="rtcard ' + (TYPE_CLS[r.type] || "") + (ids.includes(openRid) ? " is-open" : "") + '" data-group="' + esc(g.key) + '"' + (ids.includes(openRid) ? ' aria-current="true"' : "") + ">"
    + '<div class="rt-top"><h4>' + cardTitle(g) + "</h4>" + pill(STATUS_CLS[r.status.kind] || "none", statusWord(r)) + "</div>"
    + '<p class="rt-date">' + esc(cardDate(r)) + (r.derivedFrom ? " " + pill("none", "from comparison") : "") + "</p>" + cardMeta(r) + sel
    + '<div class="rt-acts">' + (pick === openRid
      ? '<button type="button" class="rt-open" disabled data-rid="' + rsafe(pick) + '">Showing</button>'
      : '<button type="button" class="rt-open primary" data-rid="' + rsafe(pick) + '" data-act-key="rt-open-' + k + '">Open</button>') + "</div></div>";
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

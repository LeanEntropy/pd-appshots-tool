/**
 * The "Across countries" and "Per country" parts of a country version (report-country.ts), and
 * its contents. Per country is one tab per country (flag, name, verdict chip; the first selected,
 * the choice remembered per report in localStorage); each tab holds that country's own
 * recommendations (with the words to use), patterns and our fit, the position by position table,
 * then its words and detailed statistics. Keyboard: arrows, Home and End move between tabs.
 * The markdown and the PDF list every country in sequence (country-md.ts).
 */
export const COUNTRY_TABS_CSS = `
.ctabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 16px; padding: 0; }
.rbox button.ctab { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--bg); color: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
.rbox button.ctab[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.rbox button.ctab[aria-selected="true"] .pill { background: rgba(255,255,255,.9); }
.rbox button.ctab:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.ctab .pill { font-size: 11.5px; padding: 1px 8px; }
.cpanel > h3:first-child { margin-top: 4px; }
nav.ctoc ol { display: grid; gap: 6px; margin: 6px 0 0; padding: 0; list-style: none; }
nav.ctoc li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
nav.ctoc .tsub { display: contents; }
nav.ctoc button.tkey { font-weight: 700; }
section[data-page="report"] .rbox nav.ctoc { display: block; padding-top: 10px; padding-bottom: 10px; }
section[data-page="report"] .rbox nav.ctoc ol { display: grid; }
section[data-page="report"] .rbox nav.ctoc li { display: flex; }
section[data-page="report"] .rbox nav.ctoc .linkbtn.tkey { background: #fff; color: var(--a-head); border-color: #fff; }
section[data-page="report"] .rbox nav.ctoc .linkbtn.tkey:hover { background: rgba(255,255,255,.85); }
section[data-page="report"] .rbox nav.ctoc .linkbtn.tmain { font-weight: 750; }
section[data-page="report"] .rbox button.ctab { font-size: 15px; padding: 6px 14px; border-radius: 999px; border-color: var(--a-line); background: var(--a-surface); }
section[data-page="report"] .rbox button.ctab[aria-selected="true"] { background: var(--a-accent); border-color: var(--a-accent); color: var(--a-on-accent); }
section[data-page="report"] .rbox button.ctab[aria-selected="true"] .pill { background: var(--a-surface); }
@media print { .ctabs { display: none; } .cpanel[hidden] { display: block; } }
`;

export const COUNTRY_TABS_SCRIPT = `
const CTAB_KEY = "ssr.countryTab.";
// The parts of "Across countries", in order (empty ones left out): the patterns across groups of
// countries first (report-groups.ts, docs/plan-cross-country.md).
function acrossParts(c, research) {
  const L0 = c.localisation;
  return [
    c.type === "compare" && { id: "groups", t: "Patterns across your countries", body: groupsHtml(c), imgs: true },
    L0 && { id: "local", t: "How each game localises", body: localisationHtml(c), imgs: true, closed: true },
    L0 && { id: "habits", t: "Our localisation vs the competitors\\u2019", body: habitsHtml(c), closed: true },
    { id: "words", t: "Words compared across languages", body: wordsCrossHtml(c), closed: true },
    { id: "abtests", t: "A/B test details", body: abDetailsHtml({ abTests: c.abTests }), closed: true },
    { id: "sorting", t: "How we sort images", body: sortingHtml(c.sorting) || "<p>Nothing is sorted yet: no analyses in this report.</p>", imgs: true, closed: true },
    research && { id: "research", t: "What to research next", body: research, closed: true },
  ].filter((p) => p && p.body);
}

// A part inside a numbered section: its own fold, image button and id (for the contents).
function subSec(p) {
  const hid = hiddenImgSecs.has(repRid + ":" + p.id);
  return '<details class="sec' + (hid ? " noimg" : "") + '"' + (p.closed ? "" : " open") + ' id="rep-' + repRid + "-" + p.id + '"><summary><span class="sec-t">' + esc(p.t) + "</span>"
    + (p.imgs ? '<button type="button" class="imgbtn" data-rid="' + repRid + '" data-imgsec="' + p.id + '">' + (hid ? "Show images" : "Hide images") + "</button>" : "")
    + '</summary><div class="sec-b">' + p.body + "</div></details>";
}

function savedCtab(c) {
  let gl = null;
  try { gl = localStorage.getItem(CTAB_KEY + repRid); } catch {}
  return c.countries.some((x) => x.gl === gl) ? gl : c.countries[0] ? c.countries[0].gl : "";
}

function countryTocHtml(c, across) {
  const no = (id) => repSecs.findIndex((s) => s.id === id) + 1;
  const go = (id, t, cls) => '<button type="button" class="linkbtn' + (cls ? " " + cls : "") + '" data-goto="rep-' + repRid + "-" + id + '">' + esc(t) + "</button>";
  const multi = c.countries.length > 1;
  return '<nav class="card toc ctoc" aria-label="Report contents" data-rid="' + repRid + '"><strong>Contents</strong><ol>'
    + "<li>" + go("summary", no("summary") + ". Overall recommendations", "tmain") + "</li>"
    + (across.length ? "<li>" + go("across", no("across") + ". Across countries", "tmain") + '<span class="tsub">' + across.map((p) => go(p.id, p.t)).join("") + "</span></li>" : "")
    + "<li>" + go("countries", no("countries") + ". Per country", "tmain") + '<span class="tsub"><button type="button" class="linkbtn tkey" data-ctab="" data-cpart="pos">Position tables per country</button>'
    + (multi ? c.countries.map((x) => '<button type="button" class="linkbtn" data-ctab="' + esc(x.gl) + '">' + cflag(x.gl, x.label) + "</button>").join("") : "") + "</span></li></ol></nav>";
}

// One country's tab panel: its recommendations, patterns and fit, positions, words, statistics.
function countryPanelHtml(c, x) {
  const d = Object.assign({}, x.data, { sorting: null });
  const a = c.advice.find((y) => y.gl === x.gl);
  const mainRecs = x.isMain && x.data.ai && x.data.ai.recommendations;
  const recs = a && a.advice ? adviceOne(a) : mainRecs ? recsHtml(x.data) : a ? adviceOne(a) : "<p>None written yet.</p>";
  const t = c.terminology.find((y) => y.gl === x.gl);
  const kp = x.data.fit ? x.data.fit.keyPoints : [];
  const fold = (title, body) => '<details class="sec"><summary><span class="sec-t">' + title + '</span></summary><div class="sec-b">' + body + "</div></details>";
  return ownReportLink(c, x) + "<h3>Recommendations" + (x.isMain ? " (main country)" : "") + "</h3>" + recs
    + "<h3>Patterns and our fit</h3>" + (kp.length ? '<h4>Key points to optimise here</h4><ol class="keypoints">' + kp.map((k) => "<li>" + esc(k) + "</li>").join("") + "</ol>" : "") + fitHtml(d)
    + '<h3 id="rep-' + repRid + "-pos-" + esc(x.gl) + '">Position by position</h3>' + positionsHtml(d)
    + (t ? fold("Words used here " + '<span class="meta">' + t.rows.filter((r) => r.ours === "differs").length + " where we differ</span>", WORDS_NOTE + wordsCountry(t)) : "")
    + fold("Detailed statistics", patternsHtml(x.data.patterns));
}

function countryTabsHtml(c) {
  const sel = savedCtab(c);
  const id = (k, gl) => "rep-" + repRid + "-" + k + "-" + esc(gl);
  const tabs = c.countries.length > 1 ? '<div class="ctabs" role="tablist" aria-label="Countries" data-rid="' + repRid + '">' + c.countries.map((x) => {
    const v = x.data.fit ? x.data.fit.verdict : "not enough data";
    const on = x.gl === sel;
    return '<button type="button" role="tab" class="ctab" id="' + id("ctab", x.gl) + '" data-ctab="' + esc(x.gl) + '" aria-controls="' + id("cpanel", x.gl) + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '">'
      + cflag(x.gl, x.label) + pill(VERDICT_CLS[v] || "none", v) + "</button>";
  }).join("") + "</div>" : "";
  return tabs + c.countries.map((x) => '<div class="cpanel"' + (tabs ? ' role="tabpanel" tabindex="0" aria-labelledby="' + id("ctab", x.gl) + '"' : "") + ' id="' + id("cpanel", x.gl) + '"' + (tabs && x.gl !== sel ? " hidden" : "") + ">"
    + countryPanelHtml(c, x) + "</div>").join("");
}

// Shows country gl's tab in report box (remembered per report); returns the chosen tab.
function selectCtab(box, gl) {
  const tabs = [...box.querySelectorAll('.ctabs [role="tab"]')];
  const tab = tabs.find((t) => t.dataset.ctab === gl);
  if (!tab) return null;
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    const p = document.getElementById(t.getAttribute("aria-controls"));
    if (p) p.hidden = !on;
  }
  try { localStorage.setItem(CTAB_KEY + tab.parentElement.dataset.rid, gl); } catch {}
  return tab;
}
function openTo(el) {
  for (let d = el && el.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
  if (el) el.scrollIntoView({ block: "start" });
}

document.addEventListener("click", (e) => {
  const box = e.target.closest && e.target.closest(".rbox");
  if (!box) return;
  const b = e.target.closest("[data-ctab]");
  if (b) {
    const cur = box.querySelector('.ctabs [aria-selected="true"]');
    const gl = b.dataset.ctab || (cur ? cur.dataset.ctab : "");
    selectCtab(box, gl);
    if (b.getAttribute("role") === "tab") return;
    const nav = box.querySelector("nav.ctoc");
    const rid = nav ? nav.dataset.rid : "";
    openTo(document.getElementById(b.dataset.cpart === "pos" ? "rep-" + rid + "-pos-" + gl : "rep-" + rid + "-countries"));
    return;
  }
  // A contents link to a part inside a folded section: open the folds around it too.
  const g = e.target.closest("button[data-goto]");
  if (g) openTo(document.getElementById(g.dataset.goto));
});
// The contents band sticks just under the page header (report-style-a.ts, any report type);
// sections scrolled to stop below both.
function tocRoom() {
  const h = document.querySelector("header.top");
  const t = document.querySelector('section[data-page="report"] nav.toc');
  const top = h ? h.offsetHeight : 0;
  document.documentElement.style.setProperty("--toc-top", top + "px");
  document.documentElement.style.setProperty("--toc-room", top + (t ? t.offsetHeight : 0) + 12 + "px");
}
if (typeof window !== "undefined") {
  window.addEventListener("click", tocRoom, true);
  const hdr = document.querySelector("header.top");
  if (hdr && typeof ResizeObserver === "function") new ResizeObserver(tocRoom).observe(hdr);
}
document.addEventListener("keydown", (e) => {
  const t = e.target.closest && e.target.closest('.ctabs [role="tab"]');
  if (!t) return;
  const tabs = [...t.parentElement.querySelectorAll('[role="tab"]')];
  const i = tabs.indexOf(t);
  const j = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (j === undefined) return;
  e.preventDefault();
  const next = tabs[(j + tabs.length) % tabs.length];
  const box = t.closest(".rbox");
  if (box) selectCtab(box, next.dataset.ctab);
  next.focus();
});
`;

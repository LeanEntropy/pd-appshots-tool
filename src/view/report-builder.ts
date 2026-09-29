/**
 * "New report" builder (plan-reports 1.2, milestone R3), one panel above the report list: the kind
 * of report (greyed with the reason until the Pilot is ready), the countries, the competitors
 * (with "not sold in ..." per ticked country; chart games folded, never ticked by default) and
 * the name (suggested, editable). Every tick recomputes "What this report needs" (code only,
 * report-builder-review.ts) and autosaves the draft. Nothing paid runs from here: "Build report"
 * appears only when no new analysis is needed; otherwise the exact images and cost are shown.
 */
export const BUILDER_CSS = `
#builder h3 { margin-top: 0; }
#builder fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 8px 0; padding: 6px 10px; }
#builder fieldset label { display: inline-block; margin: 3px 14px 3px 0; } #builder label.off { color: var(--muted); }
#builder .bcols { display: flex; flex-wrap: wrap; gap: 12px; } #builder .bcols > fieldset { flex: 1 1 320px; }
#builder .bcomp { display: block !important; } #builder .tag { font-size: 12px; color: var(--muted); margin-left: 6px; } #builder .tag.no { color: var(--warn); }
#builder input[type=text] { font: inherit; padding: 4px 8px; width: min(520px, 100%); }
#bNeeds table { border-collapse: collapse; margin: 6px 0; } #bNeeds td { padding: 3px 10px 3px 0; border-bottom: 1px solid var(--line); } #bNeeds td.n { text-align: right; font-weight: 700; }
#bNeeds .total { font-size: 16px; font-weight: 700; } #bNeeds .over { color: var(--bad); font-weight: 700; }
.bwarn { border-left: 5px solid var(--mid); padding: 6px 10px; background: var(--bg); margin: 8px 0; font-weight: 600; }
.bacts { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 10px; }
#approvalDlg .athumbs figure.layer-diff img { border-color: var(--accent-2); } #approvalDlg .athumbs figure.full img { border-color: #c2410c; }
#approvalDlg .pair { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding: 8px 0; }
#approvalDlg .pair img { width: 80px; height: 130px; object-fit: contain; background: var(--bg); border: 1px solid var(--line); border-radius: 4px; }
`;

export const BUILDER_SCRIPT = `
const bld = { opts: null, id: null, type: "country", markets: [], comps: [], charts: [], leftOut: [], name: "", nameEdited: false, plan: null, seq: 0, timer: null };
const BTYPES = [["pilot", "Pilot"], ["core", "Full check"], ["country", "One country"], ["compare", "Compare countries"]];
const isPresetType = (t) => t === "pilot" || t === "core";
const mkey = (m) => m.gl + "|" + m.hl;

function builderScope() {
  if (isPresetType(bld.type)) return { type: bld.type, markets: [], competitors: [], includeCharts: [] };
  const s = { type: bld.type, markets: bld.markets.map((m) => ({ gl: m.gl, hl: m.hl })), competitors: bld.comps.slice(), includeCharts: bld.charts.slice() };
  if (bld.leftOut.length) s.leftOut = bld.leftOut.slice();
  return s;
}
function scopeProblem() {
  if (isPresetType(bld.type)) return "";
  if (bld.type === "country" && bld.markets.length !== 1) return "Pick the country of this report.";
  if (bld.type === "compare" && bld.markets.length < 2) return "Tick at least two countries to compare.";
  return "";
}

function availability(sold) {
  const bad = bld.markets.filter((m) => sold[m.gl] !== "ok");
  if (!bld.markets.length) return "";
  if (!bad.length) return '<span class="tag">' + (bld.markets.length > 1 ? "in all " + bld.markets.length : "sold here") + "</span>";
  return bad.map((m) => '<span class="tag no">' + (sold[m.gl] === "not-sold" ? "not sold in " : "not downloaded in ") + esc(theCountryOf(m.label)) + "</span>").join("");
}
const countryOf = (label) => String(label || "").replace(/\\s*\\([^)]*\\)\\s*$/, "");
// Inside a sentence: "the United States", "the Philippines", "Japan".
const theCountryOf = (label) => { const n = countryOf(label); return /^(United |Philippines|Netherlands)/.test(n) ? "the " + n : n; };

function builderHtml() {
  const o = bld.opts;
  const types = BTYPES.map(([k, l]) => {
    const t = o.types[k];
    const locked = bld.id && k !== bld.type;
    return '<label class="' + (t.open ? "" : "off") + '"><input type="radio" name="btype" value="' + k + '"' + (bld.type === k ? " checked" : "") + (t.open && !locked ? "" : " disabled") + "> " + l + (t.open ? "" : ' <span class="meta">(' + esc(t.reason) + ")</span>") + "</label>";
  }).join("");
  let body;
  if (isPresetType(bld.type)) {
    body = '<p>' + esc(o.main.label) + ", the main country, fixed. Competitors: your pick on the Competitors page (" + o.pick.length + "). " + (bld.type === "pilot" ? "The Pilot uses the first picked competitors." : "") + "</p>";
  } else {
    const input = bld.type === "country" ? "radio" : "checkbox";
    const countries = o.markets.map((m) => '<label><input type="' + input + '" name="bcountry" value="' + esc(mkey(m)) + '"' + (bld.markets.some((x) => mkey(x) === mkey(m)) ? " checked" : "") + "> " + countryLabel(m.gl, m.label) + "</label>").join("");
    const comp = (c, name) => '<label class="bcomp"><input type="checkbox" name="' + name + '" value="' + esc(c.appId) + '"' + ((name === "bcomp" ? bld.comps : bld.charts).includes(c.appId) ? " checked" : "") + "> " + esc(c.name) + (c.inPick ? ' <span class="tag">in your pick</span>' : "") + availability(c.sold) + "</label>";
    body = '<div class="bcols"><fieldset><legend>Countries</legend>' + countries
      + (bld.type === "compare" ? '<p class="meta">' + esc(o.main.label) + " (the main country) is used as the reference for what changed, ticked or not.</p>"
        + '<p><button type="button" class="cpOpen" data-act-key="cp-builder">Add countries to the project</button></p>' : "") + "</fieldset>"
      + "<fieldset><legend>Competitors (from this project)</legend>" + o.competitors.map((c) => comp(c, "bcomp")).join("")
      + (o.charts.length ? "<details><summary>Chart games (not ticked by default)</summary>" + o.charts.map((c) => comp(c, "bchart")).join("") + "</details>" : "")
      + '<p class="meta">Our game: ' + esc(o.ours.name) + " (always included)</p></fieldset></div>"
      + '<p><label>Name <input type="text" id="bName" maxlength="120" value="' + esc(bld.name) + '"></label> <span class="meta">(suggested, you can change it)</span></p>';
  }
  return '<h3 id="bTitle" tabindex="-1">' + (bld.id ? "Report setup (saved as a draft)" : "New report") + "</h3>"
    + '<fieldset><legend>What kind?</legend>' + types + "</fieldset>"
    + (o.warning && bld.type !== "core" && bld.type !== "pilot" ? '<p class="bwarn">' + esc(o.warning) + "</p>" : "")
    + body + '<div id="bSame" aria-live="polite"></div><div id="bNeeds" aria-live="polite"></div><p class="act-msg" id="bStatus" hidden></p><div class="bacts" id="bActs"></div>';
}

function renderBuilder() {
  const box = document.getElementById("builder");
  if (!box || !bld.opts) return;
  box.hidden = false;
  box.innerHTML = builderHtml();
  if (bld.plan) renderNeeds(bld.plan);
  renderSame();
}

// A draft set up exactly like this already exists: it is reopened here, never copied.
function adoptDraft(d, keepName) {
  bld.id = d.id; bld.name = d.name; bld.nameEdited = !!keepName; bld.adopted = { id: d.id, name: d.name };
  const h = document.getElementById("bTitle"); if (h) h.textContent = "Report setup (saved as a draft)";
  const input = document.getElementById("bName"); if (input) input.value = d.name;
}

// "You already have a draft for this" (Continue), and a warning when another report has the same setup.
function renderSame() {
  const box = document.getElementById("bSame");
  if (!box) return;
  const others = (bld.same || []).filter((x) => x.id !== bld.id);
  const q = (n) => "\\u201c" + esc(n) + "\\u201d";
  box.innerHTML = (bld.adopted ? '<p class="bwarn">You already have a draft for this: ' + q(bld.adopted.name) + ". It is open here, so no second copy is made. "
      + '<button type="button" class="primary" id="bSameOk">Continue</button></p>' : "")
    + others.map((x) => '<p class="bwarn">' + q(x.name) + (x.draft ? " (a draft)" : "") + " is set up exactly like this: the same countries and competitors. "
      + '<button type="button" class="bSameOpen" data-rid="' + esc(x.id) + '" data-draft="' + (x.draft ? "1" : "") + '">Open it instead</button></p>').join("");
}

// Opens the builder, prefilled from a suggestion, a card or "What next?" (nothing is saved until a tick).
async function openBuilder(pre) {
  const box = document.getElementById("builder");
  if (!box) return;
  box.hidden = false;
  actLine(box, "busy", "Opening the report builder...");
  try { bld.opts = await getJson(API + "/reports/builder"); }
  catch (e) { actLine(box, "bad", "The builder could not be opened: " + actReason(e)); return; }
  const p = pre || {};
  const sc = p.scope || {};
  const open = (t) => bld.opts.types[t] && bld.opts.types[t].open;
  bld.id = p.id || null;
  bld.type = p.type || sc.type || (open("country") ? "country" : "pilot");
  if (!open(bld.type)) bld.type = "pilot";
  bld.markets = (sc.markets || []).map((m) => bld.opts.markets.find((x) => x.gl === m.gl)).filter(Boolean);
  if (bld.type === "country" && bld.markets.length > 1) bld.markets = bld.markets.slice(0, 1);
  bld.comps = (sc.competitors || []).slice();
  bld.charts = (sc.includeCharts || []).slice();
  bld.leftOut = (sc.leftOut || []).slice();
  bld.name = p.name || "";
  bld.nameEdited = !!p.name;
  bld.plan = null;
  bld.dirty = false;
  bld.same = [];
  bld.adopted = null;
  renderBuilder();
  box.scrollIntoView({ block: "start" });
  const h = document.getElementById("bTitle"); if (h) h.focus();
  builderChanged(false);
}

function closeBuilder() {
  const box = document.getElementById("builder");
  if (box) { box.hidden = true; box.innerHTML = ""; }
  bld.id = null; bld.plan = null; bld.dirty = false; bld.same = []; bld.adopted = null; bld.seq++;
}

// Every change: "Working out what is needed..." at once, then the numbers (debounced, one save at a time).
let bldChain = Promise.resolve();
function builderChanged(save) {
  if (save) bld.dirty = true;
  bld.seq++;
  const seq = bld.seq;
  const problem = scopeProblem();
  const needs = document.getElementById("bNeeds");
  if (problem) {
    bld.plan = null;
    if (needs) { needs.className = ""; needs.innerHTML = '<p class="meta">' + esc(problem) + "</p>"; }
    const a = document.getElementById("bActs"); if (a) a.innerHTML = '<button type="button" id="bClose">Close</button>';
    // The choice so far is still saved as the draft (closing the page keeps it).
    if (save) bldChain = bldChain.then(() => saveDraftOnly(seq));
    return;
  }
  actLine(needs, "busy", "Working out what is needed...");
  clearTimeout(bld.timer);
  bld.timer = setTimeout(() => { bldChain = bldChain.then(() => recompute(seq)); }, 250);
}

async function ensureDraft() {
  if (bld.id || isPresetType(bld.type)) return;
  const d = await send(API + "/reports", bld.nameEdited ? { scope: builderScope(), name: bld.name } : { scope: builderScope() });
  bld.id = d.id; bld.name = d.name;
  // The server reopens a draft set up exactly like this one instead of making a copy.
  if (d.existing) { adoptDraft(d, true); renderSame(); }
  const h = document.getElementById("bTitle"); if (h) h.textContent = "Report setup (saved as a draft)";
  if (typeof loadReport === "function") loadReport();
}

async function saveDraftOnly(seq) {
  if (seq !== bld.seq || isPresetType(bld.type)) return;
  try {
    if (!bld.id) await ensureDraft();
    else await sendReq("PATCH", API + "/reports/" + encodeURIComponent(bld.id), bld.nameEdited ? { scope: builderScope(), name: bld.name } : { scope: builderScope() });
  } catch (e) { if (seq === bld.seq) actLine(document.getElementById("bStatus"), "bad", "Your choice was not saved: " + actReason(e)); }
}

async function recompute(seq) {
  if (seq !== bld.seq) return;
  const needs = document.getElementById("bNeeds");
  try {
    let r;
    if (isPresetType(bld.type)) r = await send(API + "/reports/plan", { scope: builderScope() });
    else if (!bld.id && !bld.dirty) r = await send(API + "/reports/plan", { scope: builderScope() });
    else {
      if (!bld.id) await ensureDraft();
      else await sendReq("PATCH", API + "/reports/" + encodeURIComponent(bld.id), bld.nameEdited ? { scope: builderScope(), name: bld.name } : { scope: builderScope() });
      r = await getJson(API + "/reports/" + encodeURIComponent(bld.id) + "/plan");
      if (!bld.nameEdited && r.suggestedName && r.name !== r.suggestedName) {
        const n = await sendReq("PATCH", API + "/reports/" + encodeURIComponent(bld.id), { name: r.suggestedName });
        r.name = n.name;
      }
      if (!bld.nameEdited) bld.name = r.name;
    }
    if (seq !== bld.seq) return;
    const draft = !isPresetType(bld.type) && !bld.id && (r.same || []).find((x) => x.draft);
    if (draft) adoptDraft(draft, draft.name !== r.suggestedName);
    bld.same = r.same || [];
    renderSame();
    if (!bld.id && !bld.nameEdited) bld.name = r.suggestedName || bld.name;
    const input = document.getElementById("bName");
    if (input && document.activeElement !== input) input.value = bld.name;
    bld.plan = r.plan;
    renderNeeds(r.plan);
  } catch (e) { if (seq === bld.seq) actLine(needs, "bad", "The numbers could not be worked out: " + actReason(e)); }
}

document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t || !t.closest || !t.closest("#builder")) return;
  if (t.name === "btype") {
    bld.type = t.value;
    if (bld.type === "country" && bld.markets.length > 1) bld.markets = bld.markets.slice(0, 1);
    bld.leftOut = [];
    renderBuilder();
    builderChanged(!isPresetType(bld.type));
  } else if (t.name === "bcountry") {
    const m = bld.opts.markets.find((x) => mkey(x) === t.value);
    if (bld.type === "country") bld.markets = m ? [m] : [];
    else bld.markets = t.checked ? bld.markets.concat(m ? [m] : []) : bld.markets.filter((x) => mkey(x) !== t.value);
    bld.markets = bld.opts.markets.filter((x) => bld.markets.some((y) => mkey(y) === mkey(x)));
    renderBuilder();
    builderChanged(true);
  } else if (t.name === "bcomp" || t.name === "bchart") {
    const list = t.name === "bcomp" ? "comps" : "charts";
    bld[list] = t.checked ? bld[list].concat([t.value]) : bld[list].filter((x) => x !== t.value);
    if (list === "comps") bld.comps = bld.opts.competitors.map((c) => c.appId).filter((id) => bld.comps.includes(id));
    builderChanged(true);
  }
});
document.addEventListener("input", (e) => {
  if (e.target && e.target.id === "bName") { bld.name = e.target.value; bld.nameEdited = !!bld.name.trim(); builderChanged(true); }
});
`;

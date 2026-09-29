/**
 * The group part of a comparison, at the top of "Across countries" (plan-cross-country 3, C2 and
 * the free schematic briefs of C4a), and the links between a comparison and its One country
 * reports (C1): the band on a country report made from a comparison, "Open as its own report",
 * "Make country reports now" and the optional paid "Write A/B tests for <country> alone" (the
 * usual approval; nothing runs until approved). Bottom line first; each finding shows its numbers
 * per country, the images behind it and a code-drawn sketch labelled "schematic, not measured".
 * Flags only in headings. Every value is escaped; the sketches are drawn by the tool's own code.
 */
export const REPORT_GROUPS_CSS = `
.gpart .gline { margin: 6px 0 12px; font-weight: 600; }
.gpart h4 { margin: 14px 0 6px; }
.grow { display: flex; flex-wrap: wrap; gap: 12px; padding: 10px 0; border-top: 1px solid var(--a-div, var(--line)); }
.grow .gtext { flex: 1 1 320px; min-width: 0; }
.grow .gtext p { margin: 4px 0; }
.grow .gside { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; }
.gper { display: flex; flex-wrap: wrap; gap: 4px 6px; margin: 4px 0; padding: 0; list-style: none; font-size: 12.5px; }
.gper li { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--a-div, var(--line)); background: var(--a-surface, var(--bg)); }
.gper li.no { border-color: var(--bad); }
.gthumbs { display: flex; flex-wrap: wrap; gap: 6px; }
.gthumbs figure { margin: 0; width: 64px; font-size: 10.5px; line-height: 1.2; color: var(--muted); }
.gthumbs img { width: 64px; height: 112px; object-fit: contain; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); display: block; }
.gthumbs figure.ours img { outline: 2px solid var(--accent); }
svg.sketch { color: var(--muted); flex: none; max-width: 100%; height: auto; }
.grec { padding: 10px 0; border-top: 1px solid var(--a-div, var(--line)); }
.grec p { margin: 4px 0; }
.gconf { color: var(--bad); }
.geditor .grp { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; padding: 6px 0; border-top: 1px solid var(--a-div, var(--line)); }
.geditor input[type="text"] { min-width: 0; width: 14em; max-width: 100%; }
.geditor label { white-space: nowrap; }
.gband { border-left: 5px solid var(--accent); background: var(--a-surface, var(--bg)); padding: 6px 12px; margin: 10px 0; }
.gband p { margin: 4px 0; }
.gband .linkbtn, .gpart .linkbtn { margin: 2px 6px 2px 0; }
.ownrep { margin: 0 0 8px; }
@media print { .geditor, .gband button, .ownrep { display: none; } }
`;

export const REPORT_GROUPS_SCRIPT = `
const G_KIND = { ours: "Our pages differ", common: "Common in every country", group: "Different in this group", descriptive: "The same games everywhere" };
const gid = (id) => String(id || "").replace(/[^a-z0-9-]/g, "");

function gThumbs(f) {
  return f.examples.length ? '<div class="gthumbs">' + f.examples.map((t) => '<figure class="' + (t.ours ? "ours" : "") + '"><img loading="lazy" src="' + IMG + esc(t.thumb) + '" alt="' + esc(t.game + ", " + cname(t.label) + ", image " + t.position) + '"><figcaption>' + esc((t.ours ? "Ours" : t.game) + ", " + cname(t.label) + " #" + t.position) + "</figcaption></figure>").join("") + "</div>" : "";
}
function gPer(f) {
  return '<ul class="gper">' + f.perCountry.map((p) => {
    const txt = f.dim === "deckLength" ? cname(p.label) + ": " + p.of + " images, " + p.yes + " different" : cname(p.label) + ": " + p.yes + " of " + p.of + (p.ours === null ? "" : p.ours ? " \\u00b7 ours yes" : " \\u00b7 ours no");
    return '<li class="' + (p.ours === false ? "no" : "") + '">' + esc(txt) + "</li>";
  }).join("") + "</ul>";
}
function gFinding(f) {
  const chip = f.strength ? pill(f.strength === "clear" ? "following" : "slightly", f.strength === "clear" ? "clear" : "worth testing") : pill("none", G_KIND[f.kind] || f.kind);
  return '<div class="grow"><div class="gtext"><p><strong>' + esc(f.title) + "</strong> " + chip + (f.fewGames ? " " + pill("none", "rests on few games") : "") + "</p><p>" + esc(f.text) + "</p>" + gPer(f) + '</div><div class="gside">' + (f.sketch || "") + gThumbs(f) + "</div></div>";
}
function gRec(r, i) {
  return '<div class="grec"><p><strong>' + (i + 1) + ". " + esc(r.title) + "</strong> " + pill("none", r.variableName) + "</p><p>" + esc(r.text) + '</p><p class="meta">Hypothesis: ' + esc(r.hypothesis) + "</p><p><strong>Play Console:</strong> " + esc(r.setup.line) + "</p>"
    + (r.setup.notes.length ? '<ul class="meta">' + r.setup.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>" : "")
    + r.conflicts.map((x) => '<p class="gconf">Goes against a country\\u2019s advice: ' + esc(x) + " Both are shown; you decide.</p>").join("") + "</div>";
}
function gSection(s) {
  const head = "<h4>" + esc(s.name) + ": " + s.countries.map((c) => cflag(c.gl, c.label)).join(", ") + (s.suggested ? ' <span class="meta">(suggested)</span>' : "") + "</h4>";
  if (s.problem) return head + '<p class="meta">' + esc(s.problem) + "</p>";
  return head + (s.findings.length ? s.findings.map(gFinding).join("") : "<p>No group difference found on the main dimensions.</p>")
    + (s.notAPattern.length ? "<details><summary>Not a pattern (" + s.notAPattern.length + ")</summary><ul>" + s.notAPattern.map((l) => "<li>" + esc(l) + "</li>").join("") + "</ul></details>" : "")
    + (s.exploratory.length ? '<details><summary>Exploratory numbers (never a recommendation on their own)</summary><div class="tablewrap"><table class="rt"><tr><th>What</th>' + s.exploratory[0].perCountry.map((p) => "<th>" + esc(cname(p.label)) + "</th>").join("") + "</tr>"
      + s.exploratory.map((e) => '<tr><td><strong>' + esc(e.label) + '</strong><div class="meta">' + esc(e.definition) + "</div></td>" + e.perCountry.map((p) => "<td>" + esc(p.value) + "</td>").join("") + "</tr>").join("") + "</table></div></details>" : "")
    + '<p class="meta"><strong>Play Console:</strong> ' + esc(s.setup) + "</p>";
}
function gEditor(c) {
  const g = c.groups;
  const rows = (g.saved || g.suggested).slice(0, 4);
  while (rows.length < 4) rows.push({ name: "", countries: [] });
  const cs = c.countries.filter((x) => !x.isMain);
  return '<details class="geditor"><summary>Edit groups</summary><p class="meta">Tick at least 2 countries per group and name it; empty rows are ignored. Groups are suggested by region and listing language; the data never forms them.</p>'
    + rows.map((r, i) => '<div class="grp" data-grp="' + i + '"><input type="text" maxlength="60" placeholder="Group name" aria-label="Group ' + (i + 1) + ' name" value="' + esc(r.name) + '">'
      + cs.map((x) => '<label><input type="checkbox" value="' + esc(x.gl) + '"' + (r.countries.includes(x.gl) ? " checked" : "") + "> " + esc(cname(x.label)) + "</label>").join("") + "</div>").join("")
    + '<p><button type="button" class="primary g-save" data-rid="' + repRid + '">Save groups</button> <button type="button" class="g-reset" data-rid="' + repRid + '">Use the suggested groups</button></p><p class="act-msg" id="gs-' + repRid + '" hidden></p></details>';
}
function ownReportsHtml(c) {
  const l = c.links || {};
  if (c.type !== "compare") return "";
  const own = (l.countryReports || []).map((x) => { const cc = c.countries.find((y) => y.gl === x.gl); return '<button type="button" class="linkbtn rt-open" data-rid="' + gid(x.id) + '">' + esc(cname(cc ? cc.label : x.gl)) + "</button>"; }).join("");
  return '<p class="meta"><strong>One country reports from this comparison</strong> (made by code, no cost): ' + (own || "none yet.") + ' <button type="button" class="linkbtn g-derive" data-rid="' + repRid + '">Make country reports now</button></p><p class="act-msg" id="gd-' + repRid + '" hidden></p>';
}
function groupsHtml(c) {
  const g = c.groups;
  if (!g) return ownReportsHtml(c);
  return '<div class="gpart"><p class="gline">' + esc(g.bottomLine) + "</p>"
    + g.samePages.map((s) => '<p class="meta">' + esc(s.label + " shows the same images as " + s.as + " for every game.") + "</p>").join("")
    + (g.recommendations.length ? "<h4>Recommendations, as A/B tests</h4>" + g.recommendations.map(gRec).join("") : "")
    + (g.ours.length ? "<h4>Our pages differ between countries</h4>" + g.ours.map(gFinding).join("") : "")
    + (g.common.length + g.descriptive.length ? "<h4>Common in every country</h4>" + g.common.concat(g.descriptive).map(gFinding).join("") : "")
    + g.groups.map(gSection).join("")
    + (g.hint ? '<p class="meta">Hint: ' + esc(g.hint) + "</p>" : "")
    + '<p class="meta">' + esc(g.main.note) + " Sketches are schematic, not measured.</p>"
    + '<details><summary>What the words mean</summary><dl>' + g.terms.map((t) => "<dt><strong>" + esc(t.term) + "</strong></dt><dd>" + esc(t.definition) + "</dd>").join("") + "</dl></details>"
    + gEditor(c) + ownReportsHtml(c) + "</div>";
}

// The one line of the summary for the group part (bottom line first).
function groupsLine(c) {
  return c.groups ? '<p class="gline"><strong>Across your countries:</strong> ' + esc(c.groups.bottomLine) + ' <button type="button" class="linkbtn" data-goto="rep-' + repRid + '-groups">The details</button></p>' : "";
}

// A country report made from a comparison: where it comes from (after the summary).
function derivedBandHtml(c) {
  const d = c.derived;
  if (!d) return "";
  const l = (c.links || {}).derived || {};
  const name = cname((c.countries[0] || {}).label || "");
  const others = (l.siblings || []).map((x) => { const o = d.others.find((y) => y.gl === x.gl); return '<button type="button" class="linkbtn rt-open" data-rid="' + gid(x.id) + '">' + esc(cname(o ? o.label : x.gl)) + "</button>"; }).join("");
  return '<div class="gband"><p>' + (l.parentId ? 'Part of the comparison \\u201c' + esc(l.parentName || d.from.name) + "\\u201d (" + esc(typeof fmtDate === "function" ? fmtDate(d.from.generatedAt) : d.from.generatedAt) + '), made from its saved data with no AI call. <button type="button" class="linkbtn rt-open" data-rid="' + gid(l.parentId) + '">Open the comparison</button>' : "Made from the comparison \\u201c" + esc(d.from.name) + "\\u201d, which was deleted: this report stands on its own.") + "</p>"
    + (others ? "<p>Also in it: " + others + "</p>" : "")
    + d.dropped.map((x) => '<p class="meta">Not kept: ' + esc(x) + ".</p>").join("")
    + '<p><button type="button" class="rc-approve" data-rid="' + repRid + '">Write A/B tests for ' + esc(name) + ' alone</button> <span class="meta">Optional and paid (about $0.20 to $0.50): the approval shows the exact steps and cost first, nothing runs until you approve, and the result is a new version.</span></p></div>';
}
function samePagesTop(c) {
  const d = c.derived;
  return d && d.samePagesAs ? '<div class="banner stale"><p>' + esc(cname((c.countries[0] || {}).label) + " shows the same images as " + cname(d.samePagesAs.label) + " for every game: this report repeats " + cname(d.samePagesAs.label) + "\\u2019s findings.") + "</p></div>" : "";
}
// "Open as its own report" at the top of a comparison's country tab.
function ownReportLink(c, x) {
  const r = ((c.links || {}).countryReports || []).find((y) => y.gl === x.gl);
  return r ? '<p class="ownrep"><button type="button" class="linkbtn rt-open" data-rid="' + gid(r.id) + '">Open ' + esc(cname(x.label)) + " as its own report</button></p>" : "";
}

function groupRows(rid) {
  const box = document.getElementById("rb-" + rid);
  return [...(box ? box.querySelectorAll(".geditor .grp") : [])].map((r) => ({
    name: (r.querySelector('input[type="text"]') || {}).value.trim(),
    countries: [...r.querySelectorAll('input[type="checkbox"]:checked')].map((i) => i.value),
  })).filter((g) => g.name || g.countries.length);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button.g-save, button.g-reset, button.g-derive");
  if (!b) return;
  const rid = gid(b.dataset.rid);
  if (b.classList.contains("g-derive"))
    return act(b, { busy: "Making the country reports...", status: "gd-" + rid, run: () => send(API + "/reports/" + encodeURIComponent(rid) + "/derive", {}), done: (r) => { loadReport(); return r.message; } });
  const groups = b.classList.contains("g-reset") ? [] : groupRows(rid);
  const bad = groups.find((g) => !g.name || g.countries.length < 2);
  if (bad) { actLine(document.getElementById("gs-" + rid), "bad", "Each group needs a name and at least 2 countries."); return; }
  act(b, { busy: "Saving the groups...", status: "gs-" + rid, run: () => sendReq("PATCH", API + "/reports/" + encodeURIComponent(rid), { groups }),
    done: () => { loadReportCard(rid); return groups.length ? "Groups saved: the findings below are recomputed." : "Back to the suggested groups."; } });
});
`;

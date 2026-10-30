/**
 * The engine's blocks on a report page (plan-recommendation-engine section 10, step 5), all by
 * code: "What to change" at the top of the summary (one row per directive with its evidence
 * chip, "2 of 2 games, both leaders", and its full spec in a fold; the target deck below it), and
 * "Store listing" at the top of the store section (tags, category, title, short and long
 * description per country and language). Test ideas and review notes sit behind folds. Reports
 * saved before the engine show nothing here.
 */
export const REPORT_ENGINE_SCRIPT = `
const LEVEL_TXT = { directive: "Do", provisional: "Do (provisional)", test: "A/B test", consider: "Consider", keep: "Keep", review: "Needs review" };
const LEVEL_CLS = { directive: "very", provisional: "slightly", test: "none", consider: "none", keep: "following", review: "slightly" };
function evChip(e) {
  if (!e || !e.M) return "";
  const lead = !e.leaders.on ? "no leader data" : !e.leaders.of ? "no leader" : e.leaders.of === 2 && e.leaders.n === 2 ? "both leaders" : e.leaders.n + " of " + e.leaders.of + " leaders";
  return '<span class="chip" title="' + esc(e.games.join(", ")) + '">' + esc(e.n + " of " + e.M + " games \\u00b7 " + lead) + "</span>";
}
function specTable(s) {
  if (!s) return "";
  return '<div class="tablewrap"><table class="rt"><tr><th>Field</th><th>What should be there</th><th>Agree</th><th>From</th></tr>'
    + s.fields.map((f) => "<tr><td>" + esc(f.label) + (f.required ? "" : ' <span class="meta">(optional)</span>') + "</td><td>" + esc(f.value) + "</td><td>" + esc(f.agree) + "</td><td>" + esc(f.from) + "</td></tr>").join("") + "</table></div>";
}
// The AI's objections (D8): shown next to their directive, never applied.
function objectionsOf(id) {
  const a = reportData && reportData.ai;
  const r = a && a.current && a.recommendations;
  return ((r && r.objections) || []).filter((o) => o.directiveId === id);
}
function directiveRow(x) {
  const spec = x.replacement || x.spec;
  return "<li>" + pill(LEVEL_CLS[x.level] || "", LEVEL_TXT[x.level] || x.level) + " <strong>" + esc(x.title) + "</strong> " + evChip(x.evidence)
    + '<div class="meta">' + esc(x.text) + "</div>"
    + objectionsOf(x.id).map((o) => '<div class="meta"><em>AI objection (shown only, not applied):</em> ' + esc(o.reason) + (o.evidence ? " (" + esc(o.evidence) + ")" : "") + "</div>").join("")
    + (spec ? fold((x.replacement ? "Replacement: " : "Spec: ") + esc(spec.headline), specTable(spec), "spec") : "") + "</li>";
}
function skeletonHtml(e) {
  if (!e.skeleton.length) return "";
  return '<div class="tablewrap"><table class="rt"><tr><th>#</th><th>Kind</th><th>Orientation</th><th>Source</th><th>Logo</th><th>Theme</th><th>Action</th><th>Why</th></tr>'
    + e.skeleton.map((s) => "<tr><th>" + esc(s.position) + "</th><td>" + esc(s.kindLabel) + "</td><td>" + esc(s.canvas + (s.size && s.size !== "not measured" ? " " + s.size : "")) + "</td><td>" + esc(s.source) + "</td><td>" + (s.logo ? "yes" : "no") + "</td><td>" + esc((s.themes || []).join(", ").replace(/_/g, " ")) + "</td><td>" + esc(s.action) + "</td><td>" + esc([s.why].concat(s.directiveIds).join(" \\u00b7 ")) + "</td></tr>").join("") + "</table></div>";
}
function engineHtml(d) {
  const e = d.engine;
  if (!e) return "";
  const firm = e.directives.filter((x) => x.level === "directive" || x.level === "provisional");
  const tests = e.directives.filter((x) => x.level === "test" || x.level === "consider");
  const review = e.directives.filter((x) => x.level === "review");
  return '<div class="card engine"><h3>What to change</h3><p class="meta">' + esc(e.notes.join(" ")) + " Our page should look more like the leaders: anything only we show counts against us.</p>"
    + (firm.length ? '<ol class="directives">' + firm.map(directiveRow).join("") + "</ol>" : "<p>No change is backed by the competitors' evidence.</p>")
    + (review.length ? '<h4>Needs review</h4><ul class="directives">' + review.map(directiveRow).join("") + "</ul>" : "")
    + fold("Target deck (" + e.skeleton.length + " images)", skeletonHtml(e), "skeleton")
    + fold("Test ideas (" + tests.length + ")", tests.length ? '<ul class="directives">' + tests.map(directiveRow).join("") + "</ul>" : "", "tests")
    + "</div>";
}
function metaRow(x) {
  return "<li>" + pill(LEVEL_CLS[x.level] || "", x.candidate ? "Candidate" : LEVEL_TXT[x.level] || x.level) + " <strong>" + esc(x.title) + "</strong> " + evChip(x.evidence) + '<div class="meta">' + esc(x.text) + "</div></li>";
}
function storeListingHtml(d) {
  const m = d.engine && d.engine.meta;
  if (!m || (!m.appLevel.length && !m.groups.length)) return "";
  return '<div class="card engine"><h3>Store listing</h3><p class="meta">By code from the saved store text. ' + esc(m.notes.join(" ")) + " Tags stay candidates until the Play Console tag limit is confirmed.</p>"
    + m.groups.map((g) => fold(esc(g.label) + " (" + g.directives.length + ")", '<ul class="directives">' + g.directives.map(metaRow).join("") + "</ul>", "meta")).join("")
    + "</div>";
}
`;

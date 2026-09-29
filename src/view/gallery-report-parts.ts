import { KB_CITE_SCRIPT } from "./kb-cite.ts";

/**
 * Report page parts: computed pattern tables (with n and share bars), ours vs the patterns, and
 * the AI insights and recommendations (full screenshot and marketing-layer spec per slot, with
 * competitor examples). Every value is escaped; numbers are shown as text next to each bar.
 */
export const REPORT_PARTS_SCRIPT = `${KB_CITE_SCRIPT}
// Counts, never percentages (user rule): the bar shows the share, the text the count.
function shares(cs, n, name) {
  return (cs || []).slice(0, n || 4).map((c) => '<div>' + esc(name ? name(c.key) : L(c.key)) + " " + bar(c.share) + c.n + "</div>").join("") || '<span class="meta">none</span>';
}
const nOf = (share, total) => Math.round((share || 0) * total) + " of " + total;

// "How we sort images": the intro, then every category and tag with its definition and an example.
function sortingHtml(s) {
  if (!s) return "";
  return '<h3>How we sort images</h3>' + s.intro.map((l) => "<p>" + esc(l) + "</p>").join("")
    + '<div class="tablewrap"><table class="rt"><tr><th>Name</th><th>What it is</th><th>What sets it apart</th><th>Example</th></tr>'
    + s.items.map((i) => "<tr><td><strong>" + esc(i.label) + '</strong> <span class="meta">(' + esc(i.kind) + ")</span></td><td>" + esc(i.definition) + "</td><td>" + esc(i.unlike) + "</td><td>" + (i.example ? rthumb(i.example.imageId, i.example.thumb, i.example.file, i.example.name + " " + i.example.position) + '<div class="meta">' + esc(i.example.name + " #" + i.example.position) + "</div>" : "") + "</td></tr>").join("")
    + "</table></div>";
}
// The one-line definitions of the categories and tags a pattern is about.
function definedHtml(d, keys) {
  const items = (d.sorting && d.sorting.items) || [];
  const lines = [...new Set(keys || [])].map((k) => items.find((i) => i.key === k)).filter(Boolean).map((i) => i.label + ": " + i.definition);
  return lines.length ? '<div class="meta">' + esc(lines.join(" ")) + "</div>" : "";
}

function patternsHtml(p) {
  if (!p) return "<p>Fewer than 2 competitor screenshots are analysed, so there are no patterns yet.</p>";
  const tg = p.tags;
  const logoAt = (n) => { const x = tg && tg.logoPerPosition.find((l) => l.position === n); return x ? x.n + " of " + x.of : ""; };
  const pos = p.perPosition.map((x) => "<tr><th>" + x.position + "</th><td>" + x.n + "</td><td>" + shares(x.types, 3) + "</td><td>" + bar(x.layerShare) + nOf(x.layerShare, x.n) + "</td><td>" + logoAt(x.position) + "</td><td>" + shares(x.proportions, 2, (k) => k) + "</td></tr>").join("");
  const types = p.screenTypes.map((t) => "<tr><td>" + esc(L(t.key)) + "</td><td>" + t.games + " of " + p.games.length + "</td><td>" + t.images + "</td></tr>").join("");
  const byType = p.byScreenType.map((t) => "<tr><td>" + esc(L(t.key)) + "</td><td>" + t.n + "</td><td>" + nOf(t.layerShare, t.n) + "</td><td>" + shares(t.maskColours, 3, (k) => k) + "</td><td>" + shares(t.maskShapes, 2) + "</td><td>" + shares(t.textColours, 3, (k) => k) + "</td><td>" + shares(t.elementKinds, 3) + "</td></tr>").join("");
  const fmt = [
    ["Image orientation (pixels)", p.orientation.canvas], ["In-game capture orientation", p.orientation.capture],
    ["Composition", p.composition], ["Screenshot areas per image (0 = full-screen art)", p.capturesPerImage], ["Layer vs screenshot", p.proportion],
    ["Whole-image colours (pixels)", p.colours.image], ["Marketing layer colours", p.colours.layer], ["Mask colours", p.colours.masks],
    ["Text colours", p.colours.texts], ["Mask shapes", p.maskShapes], ["Mask locations", p.maskLocations], ["Text positions", p.textPositions], ["Extra elements", p.elementKinds],
  ].map(([k, v]) => "<tr><th>" + esc(k) + "</th><td>" + shares(v, 5, (x) => x.replace(/_/g, " ")) + "</td></tr>").join("");
  const logoLines = tg ? "<p>Game logo on the image: " + esc(tg.logoPerGame.map((g) => g.name + " " + g.n + " of " + g.of).join(", ")) + ". In the first 3 images: " + tg.logoPerGame.filter((g) => g.firstThree).length + " of " + tg.logoPerGame.length + " competitors.</p><p>" + esc(L("full_screen_art")) + ": " + tg.art.n + " images, " + tg.art.withLogo + " with the game logo; their line: " + esc(tg.art.messages.map((m) => L(m.key).toLowerCase() + " " + m.n).join(", ") || "none") + ".</p>" : "";
  return '<p>From <strong>' + p.images + "</strong> competitor screenshots of " + p.games.length + " games (" + esc(p.games.map((g) => g.name).join(", ")) + "). Deck length " + p.deckLength.min + " to " + p.deckLength.max + " (median " + p.deckLength.median + "). Marketing layer on " + nOf(p.marketingLayer.share, p.images) + " images.</p>" + (p.repeats && p.repeats.length ? "<p>Same screen uploaded twice (each screen counted once):</p><ul>" + p.repeats.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ul>" : "") + logoLines
    + '<h3>Screen type per image</h3><div class="tablewrap"><table class="rt"><tr><th>Image</th><th>Competitors</th><th>Screen types</th><th>Marketing layer</th><th>Game logo</th><th>Layout</th></tr>' + pos + "</table></div>"
    + '<h3>Screen types used</h3><table class="rt"><tr><th>Screen type</th><th>Games</th><th>Images</th></tr>' + types + "</table>"
    + '<h3>Format, layers and colours</h3><table class="rt">' + fmt + "</table>"
    + '<h3>What goes with each screen type</h3><div class="tablewrap"><table class="rt"><tr><th>Screen type</th><th>n</th><th>Layer</th><th>Mask colours</th><th>Mask shapes</th><th>Text colours</th><th>Extra elements</th></tr>' + byType + "</table></div>";
}

const VERDICT = { following: "following", "slightly different": "slightly", "very different": "very", "not enough data": "none" };
const GROUPS = { order: "Order (the sequence of screen types)", content: "Content (which screen types are used)", layer: "Marketing layer", format: "Format" };

// [V] fits / [X] different, with the reason; every pattern and partial pattern, grouped.
// Default view: the AI's reading and one row per pattern (mark, pattern, evidence, ours). The
// definitions sit behind "What do these types mean?" (and in each pattern's tooltip); the coverage
// and what "pattern" and "partial pattern" mean behind "Details".
function fitHtml(d) {
  const f = d.fit;
  const cov = "<p>Computed from " + d.coverage.used + " of " + d.coverage.total + " screenshots in the batch" + (d.coverage.missing.length ? " (missing: " + esc(d.coverage.missing.join(", ")) + ")" : "") + ".</p>";
  const i = d.ai && d.ai.interpretation;
  if (!f || !f.patterns.length) return "<p>Fewer than 2 competitor screenshots are analysed, so there are no patterns yet.</p>" + detailsFold([cov]);
  const mark = (x) => x.fits === null ? pill("none", "n/a") : x.fits ? pill("following", "[V] fits") : pill("very", "[X] different");
  // A country tab has no sorting of its own: its link goes to the report's "How we sort images".
  const shared = !d.sorting && reportData && reportData.sorting;
  const items = ((d.sorting || shared) && (d.sorting || shared).items) || [];
  const tip = (x) => [...new Set(x.categories || [])].map((k) => items.find((j) => j.key === k)).filter(Boolean).map((j) => j.label + ": " + j.definition).join(" ");
  const legend = "<p>A pattern holds for (nearly) every competitor; a partial pattern for at least half of them. Partial patterns: " + f.patterns.filter((x) => x.strength !== "pattern").length + " of " + f.patterns.length + ".</p>";
  const types = d.sorting ? fold("What do these types mean?", sortingHtml(d.sorting), "types")
    : shared ? '<p><button type="button" class="linkbtn" data-goto="rep-' + repRid + '-sorting">What do these types mean?</button></p>' : "";
  return (i ? "<p>" + (d.ai.current ? "" : '<em class="warn">From run ' + esc(d.ai.runId) + ", written from older analyses:</em> ") + esc(i.summary) + "</p>" : "")
    + types + Object.keys(GROUPS).map((g) => {
    const rows = f.patterns.filter((x) => x.group === g);
    if (!rows.length) return "";
    return "<h3>" + esc(GROUPS[g]) + '</h3><div class="tablewrap"><table class="rt fit"><tr><th>Our deck</th><th>Pattern</th><th>Evidence</th><th>Ours</th></tr>'
      + rows.map((x) => { const t = tip(x); return '<tr class="' + (x.fits === false ? "miss" : "") + '"><td>' + mark(x) + '</td><td><strong class="ptxt"' + (t ? ' title="' + esc(t) + '"' : "") + ">" + esc(x.text) + "</strong></td><td>" + esc(x.evidence) + "</td><td>" + esc(x.reason) + "</td></tr>"; }).join("") + "</table></div>";
  }).join("") + detailsFold([cov, legend]);
}

// Decks that show the same screen twice: counted once (the repeated rows say which one they repeat).
function repeatsHtml(d) {
  return (d.repeats || []).map((r) => '<p><strong>Same screen uploaded twice: ' + esc(r.ours ? r.name + " (ours)" : r.name) + ", " + r.total + " images, " + r.unique + " unique.</strong> " + esc(r.ours ? r.text : "Counted once in the patterns.") + (r.counted ? "" : ' <span class="meta">This version was built before the check and counts every image.</span>') + "</p>").join("");
}

// One row per store position: our screenshot first, then each competitor's, then our fit.
function positionsHtml(d) {
  const ours = d.games.find((g) => g.ours);
  const cols = (ours ? [ours] : []).concat(d.games.filter((g) => !g.ours));
  const max = Math.max(0, ...cols.flatMap((g) => g.rows.map((r) => r.position)));
  const cellOf = (g, p) => {
    const r = g.rows.find((x) => x.position === p);
    if (!r) return '<td class="empty"></td>';
    if (r.state === "excluded") return '<td class="meta">not analysed (tablet-shaped)</td>';
    return "<td" + (g.ours ? ' class="ourcell"' : "") + ">" + rthumb(null, r.thumb, r.file, g.name + " " + p) + '<div class="lbl">' + esc(r.screen || "not analysed yet") + (r.imageId ? " " + infoBtn(r.imageId) : "") + "</div>" + (r.headline ? '<div class="hl">"' + esc(r.headline) + '"</div>' : "") + "</td>";
  };
  let h = repeatsHtml(d) + '<div class="tablewrap"><table class="rt pos"><tr><th>#</th>' + cols.map((g) => "<th>" + esc(g.name) + (g.ours ? " (ours)" : "") + "</th>").join("") + "<th>How ours compares</th></tr>";
  for (let p = 1; p <= max; p++) {
    const v = d.oursVs && d.oursVs.positions.find((x) => x.position === p);
    h += "<tr><th>" + p + "</th>" + cols.map((g) => cellOf(g, p)).join("") + "<td>" + (v ? pill(VERDICT[v.verdict] || "", v.verdict) + '<div class="meta">' + esc(v.reasons.join("; ")) + "</div>" : "") + "</td></tr>";
  }
  return h + "</table></div>" + detailsFold(["<p>Row N shows every game\\u2019s Nth Google Play screenshot: ours first, then each competitor. The (i) button shows the full analysis.</p>"]);
}

function slotHtml(d, p) {
  const s = p.screenshot; const m = p.marketingLayer;
  const ex = (d.examples[String(p.position)] || []).map((e) => '<span class="rimgs">' + rthumb(e.imageId, e.thumb, null, e.name + " " + e.position) + '<span class="meta">' + esc(e.name + " #" + e.position) + "</span></span>").join(" ");
  const layer = !m.present ? "<p><strong>Marketing layer:</strong> none</p>"
    : "<dl><dt>Layout</dt><dd>" + esc(m.proportion) + "</dd><dt>Background mask</dt><dd>" + esc([m.backgroundMask.shape, m.backgroundMask.colour, m.backgroundMask.location].join(", ")) + "</dd></dl>"
      + '<table class="rt"><tr><th>Text</th><th>Role</th><th>Colour</th><th>Outline</th><th>Font style</th><th>Size</th><th>Position</th></tr>'
      + m.texts.map((t) => "<tr><td><strong>" + esc(t.text) + "</strong></td><td>" + esc(t.role) + "</td><td>" + esc(t.colour) + "</td><td>" + esc(t.strokeColour) + "</td><td>" + esc(t.fontStyle) + "</td><td>" + esc(t.size) + "</td><td>" + esc(String(t.position).replace(/_/g, " ")) + "</td></tr>").join("") + "</table>"
      + (m.elements.length ? "<ul>" + m.elements.map((e) => "<li><strong>Extra element:</strong> " + esc(e.what + ", at " + e.position + ", pose " + e.pose + ", " + e.colour) + "</li>").join("") + "</ul>" : "");
  const cat = ["title_image", "loading_screen", "key_art", "feature_image"].includes(p.screenType) ? "full_screen_art" : p.screenType;
  // Folded: the order table above is the default view; each position's full spec opens on demand.
  const hl = (m.texts[0] || {}).text;
  return '<details class="fold slotd slot"><summary>Position ' + esc(p.position) + ": " + esc(L(p.screenType)) + (p.subtype ? " / " + esc(L(p.subtype)) : "") + (hl ? ' <span class="meta">\\u201c' + esc(hl) + "\\u201d</span>" : "") + '</summary><div class="fold-b">' + definedHtml(d, [cat])
    + "<dl><dt>Source</dt><dd>" + esc(p.source) + "</dd>" + (p.logo ? "<dt>Game logo</dt><dd>" + (p.logo.show ? "yes" : "no") + ". " + esc(p.logo.why) + "</dd>" : "") + "<dt>Screen to capture</dt><dd>" + esc(s.whatToCapture) + " (" + esc(s.orientation) + ")</dd><dt>Action</dt><dd>" + esc(s.action) + "</dd><dt>Atmosphere</dt><dd>" + esc(s.atmosphere) + "</dd><dt>Main colours</dt><dd>" + esc(s.mainColours) + "</dd></dl>"
    + layer + "<p><strong>Why:</strong> " + esc(p.why) + kbMarks(d.ai && d.ai.recommendations, "position:" + p.position) + "</p>" + (ex ? '<p><strong>Competitor examples:</strong></p><div class="strip">' + ex + "</div>" : "") + "</div></details>";
}

// The recommended order (summary table), then the full screenshot and marketing-layer spec per slot.
function recsHtml(d) {
  const ai = d.ai;
  const r = ai && ai.recommendations;
  if (!r) return "<p>Not written yet. " + esc(d.synthesis.reason) + " See the overview for how to get them.</p>";
  const pos = [...r.positions].sort((a, b) => a.position - b.position);
  const rv = ai.review;
  return (ai.current ? "" : '<p class="warn">From run ' + esc(ai.runId) + ", written from older analyses.</p>")
    + ((d.recProblems || []).length ? '<div class="banner stale"><p><strong>Check these slots:</strong> the label does not match the spec (found by code).</p><ul>' + d.recProblems.map((x) => "<li>" + esc(x) + "</li>").join("") + "</ul></div>" : "")
    + "<p>" + esc(r.rationale) + "</p>"
    + '<table class="rt"><tr><th>#</th><th>Screen</th><th>Source</th><th>Headline</th></tr>' + pos.map((p) => "<tr><th>" + esc(p.position) + "</th><td>" + esc(L(p.screenType)) + (p.subtype ? " / " + esc(L(p.subtype)) : "") + "</td><td>" + esc(p.source) + "</td><td><strong>" + esc((p.marketingLayer.texts[0] || {}).text || "") + "</strong></td></tr>").join("") + "</table>"
    + pos.map((p) => slotHtml(d, p)).join("")
    + (rv ? fold("Cross-check of the recommendations", "<p>Verdict: " + (rv.verdict === "ok" ? "no major problems" : "changes requested") + (ai.revised ? " (the recommendations above were revised after this review)" : "") + ".</p><ul>" + rv.findings.map((f) => "<li>" + (f.severity === "major" ? "<strong>Major</strong>" : "Minor") + ", " + (f.position ? "position " + esc(f.position) : "whole deck") + ": " + esc(f.issue) + " Suggestion: " + esc(f.suggestion) + "</li>").join("") + "</ul>", "review") : "");
}
`;

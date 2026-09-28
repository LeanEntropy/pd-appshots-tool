/**
 * Parts of a country version (report-country.ts): how each game localises against the main
 * country (a matrix per country, then each changed image's text with its back-translation), our
 * localisation habits vs the competitors' ([V] same as most, [X] different, with the reason),
 * and the words used per country (the concept by game table, the most common term with n of m,
 * where our wording differs, and a cross-country view). Every value is escaped.
 */
export const REPORT_COUNTRY_PARTS_SCRIPT = `
const KIND_WORDS = { identical: "same file", "new-text": "same picture, new text", "not-compared": "same picture, text not compared yet", different: "a picture not on the main page" };
const TEXT_WORDS = { local: "local language", main: "main country\\u2019s language", none: "no text", mixed: "mixed" };

function localCountry(c, gl) {
  const rows = c.localisation.rows.filter((r) => r.gl === gl);
  const head = '<div class="tablewrap"><table class="rt"><tr><th>Game</th><th>Images</th><th>Same file</th><th>Same picture, new text</th><th>Other picture</th><th>Moved</th><th>Text left in the main language</th><th>Band or extras changed</th><th>Order vs the main page</th></tr>';
  const body = rows.map((r) => {
    if (r.state !== "ok") return '<tr><td>' + esc(r.game) + (r.ours ? " (ours)" : "") + '</td><td colspan="8" class="meta">' + esc({ "not-sold": "not sold here", "not-downloaded": "not downloaded here", "left-out": "left out to stay within the limit", "no-main": "no page in the main country to compare with" }[r.state] || r.state) + "</td></tr>";
    return '<tr class="' + (r.ours ? "ourrow" : "") + '"><td><strong>' + esc(r.game) + "</strong>" + (r.ours ? " (ours)" : "") + "</td><td>" + r.images + "</td><td>" + r.identical + "</td><td>" + (r.newText + r.notCompared) + (r.notCompared ? ' <span class="meta">(' + r.notCompared + " not compared yet)</span>" : "") + "</td><td>" + r.different + "</td><td>" + r.moved + "</td><td>" + r.keptText + "</td><td>" + (r.bandChanged + r.swapped) + "</td><td>" + esc(r.orderNote) + "</td></tr>";
  }).join("");
  const changed = rows.flatMap((r) => r.lines.filter((l) => l.kind !== "identical").map((l) => ({ r, l })));
  const lines = changed.map(({ r, l }) => "<tr><td>" + esc(r.game) + " #" + l.position + '</td><td><span class="cmp2 rimgs">' + (l.mainThumb ? '<img loading="lazy" src="' + IMG + esc(l.mainThumb) + '" alt="main">' : "") + (l.thumb ? '<img loading="lazy" src="' + IMG + esc(l.thumb) + '" alt="here">' : "") + "</span></td><td>" + esc(KIND_WORDS[l.kind] || l.kind) + (l.mainPosition && l.mainPosition !== l.position ? ' <span class="meta">(main #' + l.mainPosition + ")</span>" : "") + "</td><td>" + esc(l.mainHeadline) + '</td><td class="local">' + esc(l.localHeadline) + (l.backTranslation ? '<div class="bt">' + esc(l.backTranslation) + "</div>" : "") + "</td><td>" + esc(TEXT_WORDS[l.text] || l.text) + "</td><td>" + esc([l.band, l.swapped].filter(Boolean).join("; ")) + "</td></tr>").join("");
  return head + body + "</table></div>"
    + (changed.length ? '<details><summary>Every changed image (' + changed.length + ')</summary><div class="tablewrap"><table class="rt"><tr><th>Image</th><th>Main page / here</th><th>What changed</th><th>Main headline</th><th>Local headline (back-translation)</th><th>Text language</th><th>Band, extras</th></tr>' + lines + "</table></div></details>" : "");
}

function localisationHtml(c) {
  const L0 = c.localisation;
  if (!L0) return "<p>This report is about the main country only.</p>";
  const gls = [...new Set(L0.rows.map((r) => r.gl))];
  return '<p class="meta">Each game\\u2019s page here against its own page in ' + cflag(L0.main.gl, L0.main.label) + ". Same file: byte-identical (content hash). Same picture, new text: the picture matches by perceptual hash and only the text layer was compared. Other picture: not on the main page.</p>"
    + gls.map((gl) => { const r0 = L0.rows.find((r) => r.gl === gl); return "<h3>" + cflag(gl, r0 ? r0.country : gl) + "</h3>" + localCountry(c, gl); }).join("");
}

function habitsHtml(c) {
  const L0 = c.localisation;
  if (!L0) return "";
  const mark = (h) => h.fits === null ? pill("none", "n/a") : h.fits ? pill("following", "[V] same") : pill("very", "[X] different");
  const per = L0.habits.map((ch) => "<h3>" + cflag(ch.gl, ch.country) + '</h3><div class="tablewrap"><table class="rt fit"><tr><th>Our page</th><th>Habit</th><th>Competitors</th><th>Why</th></tr>'
    + ch.habits.map((h) => '<tr class="' + (h.fits === false ? "miss" : "") + '"><td>' + mark(h) + "</td><td><strong>" + esc(h.label) + '</strong><div class="meta">' + esc(h.definition) + "</div></td><td>" + h.n + " of " + h.of + (h.games.length ? '<div class="meta">' + esc(h.games.join(", ")) + "</div>" : "") + "</td><td>" + esc(h.reason) + "</td></tr>").join("") + "</table></div>").join("");
  const a = L0.across;
  const across = a ? "<h3>Across the compared countries</h3><p class=\\"meta\\">" + esc(a.note) + "</p>" + (a.habits.length ? '<table class="rt"><tr><th>Habit</th>' + a.habits[0].perCountry.map((p) => "<th>" + cflag(p.gl, (L0.habits.find((h) => h.gl === p.gl) || {}).country || p.gl) + "</th>").join("") + "</tr>" + a.habits.map((h) => "<tr><td>" + esc(h.label) + "</td>" + h.perCountry.map((p) => "<td>" + p.n + " of " + p.of + "</td>").join("") + "</tr>").join("") + "</table>" : "") : "";
  return '<p class="meta">For each localisation habit: how many competitors do it here, and whether we do it too. [V] means we do what most competitors do; [X] means we differ.</p>' + per + across;
}

function wordsCountry(t) {
  const note = t.note ? '<p class="meta">' + esc(t.note) + "</p>" : "";
  if (t.state !== "current") return note || "<p>Not grouped yet.</p>";
  if (!t.rows.length) return note + "<p>No shared ideas found in " + t.textCount + " texts.</p>";
  const games = t.games;
  const mark = (r) => r.ours === "differs" ? pill("very", "[X] differs") : r.ours === "same" ? pill("following", "[V] same") : r.ours === "not-used" ? pill("none", "not used") : pill("none", "no clear common term");
  const cell = (r, g) => { const c0 = r.cells.find((x) => x.appId === g.appId); return "<td" + (g.ours ? ' class="ourcell"' : "") + ">" + (c0 && c0.uses.length ? c0.uses.map((u, i) => (i ? '<div class="meta">' : "<div><strong>") + esc(u.term) + " \\u00d7" + u.count + ' <span class="meta">' + esc(u.sources.join(", ")) + "</span>" + (i ? "</div>" : "</strong></div>")).join("") : '<span class="meta">\\u2013</span>') + "</td>"; };
  const users = (r) => r.cells.filter((c0) => c0.uses.length).length;
  const main = t.rows.filter((r) => r.ours === "differs" || users(r) >= 2);
  const rest = t.rows.filter((r) => !main.includes(r));
  const table = (rows) => '<div class="tablewrap"><table class="rt"><tr><th>Idea</th><th>Our wording</th><th>Most common</th>' + games.map((g) => "<th>" + esc(g.game) + (g.ours ? " (ours)" : "") + "</th>").join("") + "</tr>"
    + rows.map((r) => '<tr class="' + (r.ours === "differs" ? "miss" : "") + '"><td><strong>' + esc(r.label) + '</strong><div class="meta">' + esc(r.gloss) + "</div></td><td>" + mark(r) + '<div class="meta">' + esc(r.reason) + (r.ownMismatch ? " " + esc(r.ownMismatch) : "") + "</div></td><td>" + (r.common ? "<strong>" + esc(r.common.term) + "</strong> " + r.common.games + " of " + r.common.of : '<span class="meta">none</span>') + "</td>" + games.map((g) => cell(r, g)).join("") + "</tr>").join("") + "</table></div>";
  return note + (main.length ? table(main) : "<p>No idea is worded by 2 or more games here.</p>")
    + (rest.length ? "<details><summary>Ideas only one game words (" + rest.length + ")</summary>" + table(rest) + "</details>" : "")
    + (t.suggestions.length ? "<p><strong>Suggestions:</strong></p><ul>" + t.suggestions.map((s) => "<li>" + esc(s) + "</li>").join("") + "</ul>" : "");
}

function wordsHtml(c) {
  const x = c.crossTerms || [];
  const cross = c.terminology.length > 1 && x.length ? '<h3>Across countries</h3><div class="tablewrap"><table class="rt"><tr><th>Idea</th>' + c.terminology.map((t) => "<th>" + cflag(t.gl, t.label) + "</th>").join("") + "</tr>"
    + x.map((r) => "<tr><td>" + esc(r.label) + "</td>" + r.perCountry.map((p) => "<td>" + (p.common ? "<strong>" + esc(p.common) + "</strong>" : '<span class="meta">none</span>') + (p.ours && p.ours !== p.common ? '<div class="meta">ours: ' + esc(p.ours) + "</div>" : "") + "</td>").join("") + "</tr>").join("") + "</table></div>" : "";
  return '<p class="meta">Every text on the images and the store text (title, short and full description) per country. The ideas and their words are grouped once per language by AI (text only); every count is made by code. A title\\u2019s part after " - " or ":" is keyword text, not the game\\u2019s name.</p>'
    + c.terminology.map((t) => '<details class="sec"' + (c.terminology.length === 1 ? " open" : "") + '><summary><span class="sec-t">' + cflag(t.gl, t.label) + '</span> <span class="meta">' + t.rows.filter((r) => r.ours === "differs").length + " where we differ</span></summary><div class=\\"sec-b\\">" + wordsCountry(t) + "</div></details>").join("") + cross;
}
`;

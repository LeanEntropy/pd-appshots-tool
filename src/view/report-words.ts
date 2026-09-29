/**
 * "Words to use" of one country's advice (report-country.ts), as a compact status table: the
 * idea, the word to use (with its English meaning and reading when saved), what we use now in
 * images and store text, a coloured status chip ([V] correct, keep; [X] change or add; optional;
 * check), and how many competitors use the word. Fixes first, a one-line tally on top, the
 * advice's own reasoning behind a disclosure. The statuses come from the server (words-status.ts,
 * by code); a version served without them falls back to the plain list. Every value is escaped.
 */
const LIGHT = "--w-change: #a3361b; --w-change-bg: #f9e0d6; --w-add: #875400; --w-add-bg: #fbedcf;";
const DARK = "--w-change: #f0a58c; --w-change-bg: #43251c; --w-add: #eec27a; --w-add-bg: #3a2e17;";

export const REPORT_WORDS_CSS = `
:root { ${LIGHT} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { ${DARK} }
.wtu-tally { margin: 2px 0 6px; font-size: 14px; }
.wtu-tally .fix { color: var(--w-change); font-weight: 700; } .wtu-tally .ok { color: var(--a-good, var(--ok)); font-weight: 700; }
table.rt.wtu { width: 100%; }
table.rt.wtu td { vertical-align: top; }
table.rt.wtu tr.w-change td, table.rt.wtu tr.w-add td { background: var(--a-miss, transparent); }
.wtu .wword { font-size: 15px; font-weight: 700; }
.wtu .wnow div { white-space: nowrap; } .wtu .wnow .meta { display: inline-block; min-width: 42px; }
.wchip { display: inline-block; font-size: 12px; font-weight: 700; line-height: 1.3; padding: 2px 9px; border-radius: 999px; white-space: nowrap; background: var(--a-grey2, #e7eaeb); color: var(--muted); }
.wchip.keep { background: var(--a-surface, #e4f1e8); color: var(--a-good, #2c7549); }
.wchip.change { background: var(--w-change-bg); color: var(--w-change); }
.wchip.add { background: var(--w-add-bg); color: var(--w-add); }
.wtu .wswap { margin: 3px 0 0; font-weight: 700; }
.wtu .wwhy { margin: 3px 0 0; font-size: 12.5px; color: var(--muted); max-width: 420px; }
.wtu details { margin: 2px 0 0; font-size: 12.5px; } .wtu details > summary { cursor: pointer; color: var(--muted); }
.wtu .wm { display: none; }
@container (max-width: 600px) {
  table.rt.wtu, table.rt.wtu tbody { display: block; }
  section[data-page] table.rt.wtu tr:first-child { display: none; }
  section[data-page] table.rt.wtu tr { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "idea comp" "word word" "now now" "status status"; gap: 4px 10px; padding: 10px 8px; border-bottom: 1px solid var(--a-div, var(--line)); }
  section[data-page] table.rt.wtu td { border: 0; padding: 0; background: none; }
  table.rt.wtu tr.w-change, table.rt.wtu tr.w-add { background: var(--a-miss, transparent); }
  table.rt.wtu td.widea { grid-area: idea; font-weight: 700; } table.rt.wtu td.wuse { grid-area: word; }
  table.rt.wtu td.wnow { grid-area: now; } table.rt.wtu td.wstat { grid-area: status; }
  table.rt.wtu td.wcomp { grid-area: comp; font-size: 12.5px; color: var(--muted); }
  .wtu .wm { display: inline; } .wtu .wnow div { white-space: normal; }
}
`;

export const REPORT_WORDS_SCRIPT = `
const WORD_CHIPS = { keep: "[V] Correct, keep", change: "[X] Change", add: "[X] Add", optional: "Optional", check: "Check" };

function wordsNow(xs) { return xs && xs.length ? xs.map(esc).join(", ") : '<span class="meta">\\u2013</span>'; }

function wordsToUseHtml(a) {
  const x = a.advice;
  const b = a.words;
  if (!b || !Array.isArray(b.rows)) {
    const terms = (x.terms || []).map((t) => "<li><strong>" + esc(t.concept) + ":</strong> use <strong>" + esc(t.use) + "</strong>" + (t.avoid ? ", not " + esc(t.avoid) : "") + ". " + esc(noIdText(t.why)) + "</li>").join("");
    return terms ? "<h4>Words to use</h4><ul>" + terms + "</ul>" : "";
  }
  if (!b.rows.length) return "";
  const t = b.tally;
  const tally = '<p class="wtu-tally"><strong>' + esc(cname(a.label)) + ":</strong> "
    + '<span class="' + (t.fix ? "fix" : "") + '">' + t.fix + " to fix</span>, " + '<span class="ok">' + t.keep + " correct</span>"
    + (t.optional ? ", " + t.optional + " optional" : "") + (t.check ? ", " + t.check + " to check" : "") + "</p>";
  const row = (r) => '<tr class="w-' + esc(r.status) + '"><td class="widea">' + esc(r.concept) + "</td>"
    + '<td class="wuse local"><span class="wword">' + esc(r.use) + "</span>" + (r.meaning ? '<div class="meta">' + esc(r.meaning) + "</div>" : "") + "</td>"
    + '<td class="wnow"><div><span class="meta">Images</span> ' + wordsNow(r.ours.images) + '</div><div><span class="meta">Store</span> ' + wordsNow(r.ours.store) + "</div></td>"
    + '<td class="wstat"><span class="wchip ' + esc(r.status) + '">' + esc(WORD_CHIPS[r.status] || r.status) + "</span>"
    + (r.status === "change" && r.from ? '<div class="wswap local">' + esc(r.from) + " \\u2192 " + esc(r.use) + "</div>" : "")
    + '<div class="wwhy">' + esc(r.reason) + "</div>"
    + (r.details ? "<details><summary>Details</summary><div>" + esc(r.details) + "</div></details>" : "") + "</td>"
    + '<td class="wcomp">' + (r.competitors ? r.competitors.n + " of " + r.competitors.of + '<span class="wm"> competitors</span>' : '<span class="meta">\\u2013</span>') + "</td></tr>";
  return '<div class="wtu"><h4>Words to use</h4>' + tally
    + '<div class="tablewrap"><table class="rt wtu"><tr><th>Idea</th><th>Word to use</th><th>We use now</th><th>Status</th><th>Competitors</th></tr>'
    + b.rows.map(row).join("") + "</table></div></div>";
}
`;

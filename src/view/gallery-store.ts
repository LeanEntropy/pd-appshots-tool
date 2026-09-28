/**
 * Store text on the page: the "Store" (i) next to each game's name in the comparison grid, and
 * the report's "Store text and keywords" section. Keywords are derived from the store text by
 * the tool (Google Play has no official keywords), and the page always says so.
 */
export const STORE_SCRIPT = `
const STORE = DATA.storeText || {};
const DERIVED_NOTE = "Keywords derived from the store text by the tool: the words and short phrases the title, tags and descriptions use most. Google Play has no official keywords.";

function storeBtn(appId) {
  if (!STORE[appId] || !STORE[appId].length) return "";
  return '<button type="button" class="info store" data-info="store:' + esc(appId) + '" aria-label="Store page: category, tags and keywords" title="Store page: category, tags and keywords" aria-expanded="false" aria-controls="infoPop">i</button>';
}

function chipList(xs) { return xs && xs.length ? xs.map((x) => '<span class="chip">' + esc(x) + "</span>").join(" ") : '<span class="meta">none</span>'; }

function categoryText(s) {
  return esc(s.category || "not shown") + (s.chipCategory ? ' <span class="meta">(first tag: ' + esc(s.chipCategory) + ")</span>" : "");
}

function storeHtml(appId) {
  const list = STORE[appId];
  if (!list || !list.length) return "";
  const same = {};
  for (const s of list) if (s.sameAs) (same[s.sameAs] = same[s.sameAs] || []).push(s);
  let h = "<h4>Store page: category, tags and keywords</h4>";
  for (const s of list) {
    if (s.sameAs) continue;
    const also = same[s.label] || [];
    h += "<h5>" + esc(s.label) + ' <span class="meta">read ' + esc(s.date) + "</span></h5>"
      + (also.length ? '<p class="meta">Same store text in: ' + esc(also.map((x) => x.label + (x.contentRating && x.contentRating !== s.contentRating ? " (age rating " + x.contentRating + ")" : "")).join(", ")) + "</p>" : "")
      + "<dl><dt>Category</dt><dd>" + categoryText(s) + "</dd>"
      + "<dt>Tags</dt><dd>" + chipList(s.tags) + "</dd>"
      + "<dt>Keywords (derived)</dt><dd>" + chipList(s.keywords) + "</dd>"
      + (s.title ? "<dt>Title</dt><dd>" + esc(s.title) + "</dd>" : "")
      + (s.shortDescription ? "<dt>Short description</dt><dd>" + esc(s.shortDescription) + "</dd>" : "")
      + (s.contentRating ? "<dt>Age rating</dt><dd>" + esc(s.contentRating) + "</dd>" : "") + "</dl>";
  }
  return h + '<p class="meta">' + esc(DERIVED_NOTE) + "</p>";
}

function storeTextHtml(d) {
  const cs = d.storeText;
  if (!cs || !cs.length)
    return "<p>No store text is saved for these games yet. It is read (free, no AI) by the next preview, or for the pages already downloaded with <code>npm run store-text</code>.</p>";
  let h = '<p class="meta">' + esc(DERIVED_NOTE) + " Matching is by exact words: other word forms and translations are not matched. Korean words keep their endings, so Korean counts are rougher.</p>";
  for (const c of cs) {
    const rows = c.rows.map((r) => "<tr" + (r.ours ? ' class="ours"' : "") + "><th>" + esc(r.name) + (r.ours ? " (ours)" : "") + "</th>"
      + (r.store ? "<td>" + categoryText(r.store) + "</td><td>" + chipList(r.store.tags) + "</td><td>" + chipList(r.store.keywords) + '</td><td class="meta">' + esc(r.store.date) + "</td>"
        : '<td colspan="4" class="meta">Not saved for this country</td>') + "</tr>").join("");
    const miss = !c.oursSaved ? '<p class="meta">Our store text is not saved for this country, so there is nothing to compare.</p>'
      : c.missing.length ? "<p><strong>Competitor keywords not found in our store text</strong> (used by 2 or more competitors):</p><ul>" + c.missing.map((m) => "<li>" + esc(m.term) + ' <span class="meta">(' + esc(m.games.join(", ")) + ")</span></li>").join("") + "</ul>"
      : "<p>Every keyword that 2 or more competitors use also appears in our store text.</p>";
    h += '<details class="subsec"' + (c === cs[0] ? " open" : "") + "><summary>" + esc(c.label) + '</summary><div class="tablewrap"><table class="rt"><tr><th>Game</th><th>Category</th><th>Tags</th><th>Top keywords (derived)</th><th>Read</th></tr>' + rows + "</table></div>" + miss + "</details>";
  }
  return h;
}
`;

/**
 * Wizard steps 3 and 4. Countries: a tick per Google Play country, grouped by region, with its
 * language filled in (and a menu when there is a choice); United States (English) is always in.
 * Charts: include the top-grossing games of our game's category, and how many. Saved at once.
 */
export const WIZARD_COUNTRIES = `
function langName(hl) { return W.cat.languages[hl] || hl; }

function countryRow(c) {
  const m = W.s.markets.find((x) => x.gl === c.gl);
  const hl = m ? m.hl : c.defaultHl;
  const lang = c.languages.length > 1
    ? '<label class="sr" for="hl-' + c.gl + '">Language in ' + esc(c.label) + '</label><select id="hl-' + c.gl + '" data-hl="' + c.gl + '">' + c.languages.map((l) => '<option value="' + esc(l) + '"' + (l === hl ? " selected" : "") + ">" + esc(langName(l)) + "</option>").join("") + "</select>"
    : '<span class="meta">' + esc(langName(hl)) + "</span>";
  return '<div class="crow"><label><input type="checkbox" data-gl="' + c.gl + '"' + (m ? " checked" : "") + "> " + esc(c.label) + "</label>" + lang + "</div>";
}

// The ticked countries in list order, each with its chosen language, read from the page.
function pickedMarkets() {
  return W.cat.countries.filter((c) => c.gl !== "us").flatMap((c) => {
    const box = document.querySelector('input[data-gl="' + c.gl + '"]');
    if (!box || !box.checked) return [];
    const sel = document.querySelector('select[data-hl="' + c.gl + '"]');
    return [{ gl: c.gl, hl: sel ? sel.value : c.defaultHl }];
  });
}

function countryCount() {
  const n = W.s.markets.length - 1;
  $("countryCount").textContent = n ? n + " countr" + (n === 1 ? "y" : "ies") + " plus United States." : "Only United States. Tick the countries whose store pages you want to compare.";
}

DRAW[3] = () => {
  const regions = [...new Set(W.cat.countries.filter((c) => c.gl !== "us").map((c) => c.region))];
  $("step").innerHTML = '<h2>Countries</h2><p class="lead">Which Google Play countries? The language of each is filled in; change it where there is a choice.</p>'
    + '<div class="baseline">United States (English) is always included: it is the baseline and the first comparison.</div>'
    + '<p id="countryCount" class="meta" role="status"></p>'
    + regions.map((r) => '<fieldset><legend>' + esc(r) + '</legend><div class="row" style="margin-bottom:6px"><button type="button" class="btn" data-tickall="' + esc(r) + '">Tick all in ' + esc(r) + '</button><button type="button" class="btn" data-untick="' + esc(r) + '">Untick all</button></div><div class="clist">'
      + W.cat.countries.filter((c) => c.region === r && c.gl !== "us").map(countryRow).join("") + "</div></fieldset>").join("")
    + nav(2, 4);
  countryCount();
};

function saveCountries() { autosave(() => ({ markets: pickedMarkets() }), countryCount); }

document.addEventListener("change", (e) => {
  if (e.target.dataset.gl !== undefined || e.target.dataset.hl !== undefined) saveCountries();
});
document.addEventListener("click", (e) => {
  const t = e.target.closest ? e.target.closest("button") : null;
  if (!t || (t.dataset.tickall === undefined && t.dataset.untick === undefined)) return;
  const region = t.dataset.tickall !== undefined ? t.dataset.tickall : t.dataset.untick;
  const on = t.dataset.tickall !== undefined;
  for (const c of W.cat.countries) if (c.region === region && c.gl !== "us") { const b = document.querySelector('input[data-gl="' + c.gl + '"]'); if (b) b.checked = on; }
  saveCountries();
});

DRAW[4] = () => {
  const c = W.s.charts;
  const isGame = String(W.s.ourApp.genreId || "").startsWith("GAME");
  if (!isGame) {
    $("step").innerHTML = '<h2>Charts</h2><div class="warnbox">Your game is not listed in a game category on Google Play, so the top-grossing charts are switched off. Your competitors are still compared.</div>' + nav(3, 5);
    return;
  }
  const depth = '<label class="sr" for="depth">How many</label><input type="number" id="depth" min="1" max="50" value="' + c.depth + '" style="width:5em">';
  $("step").innerHTML = '<h2>Charts</h2><p class="lead">Also include the top-grossing games in your game\\'s category (' + esc(category(W.s.ourApp.genreId)) + ")?</p>"
    + '<label class="radio"><input type="radio" name="charts" value="yes"' + (c.enabled ? " checked" : "") + "> Yes, the top " + depth + " in each country</label>"
    + '<label class="radio"><input type="radio" name="charts" value="no"' + (c.enabled ? "" : " checked") + "> No</label>"
    + '<p class="meta">Chart games are downloaded and shown, but only analysed if you pick them later. From 1 to 50; 10 is the usual choice.</p>' + nav(3, 5);
};

function saveCharts() {
  const on = document.querySelector('input[name="charts"][value="yes"]').checked;
  const n = Number($("depth").value);
  if (!Number.isInteger(n) || n < 1 || n > 50) { actLine($("saveLine"), "bad", "How many: a whole number from 1 to 50. Not saved yet."); return; }
  autosave({ charts: { enabled: on, depth: n } });
}
document.addEventListener("change", (e) => {
  if (e.target.name === "charts" || e.target.id === "depth") saveCharts();
});
`;

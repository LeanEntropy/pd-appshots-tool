/**
 * "What next?" (plan-reports 5, milestone R3): after the Pilot, the expansion options are cards in
 * the Reports tab's cards row, after the report cards and in another colour (report-cards.ts):
 * Run the Full check (highly recommended while there is none), Compare countries, and Add more
 * competitors in the main country. Each opens the report builder prefilled. Nothing runs from
 * here: the builder shows its numbers first.
 */
export const EXPAND_SCRIPT = `
let whatNext = null;
let whatNextError = "";

// One option as a slim card: title, cost chip, one short line and one button; the rest behind Details.
function nextOption(cls, title, chip, text, button, details) {
  return '<div class="rtcard rt-act ' + cls + '"><div class="rt-top"><h4>' + title + '</h4><span class="chip">' + chip + '</span></div><p class="why">' + text + "</p>"
    + (details ? '<details class="offer-more"><summary>Details</summary>' + details + "</details>" : "")
    + '<div class="rt-acts">' + button + "</div></div>";
}

function whatNextHtml(o) {
  const main = countryLabel(o.main.gl, theCountryOf(o.main.label));
  const core = !o.coreReady
    ? nextOption("c-full-check", "Run the Full check", "Recommended", "It strengthens every other report.", '<button type="button" class="primary wnext" data-next="core">Run the Full check</button>',
      "<p>A full analysis of your picked competitors in the main country. The builder shows the exact images and cost first.</p>")
    : "";
  return core
    + nextOption("", "Compare countries", "Cost shown first", "Where competitors change their images between countries.", '<button type="button" class="wnext" data-next="compare">Compare countries</button>',
      '<p>Missing a country? Add it to the project first (downloading its store pages is free).</p><div class="rt-acts"><button type="button" class="cpOpen" data-act-key="cp-next">Add countries</button></div>')
    + nextOption("c-charts", "Add more competitors in " + main, "Cost shown first", "More games in the main country.", '<button type="button" class="wnext" data-next="more">Add more competitors</button>',
      "<p>A report of more games in " + esc(theCountryOf(o.main.label)) + ", starting from the same pick. The builder opens with the choices filled in; nothing runs until you approve.</p>");
}

// The option cards for the cards row (none before the Pilot opens the other reports).
function whatNextCards() {
  if (whatNextError) return '<p class="act-msg bad" role="alert">The next steps could not be loaded: ' + esc(whatNextError) + "</p>";
  return whatNext && whatNext.types.country.open ? whatNextHtml(whatNext) : "";
}

async function loadExpansion() {
  if (!location.protocol.startsWith("http")) return;
  try { whatNext = await getJson(API + "/reports/builder"); whatNextError = ""; }
  catch (e) { whatNextError = actReason(e); }
  if (typeof renderCards === "function") renderCards();
}

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("button.wnext");
  if (!b || !whatNext) return;
  const main = whatNext.main;
  const pre = b.dataset.next === "core" ? { type: "core" }
    : b.dataset.next === "compare" ? { type: "compare", scope: { type: "compare", markets: [], competitors: whatNext.pick, includeCharts: [] } }
    : { type: "country", scope: { type: "country", markets: [main], competitors: whatNext.pick, includeCharts: [] } };
  act(b, { busy: "Opening the builder...", run: () => openBuilder(pre), done: "" });
});
window.addEventListener("hashchange", () => { if (pageFromHash(location.hash) === "report") { loadExpansion(); loadSuggestions(); } });
if (pageFromHash(location.hash) === "report") { loadExpansion(); loadSuggestions(); }
`;

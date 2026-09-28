/**
 * "What next?" (plan-reports 5, milestone R3): after the Pilot, the expansion question becomes a
 * card with three buttons that open the report builder prefilled: Run the Full check (highly
 * recommended while there is none), Compare countries, and Add more competitors in the main
 * country. Saved expansion choices were turned into draft reports (listed below). Nothing runs
 * from here: the builder shows its numbers first.
 */
export const EXPAND_SCRIPT = `
let whatNext = null;

// One option as a box of the side-by-side offers grid (report-suggest.ts): title, cost chip, one
// short line and one button; the rest behind Details.
function nextOption(cls, title, chip, text, button, details) {
  return '<div class="offer ' + cls + '"><div class="offer-top"><h4>' + title + '</h4><span class="chip">' + chip + '</span></div><p class="why">' + text + "</p>"
    + (details ? '<details class="offer-more"><summary>Details</summary>' + details + "</details>" : "")
    + '<div class="offer-acts">' + button + "</div></div>";
}

function whatNextHtml(o) {
  const main = countryLabel(o.main.gl, theCountryOf(o.main.label));
  const core = !o.coreReady
    ? nextOption("c-full-check", "Run the Full check", "Recommended", "It strengthens every other report.", '<button type="button" class="primary wnext" data-next="core">Run the Full check</button>',
      "<p>A full analysis of your picked competitors in the main country. The builder shows the exact images and cost first.</p>")
    : "";
  return '<section class="card expand" aria-labelledby="expandTitle"><h3 id="expandTitle">What next?</h3><div class="offers">' + core
    + nextOption("", "Compare countries", "Cost shown first", "Where competitors change their images between countries.", '<button type="button" class="wnext" data-next="compare">Compare countries</button>',
      '<p>Missing a country? Add it to the project first (downloading its store pages is free).</p><div class="offer-acts"><button type="button" class="cpOpen" data-act-key="cp-next">Add countries</button></div>')
    + nextOption("c-charts", "Add more competitors in " + main, "Cost shown first", "More games in the main country.", '<button type="button" class="wnext" data-next="more">Add more competitors</button>',
      "<p>A report of more games in " + esc(theCountryOf(o.main.label)) + ", starting from the same pick.</p>")
    + '</div><p class="meta">Each opens the report builder with the choices filled in. Nothing runs until you approve.</p></section>';
}

async function loadExpansion() {
  const el = document.getElementById("expansion");
  if (!el || !location.protocol.startsWith("http")) return;
  try {
    whatNext = await getJson(API + "/reports/builder");
    el.innerHTML = whatNext.types.country.open ? whatNextHtml(whatNext) : "";
  } catch (e) { el.innerHTML = '<p class="act-msg bad" role="alert">The next steps could not be loaded: ' + esc(actReason(e)) + "</p>"; }
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

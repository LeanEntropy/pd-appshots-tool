/**
 * "What next?" (plan-reports 5, milestone R3): after the Pilot, the expansion question becomes a
 * card with three buttons that open the report builder prefilled: Run the Full check (highly
 * recommended while there is none), Compare countries, and Add more competitors in the main
 * country. Saved expansion choices were turned into draft reports (listed below). Nothing runs
 * from here: the builder shows its numbers first.
 */
export const EXPAND_SCRIPT = `
let whatNext = null;

// One option as a box of the side-by-side offers grid (report-suggest.ts), its buttons at the bottom.
function nextOption(cls, title, text, buttons) {
  return '<div class="offer ' + cls + '"><h4>' + title + '</h4><p class="why">' + text + '</p><div class="offer-acts">' + buttons + "</div></div>";
}

function whatNextHtml(o) {
  const main = countryLabel(o.main.gl, theCountryOf(o.main.label));
  const core = !o.coreReady
    ? nextOption("c-full-check", "Run the Full check", "Highly recommended: it strengthens every other report.", '<button type="button" class="primary wnext" data-next="core">Run the Full check</button>')
    : "";
  return '<section class="card expand" aria-labelledby="expandTitle"><h3 id="expandTitle">What next?</h3><div class="offers">' + core
    + nextOption("", "Compare countries", "See where competitors change their images between countries. Missing a country? Add it to the project first.", '<button type="button" class="wnext" data-next="compare">Compare countries</button><button type="button" class="cpOpen" data-act-key="cp-next">Add countries</button>')
    + nextOption("c-charts", "Add more competitors in " + main, "A report of more games in the main country, with the same pick to start from.", '<button type="button" class="wnext" data-next="more">Add more competitors</button>')
    + '</div><p class="meta">Each opens the report builder with the choices filled in. It shows the exact images and cost first; nothing runs until you approve.</p></section>';
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

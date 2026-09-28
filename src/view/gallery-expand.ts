/**
 * "What next?" (plan-reports 5, milestone R3): after the Pilot, the expansion question becomes a
 * card with three buttons that open the report builder prefilled: Run the Full check (highly
 * recommended while there is none), Compare countries, and Add more competitors in the main
 * country. Saved expansion choices were turned into draft reports (listed below). Nothing runs
 * from here: the builder shows its numbers first.
 */
export const EXPAND_SCRIPT = `
let whatNext = null;

function whatNextHtml(o) {
  const core = !o.coreReady
    ? '<p><button type="button" class="primary wnext" data-next="core">Run the Full check</button> <span class="meta">Highly recommended: it strengthens every other report.</span></p>'
    : "";
  return '<section class="card expand" aria-labelledby="expandTitle"><h3 id="expandTitle">What next?</h3>' + core
    + '<p><button type="button" class="wnext" data-next="compare">Compare countries</button> <button type="button" class="wnext" data-next="more">Add more competitors in ' + esc(theCountryOf(o.main.label)) + "</button></p>"
    + '<p class="meta">Each opens the report builder with the choices filled in. It shows the exact images and cost first; nothing runs until you approve.</p></section>';
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

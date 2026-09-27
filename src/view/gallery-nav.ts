/**
 * Page menu: one page per tab, the choice kept in the URL hash (#overview, #competitors,
 * #screenshots, #analysis, #report), so back/forward and reload keep it. Hidden pages are only
 * hidden, and their lazy images do not load until shown.
 */
export const NAV_SCRIPT = `
const PAGES = ["overview", "competitors", "screenshots", "analysis", "report"];

// Pure: any hash to a page name, with a fixed fallback.
function pageFromHash(h) {
  const p = String(h || "").replace(/^#/, "").toLowerCase();
  return PAGES.includes(p) ? p : "screenshots";
}

function showPage(focus) {
  const page = pageFromHash(location.hash);
  document.querySelectorAll("main.pages > section[data-page]").forEach((s) => { s.hidden = s.dataset.page !== page; });
  document.querySelectorAll("nav.tabs a[data-tab]").forEach((a) => {
    if (a.dataset.tab === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (page === "screenshots" && typeof updateGridHint === "function") updateGridHint(document.querySelectorAll("#grid thead th").length - 1);
  if (page === "report" && typeof loadReport === "function") loadReport();
  if (focus) { const h = document.querySelector('section[data-page="' + page + '"] > h2.ph'); if (h) h.focus(); }
}

function goTo(page) {
  if (pageFromHash(location.hash) === page && location.hash) showPage(true);
  else location.hash = "#" + page;
}

window.addEventListener("hashchange", () => showPage(true));
`;

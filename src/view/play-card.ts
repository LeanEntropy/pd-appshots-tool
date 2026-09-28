/**
 * Google Play game cards, shared by the new-project wizard and the Competitors tab: the store
 * icon (or a letter), rating, category in words, and the "How close is it?" choices. Plain JS;
 * needs esc() from the page.
 */
export const PLAY_CARD_SCRIPT = `
const TIERS = [["direct", "Direct competitor"], ["same_audience", "Same audience"], ["reference", "Big reference game"]];

// A store icon: the saved copy for the project's games, Google's picture for search results.
function icon(src, name, small) {
  const cls = "ico" + (small ? " sm" : "");
  const letter = '<span class="' + cls + '" aria-hidden="true">' + esc((name || "?").slice(0, 1).toUpperCase()) + "</span>";
  if (!src) return letter;
  return '<img class="' + cls + '" src="' + esc(src) + '" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.outerHTML=this.dataset.fallback" data-fallback="' + esc(letter) + '">';
}
function googleIcon(url) {
  return /^https:\\/\\/[a-z0-9-]+\\.(googleusercontent|ggpht)\\.com\\//.test(url || "") ? url + "=s96" : "";
}
function stars(score) { return typeof score === "number" && score > 0 ? score.toFixed(1) + " stars" : "no rating yet"; }
function category(genreId) {
  const g = String(genreId || "").replace(/^GAME_?/, "").toLowerCase().replace(/_/g, " ");
  return g ? g.charAt(0).toUpperCase() + g.slice(1) : "Games";
}
`;

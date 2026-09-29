/**
 * A game's icon tile for any page (home cards now; a project header can reuse it): the game's
 * Google Play icon from the shared library, served by the tool (/app-icons/<sha>.webp), over the
 * letter tile. The letter shows until the picture has loaded and stays when there is none or it
 * fails. Plain JS; the page's script defines esc() and send() (ACTION_SCRIPT).
 */
export const APP_ICON_SCRIPT = `
const iconFailed = new Set();
const iconAsked = new Set();
function appIconHtml(name, src, cls) {
  const img = src && !iconFailed.has(src) ? '<img alt="' + esc(name) + '" src="' + esc(src) + '" data-app-icon="1">' : "";
  return '<span class="' + (cls || "icon") + ' app-icon"><span aria-hidden="true">' + esc((name || "?").slice(0, 1).toUpperCase()) + "</span>" + img + "</span>";
}
document.addEventListener("error", (e) => {
  const i = e.target;
  if (i && i.dataset && i.dataset.appIcon) { iconFailed.add(i.getAttribute("src")); i.remove(); }
}, true);
// Missing or stale icons are fetched in the background, one game at a time, once per page load
// (free, no AI); each item is { id, appIcon, iconStale }; ready() runs when an icon arrives.
async function fetchAppIcons(items, ready) {
  for (const p of items) {
    if (!p.iconStale || iconAsked.has(p.id) || (typeof actLeaving !== "undefined" && actLeaving)) continue;
    iconAsked.add(p.id);
    try {
      const r = await send("/api/app-icon", { projectId: p.id });
      if (r && r.src && r.src !== p.appIcon) { p.appIcon = r.src; ready(p); }
    } catch {}
  }
}
`;

/** The tile's picture: same box and rounded corners as the letter tile it covers. */
export const APP_ICON_CSS = `
.app-icon { position: relative; overflow: hidden; }
.app-icon img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
`;

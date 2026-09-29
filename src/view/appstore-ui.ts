import { escHtml } from "./shell.ts";

/**
 * The small App Store parts of the project pages (plan-app-store 5; decision 5: generic store
 * icons with a text tooltip, never the official logos):
 * - Settings: the project's explicit "App Store" switch;
 * - Competitors tab: which games have App Store decks (store marks per game) and one confirm
 *   card per game whose match is not certain. Nothing is guessed: a card waits for one click.
 */
const PLAY_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>';
const APPLE_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 2 3 14h2.2l1-2.6h3.6l1 2.6H13zm0 3.4 1.2 4.2H6.8z" fill="currentColor"/></svg>';

export const APPSTORE_CSS = `
.store-mark { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 5px; margin-left: 4px; vertical-align: -4px; color: #fff; }
.store-mark.play { background: #1a8f5a; } .store-mark.appstore { background: #1f6fd1; }
#appstorePanel .as-games { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 6px 0; }
#appstorePanel .as-cards { display: flex; flex-wrap: wrap; gap: 12px; }
#appstorePanel .as-card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; width: 300px; }
#appstorePanel .as-card h3 { margin: 0 0 4px; font-size: 15px; }
#appstorePanel .as-cand { display: flex; gap: 8px; align-items: flex-start; margin: 8px 0; }
#appstorePanel .as-cand img.icon { width: 44px; height: 44px; border-radius: 10px; }
#appstorePanel .as-cand img.shot { width: 44px; height: 88px; object-fit: cover; border-radius: 4px; }
`;

export function storeMarkHtml(platform: "play" | "appstore", countries: readonly string[]): string {
  const name = platform === "play" ? "Google Play" : "App Store";
  const tip = escHtml(countries.length ? `${name}: ${countries.join(", ")}` : name);
  return `<span class="store-mark ${platform}" role="img" title="${tip}" aria-label="${tip}">${platform === "play" ? PLAY_SVG : APPLE_SVG}</span>`;
}

/** Settings: the project's App Store switch (off by default; nothing Apple is read while off). */
export function appStoreBoxHtml(id: string, enabled: boolean): string {
  return `<section class="card" id="appstoreBox" data-id="${escHtml(id)}"><h2>App Store ${storeMarkHtml("appstore", [])}</h2>
<p class="meta">Google Play stays the default. When this is on, the tool may also read this project's App Store pages (free, through Apple's public Lookup API; no AI). Paid analysis always asks first.</p>
<p><label><input type="checkbox" id="appstoreOn" ${enabled ? "checked" : ""}> Use the App Store for this project</label></p>
<p id="appstoreStatus" class="act-msg" hidden></p></section>`;
}

export const APPSTORE_SETTINGS_SCRIPT = `
document.addEventListener("change", (e) => {
  const t = e.target;
  if (!t || t.id !== "appstoreOn") return;
  const box = document.getElementById("appstoreBox");
  const on = t.checked;
  act(t, {
    busy: "Saving...",
    status: "appstoreStatus",
    run: () => send("/p/" + encodeURIComponent(box.dataset.id) + "/api/appstore/enabled", { enabled: on }),
    done: (r) => r.message,
    fail: () => { t.checked = !on; },
  });
});
`;

/** Competitors tab placeholder: filled by the script when the project's App Store is on. */
export const APPSTORE_PANEL_HTML = '<div id="appstorePanel" class="card" hidden></div>';

export const APPSTORE_PANEL_SCRIPT = `
(() => {
  const panel = document.getElementById("appstorePanel");
  const base = (JSON.parse((document.getElementById("app") || {}).textContent || "{}").apiBase || "/api");
  if (!panel || !base.startsWith("/p/")) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const mark = (p, list) => { const n = p === "play" ? "Google Play" : "App Store"; const tip = esc(list.length ? n + ": " + list.join(", ") : n);
    return '<span class="store-mark ' + p + '" role="img" title="' + tip + '" aria-label="' + tip + '">' + (p === "play" ? ${JSON.stringify(PLAY_SVG)} : ${JSON.stringify(APPLE_SVG)}) + "</span>"; };
  function card(g, label) {
    const waiting = Object.entries(g.byCountry).filter(([, m]) => m.status === "needs_confirmation");
    if (!waiting.length) return "";
    const cands = new Map();
    for (const [gl, m] of waiting) for (const c of m.candidates) { const x = cands.get(c.trackId) || { c, gls: [] }; x.gls.push(label(gl)); cands.set(c.trackId, x); }
    const rows = [...cands.values()].slice(0, 3).map(({ c, gls }) =>
      '<div class="as-cand">' + (c.iconUrl ? '<img class="icon" alt="" referrerpolicy="no-referrer" src="' + esc(c.iconUrl) + '">' : "") +
      (c.firstScreenshot ? '<img class="shot" alt="" referrerpolicy="no-referrer" src="' + esc(c.firstScreenshot) + '">' : "") +
      '<div><strong>' + esc(c.trackName) + '</strong><br><span class="meta">' + esc(c.sellerName) + " · " + esc(c.signals.join(", ")) + "<br>" + esc(gls.join(", ")) + '</span><br>' +
      '<button type="button" class="btn" data-as-app="' + esc(g.appId) + '" data-as-track="' + c.trackId + '" data-act-key="as-' + esc(g.appId) + "-" + c.trackId + '">Yes, this app</button></div></div>').join("");
    return '<div class="as-card"><h3>Is this ' + esc(g.name) + ' on the App Store?</h3><p class="meta">Not matched automatically: please confirm once.</p>' + rows +
      '<button type="button" class="btn" data-as-app="' + esc(g.appId) + '" data-as-track="none" data-act-key="as-' + esc(g.appId) + '-none">Not on the App Store</button></div>';
  }
  function draw(v) {
    panel.hidden = !v.enabled;
    if (!v.enabled) return;
    const label = (gl) => (v.countries.find((c) => c.gl === gl) || { label: gl.toUpperCase() }).label;
    const games = v.games.map((g) => '<span>' + esc(g.name) + (g.decks.length ? mark("appstore", g.decks.map(label)) : "") + "</span>").join("");
    const cards = v.games.map((g) => card(g, label)).join("");
    panel.innerHTML = '<h2>App Store</h2><p class="meta">Games with App Store pages read (hover the mark for the countries).</p><div class="as-games">' + games + "</div>" +
      (cards ? '<h3>Please confirm</h3><div class="as-cards">' + cards + "</div>" : '<p class="meta">No match is waiting for you.</p>') + '<p id="asStatus" class="act-msg" hidden></p>';
  }
  getJson(base + "/appstore").then(draw).catch(() => {});
  panel.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target.closest("button[data-as-app]") : null;
    if (!t) return;
    const trackId = t.dataset.asTrack === "none" ? null : Number(t.dataset.asTrack);
    act(t, {
      busy: "Saving...",
      status: "asStatus",
      keep: true,
      run: () => send(base + "/appstore/confirm", { appId: t.dataset.asApp, trackId }),
      done: (r) => { const msg = r.message; draw(r.view); return msg; },
    });
  });
})();
`;

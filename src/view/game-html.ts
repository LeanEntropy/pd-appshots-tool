import type { GamePage, Strip, Thumb } from "../server/game-view.ts";
import { ACTION_SCRIPT } from "./action.ts";
import { APP_ICON_CSS, APP_ICON_SCRIPT } from "./app-icon.ts";
import { countryLabel, FLAG_CSS } from "./flags.ts";
import { CSS as GALLERY_CSS } from "./gallery-css.ts";
import { INFO_SCRIPT } from "./gallery-info.ts";
import { LIB_CSS } from "./library-css.ts";
import { page } from "./pages-html.ts";
import { appBar, escHtml as esc } from "./shell.ts";
import { STORE_MARK_CSS, storeMarksHtml } from "./store-marks.ts";

const ICON_SRC = /^\/app-icons\/[0-9a-f]{64}\.webp$/;

/**
 * The game page (plan-games-library 4): one strip per country (flag in the strip heading only),
 * store order from the deck, each picture marked against the main country's page, opening its
 * image page in a new tab, with the (i) popover of the project page. Store text and keywords
 * are folded.
 */
/** Only the (i) button and popover rules of the project page's stylesheet. */
const INFO_CSS = GALLERY_CSS.split("\n")
  .filter((l) => /^(button\.info|#infoPop|\.sw )/.test(l))
  .join("\n");

const GAME_CSS = `
.strip { padding: 14px 24px; border-top: 1px solid var(--a-div); }
.strip h2 { margin: 0 0 8px; font-size: 16px; color: var(--a-h); display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.strip h2 .meta { font-size: 13px; font-weight: 400; }
.thumbs { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px; }
.thumbs figure { position: relative; margin: 0; flex: none; width: 112px; }
.thumbs figure img { display: block; width: 112px; height: 190px; object-fit: contain; background: var(--a-grey); border-radius: 6px; }
.thumbs figcaption { font-size: 12px; line-height: 1.3; margin-top: 3px; overflow-wrap: anywhere; }
.thumbs .pos { font-weight: 800; color: var(--a-h); margin-right: 4px; }
.thumbs .failed { width: 112px; height: 190px; display: grid; place-items: center; text-align: center; padding: 8px; font-size: 12px; background: var(--a-grey); color: var(--a-muted); border-radius: 6px; }
.ghead2 { display: flex; gap: 12px; align-items: center; min-width: 0; }
.ghead2 h1 { flex: 0 1 auto; }
.ghead2 .icon { width: 52px; height: 52px; flex: none; border-radius: 12px; display: grid; place-items: center; font-weight: 800; font-size: 22px; color: var(--a-head); background: #fff; }
`;

function thumb(t: Thumb, s: Strip, appId: string, info: GamePage["info"]): string {
  if (!t.sha || !t.thumb)
    return `<figure><div class="failed">Screenshot could not be saved</div><figcaption><span class="pos">#${esc(t.position)}</span></figcaption></figure>`;
  const ctx = [appId, s.gl, s.hl, t.position].join("|");
  const marks = [
    t.mark ? `<span title="${esc(t.markHint)}">${esc(t.mark)}</span>` : "",
    t.sameScreenAs
      ? `<span class="meta" title="The same screen, uploaded twice on this page.">same screen as #${esc(t.sameScreenAs)}</span>`
      : "",
  ].filter(Boolean);
  return `<figure><a href="${esc(t.href)}" target="_blank" rel="noopener" title="Open the image page (new tab)"><img loading="lazy" src="${esc(t.thumb)}" alt="${esc(`Position ${t.position}`)}"></a>${infoButton(t.sha, ctx, info)}<figcaption><span class="pos">#${esc(t.position)}</span>${marks.join("<br>")}</figcaption></figure>`;
}

/** The same (i) button as the project page (its popover script is shared). */
function infoButton(sha: string, ctx: string, info: GamePage["info"]): string {
  const v = info[sha];
  if (!v) return "";
  const a = `type="button" data-info="${esc(sha)}" data-ctx="${esc(ctx)}" aria-expanded="false" aria-controls="infoPop"`;
  return v.pending
    ? `<button ${a} class="info pending" aria-label="Not analysed yet" title="Not analysed yet">&hellip;</button>`
    : `<button ${a} class="info" aria-label="Show analysis">i</button>`;
}

function strip(s: Strip, appId: string, info: GamePage["info"]): string {
  const n = s.thumbs.filter((t) => t.sha).length;
  const meta = [
    s.status === "ok"
      ? `${n} images`
      : s.status === "unavailable"
        ? "not sold here"
        : "could not be read",
    s.checked ? `store checked ${s.checked}` : "",
    s.main ? "main country" : "",
  ].filter(Boolean);
  return `<section class="strip"><h2>${countryLabel(s.gl, s.label)}<span class="meta">${esc(meta.join(" · "))}</span></h2>${
    s.status === "ok"
      ? `<div class="thumbs">${s.thumbs.map((t) => thumb(t, s, appId, info)).join("")}</div>`
      : ""
  }</section>`;
}

function storeFolds(p: GamePage): string {
  const checked = new Map(p.strips.map((s) => [`${s.gl}|${s.hl}`, s.checked]));
  const text = p.storeText
    .map((t) => {
      const shots = checked.get(`${t.gl}|${t.hl}`) ?? "";
      const when =
        shots && shots !== t.date ? `text read ${t.date}, screenshots ${shots}` : `read ${t.date}`;
      if (t.sameAs)
        return `<h3>${countryLabel(t.gl, t.label)}</h3><p class="meta">Same text as ${esc(t.sameAs)} (${esc(when)}).</p>`;
      return `<h3>${countryLabel(t.gl, t.label)}</h3><ul class="rows">
<li><span class="k">Title</span> ${esc(t.title ?? "")}</li>
<li><span class="k">Short description</span> ${esc(t.shortDescription ?? "")}</li>
<li><span class="k">Category</span> ${esc([t.category, t.chipCategory].filter(Boolean).join(", "))}</li>
<li><span class="k">Tags</span> ${esc(t.tags.join(", "))}</li></ul><p class="meta">${esc(when)}</p>`;
    })
    .join("");
  const kw = p.storeText
    .map(
      (t) =>
        `<li><span class="k">${esc(t.label)}</span> ${esc(t.keywords.join(", ") || "none")}</li>`,
    )
    .join("");
  return `<details class="fold"><summary>Store text per country</summary>${text || '<p class="meta">No store text saved yet.</p>'}</details>
<details class="fold"><summary>Keywords per country</summary><p class="meta">Keywords derived from the store text (Google Play has no official keywords).</p>${kw ? `<ul class="rows">${kw}</ul>` : '<p class="meta">No store text saved yet.</p>'}</details>`;
}

export function gameHtml(p: GamePage, token: string): string {
  const shownAs =
    p.choices.length > 1
      ? `<span class="grow"></span><label>Shown as: <select id="shownAs">${p.choices.map((o) => `<option value="${esc(o.href)}"${o.id === p.project.id ? " selected" : ""}>${esc(o.name)}${o.archived ? " (archived)" : ""}</option>`).join("")}</select></label><span id="shownMsg" class="act-msg" hidden></span>`
      : "";
  const icon = `<span class="icon app-icon"><span aria-hidden="true">${esc((p.name || "?").slice(0, 1).toUpperCase())}</span>${p.icon && ICON_SRC.test(p.icon) ? `<img alt="" src="${esc(p.icon)}" data-app-icon="1">` : ""}</span>`;
  const meta = [p.category, `${p.images} images, ${p.analysed} analysed`]
    .filter(Boolean)
    .join(" · ");
  const used = p.uses
    .map(
      (u) =>
        `${esc(u.name)} (${esc(u.role)})${u.archived ? " (archived)" : ""} <a class="btn" href="/p/${esc(encodeURIComponent(u.id))}/">Open</a>`,
    )
    .join(" ");
  const data = JSON.stringify({
    info: p.info,
    project: p.project.id,
    appId: p.appId,
    name: p.name,
    icon: p.icon,
    iconStale: p.iconStale,
  }).replace(/</g, "\\u003c");
  const body = `${appBar(null, '<a class="btn-new" href="/games">Games library</a>')}
<main class="lib">
<nav class="lib-crumbs" aria-label="Where you are"><a href="/games">Games library</a> / <span>${esc(p.name)}</span>${shownAs}</nav>
${p.notice ? `<section class="band notice" role="note">${esc(p.notice)}</section>` : ""}
<header class="lib-head"><div class="ghead2">${icon}<h1>${esc(p.name)}</h1>${storeMarksHtml(p.stores)}</div><span class="sub">${esc(meta)}</span></header>
<section class="band plain"><p>Used in: ${used}</p><p class="meta">Click a picture to open its image page in a new tab; the (i) shows its analysis.</p></section>
${p.strips.map((s) => strip(s, p.appId, p.info)).join("")}
${storeFolds(p)}
</main>
<div id="infoPop" role="dialog" aria-label="Screenshot analysis" hidden></div>
<style>${LIB_CSS}${FLAG_CSS}${APP_ICON_CSS}${STORE_MARK_CSS}${INFO_CSS}${GAME_CSS}</style>
<script type="application/json" id="data">${data}</script>`;
  return page(
    `${p.name} · Games library`,
    body,
    token,
    `${ACTION_SCRIPT}${APP_ICON_SCRIPT}${GAME_SCRIPT}`,
  );
}

const GAME_SCRIPT = `
const DATA = JSON.parse(document.getElementById("data").textContent);
const esc = actEsc;
const APP = { apiBase: "/p/" + encodeURIComponent(DATA.project) + "/api" };
${INFO_SCRIPT}
// The header shows the letter until the icon is in the library; a missing one is fetched now.
if (DATA.iconStale) fetchAppIcons([{ id: DATA.appId, appIcon: DATA.icon, iconStale: true }], (p) => {
  const t = document.querySelector(".ghead2 .app-icon");
  if (t) t.outerHTML = appIconHtml(DATA.name, p.appIcon);
}, { ask: (p) => send("/api/games/icon", { appId: p.id }) });
const shown = document.getElementById("shownAs");
if (shown) shown.addEventListener("change", () => {
  const href = shown.value;
  if (!href.startsWith("/games/")) return;
  // The next page loads in this tab: a busy line until it does (the select stays usable).
  act(null, { key: "shownAs", busy: "Opening the game as that project sees it...", status: "shownMsg", run: () => new Promise(() => { location.href = href; }) });
});
`;

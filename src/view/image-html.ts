import type { ImagePage } from "../server/image-view.ts";
import type { WhereRow } from "../server/image-where.ts";
import { ACTION_SCRIPT } from "./action.ts";
import { countryLabel, FLAG_CSS } from "./flags.ts";
import { INFO_SCRIPT } from "./gallery-info.ts";
import { LIB_CSS } from "./library-css.ts";
import { page } from "./pages-html.ts";
import { appBar, escHtml as esc } from "./shell.ts";

/**
 * The image page (plan-games-library 2.2): default open clean (header, the picture, focus,
 * the numbered wireframes, texts with English, where it is used, one footer line), everything
 * else folded. Server-built HTML goes through esc; the wireframes and the raw reading are drawn
 * by the page's script from the embedded JSON (text as textContent, as in the (i) popover).
 */
const row = (k: string, v: string, cls = "") =>
  `<li${cls ? ` class="${cls}"` : ""}><span class="k">${esc(k)}</span> ${v}</li>`;

function whereRow(r: WhereRow): string {
  const state = r.state
    ? `<span class="state ${r.state === "matched" ? "matched" : ""}">${esc(r.state)}</span>`
    : "";
  const note = r.note ? ` <span class="meta">(${esc(r.note)})</span>` : "";
  const link = r.current ? esc(r.label) : `<a href="${esc(r.href)}">${esc(r.label)}</a>`;
  return `<li${r.current ? ' class="current"' : ""}>${link}${note}${state}</li>`;
}

function whereBand(p: ImagePage): string {
  const w = p.where;
  const part = (title: string, rows: WhereRow[], extra = "") =>
    rows.length || extra
      ? `<h3 class="meta">${esc(title)}</h3><ul class="rows">${rows.map(whereRow).join("")}</ul>${extra ? `<p class="meta">${esc(extra)}</p>` : ""}`
      : "";
  const none = (n: number, what: string) => (n ? `${n} other ${what} checked: no match.` : "");
  return `<section class="band blue" id="where"><h2>Where it is used</h2>
${part(`In ${p.project.name}`, w.here)}
${part("Same picture, new text (other countries)", w.newText, none(w.newTextNoMatch, w.newTextNoMatch === 1 ? "picture" : "pictures"))}
${part("Same screen uploaded twice (this store page)", w.sameScreen, none(w.sameScreenNoMatch, w.sameScreenNoMatch === 1 ? "slot" : "slots"))}
${part("Also in other projects", w.others)}</section>`;
}

function focusBand(p: ImagePage): string {
  const f = p.focus;
  if (!f)
    return `<section class="band teal" id="focus"><h2>Focus</h2><p>${esc(p.layoutNote || "Not analysed yet.")}</p></section>`;
  return `<section class="band teal" id="focus"><h2>Focus</h2><ul class="rows">
${row("Shows off", esc(f.focus || "Not analysed yet"))}
${row("Marketing covers", esc(f.covers || "Nothing named"))}
${row("Reinforcement", esc(f.reinforcement || "Not analysed yet"))}
${row("Focus match", f.verdict === "mismatch" ? `<span class="bad">${esc(f.match)}</span>` : esc(f.match || "Not judged"))}
</ul></section>`;
}

function textsBand(p: ImagePage): string {
  if (!p.texts.length)
    return `<section class="band sand" id="texts"><h2>Texts</h2><p class="meta">${p.info?.final ? "No marketing text on this picture." : "Not analysed yet."}</p></section>`;
  const rows = p.texts.map((t) =>
    row(
      t.role,
      `<span class="said" lang="${esc(t.language)}">${esc(t.text)}</span><br>${
        t.from === "original"
          ? '<span class="meta">English original</span>'
          : t.english
            ? `English: ${esc(t.english)} <span class="meta">(from the ${esc(t.from)})</span>`
            : '<span class="meta">English not saved yet</span>'
      }`,
    ),
  );
  return `<section class="band sand" id="texts"><h2>Texts</h2><ul class="rows">${rows.join("")}</ul></section>`;
}

const pairs = (xs: [string, string][]) =>
  `<ul class="rows">${xs.map(([k, v]) => row(k, esc(v))).join("")}</ul>`;

function folds(p: ImagePage): string {
  const colours = p.colours
    .map(
      (c) =>
        `<li><span class="k">${esc(c.label)}</span> ${c.colours.map((x) => `<span class="sw" style="background:${x.hex || "transparent"}"></span>${esc(x.name)}`).join(" ")}</li>`,
    )
    .join("");
  const h = p.history;
  const attempts = h.attempts.length
    ? `<ul class="rows">${h.attempts.map((a) => `<li>${esc(a.when)} · ${esc(a.what)} · ${esc(a.state)} · ${esc(a.usd)}</li>`).join("")}</ul><p>Total: ${esc(h.total)}</p>`
    : '<p class="meta">No paid attempts logged for this picture.</p>';
  return `<details class="fold"><summary>Measured facts</summary>${p.measured.length ? pairs(p.measured) : '<p class="meta">No facts saved.</p>'}</details>
<details class="fold"><summary>Colours</summary>${colours ? `<ul class="rows">${colours}</ul>` : '<p class="meta">No colours saved.</p>'}</details>
<details class="fold"><summary>Raw fields</summary>${pairs(p.raw)}<div id="rawInfo" class="meta"></div></details>
<details class="fold"><summary>History</summary>${attempts}${h.notes.map((n) => `<p class="meta">${esc(n)}</p>`).join("")}</details>`;
}

export function imageHtml(p: ImagePage, token: string): string {
  const c = p.context;
  const gameHref = `/games/${encodeURIComponent(c.app)}?project=${encodeURIComponent(p.project.id)}`;
  const shownAs =
    p.choices.length > 1
      ? `<span class="grow"></span><label>Shown as: <select id="shownAs">${p.choices.map((o) => `<option value="${esc(o.href)}"${o.id === p.project.id ? " selected" : ""}>${esc(o.name)}${o.archived ? " (archived)" : ""}</option>`).join("")}</select></label><span id="shownMsg" class="act-msg" hidden></span>`
      : "";
  const hd = p.header;
  const sub = [
    hd.screenHint ? `<abbr title="${esc(hd.screenHint)}">${esc(hd.screen)}</abbr>` : esc(hd.screen),
    esc(hd.size),
    esc(hd.logo),
  ].filter(Boolean);
  const picture = `<div class="pic" id="picture"><a href="${esc(p.picture.src)}" id="picLink"><img class="big" id="bigPic" src="${esc(p.picture.src)}" alt="${esc(`${c.game}, ${c.country}, position ${c.pos}`)}"></a>
${p.picture.previewOnly ? `<p>Preview only (shared Light copy). <a class="btn" href="${esc(p.picture.overview)}">Download full-size pictures</a></p>` : ""}</div>`;
  const wf = p.wireframe
    ? `<div id="wf"></div>${p.summary ? `<p class="meta">In one sentence: ${esc(p.summary)}</p>` : ""}${p.older ? '<p class="meta">Drawn from a layout saved by an older version.</p>' : ""}${
        p.layoutNotes.length
          ? `<details class="fold"><summary>Layout notes (${p.layoutNotes.length})</summary><ul class="rows">${p.layoutNotes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></details>`
          : ""
      }`
    : `<p>${esc(p.layoutNote || "Not analysed yet.")}</p>`;
  const data = JSON.stringify({ project: p.project, wireframe: p.wireframe, info: p.info }).replace(
    /</g,
    "\\u003c",
  );
  const body = `${appBar(null, '<a class="btn-new" href="/games">Games library</a>')}
<main class="lib">
<nav class="lib-crumbs" aria-label="Where you are"><a href="/games">Games library</a> / <a href="${esc(gameHref)}">${esc(c.game)}</a> / ${countryLabel(c.gl)} / Position ${esc(c.pos)}${shownAs}</nav>
${p.notice ? `<section class="band notice" role="note">${esc(p.notice)}</section>` : ""}
<header class="lib-head"><h1>${esc(c.game)} · ${countryLabel(c.gl)} · position ${esc(c.pos)}</h1><span class="sub">${sub.join(" · ")}</span></header>
${picture}
${focusBand(p)}
<section class="band" id="wireframes"><h2>Wireframes</h2>${wf}</section>
${textsBand(p)}
${whereBand(p)}
<section class="band plain" id="footer"><p class="meta">${esc(p.footer)}</p></section>
${folds(p)}
</main>
<style>${LIB_CSS}${FLAG_CSS}</style>
<script type="application/json" id="page">${data}</script>`;
  return page(
    `${c.game} · ${c.country} · ${c.pos}`,
    body,
    token,
    `${ACTION_SCRIPT}${IMAGE_SCRIPT}`,
  );
}

/** Wireframes and the raw reading from the embedded data; the Shown-as switch; a lost picture. */
const IMAGE_SCRIPT = `
const PAGE = JSON.parse(document.getElementById("page").textContent);
const DATA = { info: {} };
const esc = actEsc;
const APP = { apiBase: "/p/" + encodeURIComponent(PAGE.project.id) + "/api" };
${INFO_SCRIPT}
const wfSlot = document.getElementById("wf");
if (wfSlot && PAGE.wireframe) wfSlot.appendChild(wireframeNode(PAGE.wireframe));
const rawSlot = document.getElementById("rawInfo");
if (rawSlot && PAGE.info) rawSlot.innerHTML = infoHtml(PAGE.info);
const big = document.getElementById("bigPic");
function picGone() {
  const box = document.getElementById("picLink");
  if (!box) return;
  const d = document.createElement("div");
  d.className = "gone";
  d.textContent = "The picture is no longer available in this project." + (document.getElementById("shownAs") ? " Pick another project under Shown as." : "");
  box.replaceWith(d);
}
if (big) { big.addEventListener("error", picGone); if (big.complete && big.naturalWidth === 0 && big.getAttribute("src")) picGone(); }
const shown = document.getElementById("shownAs");
if (shown) shown.addEventListener("change", () => {
  const href = shown.value;
  if (!href.startsWith("/image/")) return;
  // The next page loads in this tab: a busy line until it does (the select stays usable).
  act(null, { key: "shownAs", busy: "Opening the picture as that project sees it...", status: "shownMsg", run: () => new Promise(() => { location.href = href; }) });
});
`;

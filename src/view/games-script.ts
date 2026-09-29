/**
 * The games directory's script: loads the saved list, filters, sorts and searches in the page
 * (remembered per browser, convenience only), and runs "Update the list" with progress. Every
 * text goes in with textContent; links are built from checked app ids only.
 */
export const GAMES_SCRIPT = `
let GAMES = null;
const G_KEY = "games-library-view";
const APP_ID_RE = /^[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+$/;
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== "") el.append(k instanceof Node ? k : String(k));
  return el;
}
const gFold = (s) => String(s || "").normalize("NFKD").replace(/\\p{M}/gu, "").toLowerCase();
function gDay(d) { if (!d) return ""; const t = new Date(d); return isNaN(t) ? d : t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
function gName(gl) { return FLAG_NAMES[String(gl).toLowerCase()] || String(gl).toUpperCase(); }
function gFlag(gl) {
  const code = String(gl || "").toLowerCase();
  return /^[a-z]{2}$/.test(code) && FLAG_NAMES[code] ? h("img", { class: "flag", src: "/flags/" + code + ".svg", alt: "", width: 20, height: 15 }) : null;
}
function gLoadView() { try { return JSON.parse(localStorage.getItem(G_KEY) || "{}"); } catch { return {}; } }
function gSaveView() {
  const v = { q: gSearch.value, cat: gCat.value, country: gCountry.value, project: gProject.value, store: gStore.value, sort: gSort.value };
  try { localStorage.setItem(G_KEY, JSON.stringify(v)); } catch {}
}
const gSearch = document.getElementById("gSearch"), gCat = document.getElementById("gCat"), gCountry = document.getElementById("gCountry"), gProject = document.getElementById("gProject"), gStore = document.getElementById("gStore"), gSort = document.getElementById("gSort");

function gOptions(sel, items) {
  const keep = sel.value;
  sel.replaceChildren(h("option", { value: "" }, "All"), ...items.map(([v, t]) => h("option", { value: v }, t)));
  if (items.some(([v]) => v === keep)) sel.value = keep;
}

function gFill() {
  const cats = [...new Set(GAMES.map((g) => g.category).filter(Boolean))].sort();
  gOptions(gCat, cats.map((c) => [c, c]));
  const gls = [...new Set(GAMES.flatMap((g) => g.pages.filter((p) => p.images > 0).map((p) => p.gl)))].sort((a, b) => gName(a).localeCompare(gName(b)));
  gOptions(gCountry, gls.map((gl) => [gl, gName(gl)]));
  const projects = new Map();
  for (const g of GAMES) for (const u of g.uses) projects.set(u.projectId, u.project + (u.archived ? " (archived)" : ""));
  gOptions(gProject, [...projects].sort((a, b) => a[1].localeCompare(b[1])));
}

function gMatches(g) {
  const q = gFold(gSearch.value).trim();
  if (q && !q.split(/\\s+/).every((w) => g.search.includes(w))) return false;
  if (gCat.value && g.category !== gCat.value) return false;
  if (gCountry.value && !g.pages.some((p) => p.gl === gCountry.value && p.images > 0)) return false;
  if (gProject.value && !g.uses.some((u) => u.projectId === gProject.value)) return false;
  if (gStore.value) {
    const has = new Set(g.pages.map(gPlatform));
    if (gStore.value === "both" ? !(has.has("play") && has.has("appstore")) : !has.has(gStore.value)) return false;
  }
  return true;
}

// A page without a platform is Google Play (lists saved before the App Store field).
const gPlatform = (p) => (p.platform === "appstore" || p.platform === "apple" ? "appstore" : "play");
function gStores(g) {
  const out = [];
  for (const platform of ["play", "appstore"]) {
    const mine = g.pages.filter((p) => gPlatform(p) === platform);
    if (!mine.length) continue;
    const held = [...new Set(mine.filter((p) => p.status === "ok" && p.images > 0).map((p) => p.gl))];
    out.push({ platform, countries: held.map(gName) });
  }
  return out;
}
function gIcon(g) {
  const icon = h("span", { class: "icon app-icon" }, h("span", { "aria-hidden": "true" }, (g.name || "?").slice(0, 1).toUpperCase()));
  if (g.icon && /^\\/app-icons\\/[0-9a-f]{64}\\.webp$/.test(g.icon) && !iconFailed.has(g.icon)) icon.append(h("img", { alt: "", src: g.icon, "data-app-icon": "1" }));
  return icon;
}
// Missing icons arrive in the background, three at a time, the cards shown first; the letters
// stay until then (the list never waits for them).
function gIcons(shown) {
  const first = new Set(shown.map((g) => g.appId));
  const items = [...shown, ...GAMES.filter((g) => !first.has(g.appId))].map((g) => ({ id: g.appId, appIcon: g.icon, iconStale: g.iconStale }));
  return fetchAppIcons(items, (p) => {
    const g = GAMES.find((x) => x.appId === p.id);
    if (!g) return;
    g.icon = p.appIcon; g.iconStale = false;
    const card = document.getElementById("gc-" + p.id);
    const old = card && card.querySelector(".app-icon");
    if (old) old.replaceWith(gIcon(g));
  }, { ask: (p) => send("/api/games/icon", { appId: p.id }), limit: 3 });
}

function gCard(g) {
  const href = APP_ID_RE.test(g.appId) ? "/games/" + encodeURIComponent(g.appId) : "#";
  const icon = gIcon(g);
  const marks = h("span", { class: "store-marks" }, gStores(g).map((s) => storeMark(s.platform, s.countries)));
  const meta = [g.category, g.images + " images", g.countries + " countries", g.analysed + " analysed"].filter(Boolean).join(" · ");
  const chips = h("div", { class: "chips" }, g.pages.map((p) => {
    const dim = p.status !== "ok" || !p.images;
    const tip = gName(p.gl) + ": " + (p.status === "unavailable" ? "not sold here" : p.images + " images") + (p.checked ? ", store checked " + gDay(p.checked) : "");
    return h("span", { class: "chip" + (dim ? " dim" : ""), title: tip, "aria-label": tip }, gFlag(p.gl) || p.gl.toUpperCase());
  }));
  const more = h("details", {}, h("summary", {}, "more (ASO words, keywords, store check)"),
    h("p", {}, "ASO words: " + (g.aso || "none in the store title") + (g.asoDiffers ? " (different in " + g.asoDiffers + " countries)" : "")),
    g.keywords.length ? [h("p", { class: "meta" }, "Keywords derived from the store text (Google Play has no official keywords):"), ...g.keywords.map((k) => h("p", {}, gName(k.gl) + ": " + k.terms.join(", ")))] : h("p", { class: "meta" }, "No store text saved yet."),
    h("p", { class: "meta" }, "Last store check: " + (gDay(g.latestCheck) || "unknown")));
  return h("article", { class: "gcard", id: APP_ID_RE.test(g.appId) ? "gc-" + g.appId : null },
    h("a", { class: "ghead", href }, icon, h("div", {}, h("div", { class: "gtitle" }, h("h2", {}, g.name), marks), h("div", { class: "gmeta" }, meta))),
    chips, more);
}

function gRender() {
  const box = document.getElementById("gCards");
  if (!GAMES) return;
  if (!GAMES.length) { box.replaceChildren(h("p", { class: "gempty" }, "No games yet. Create a project to start.")); document.getElementById("gCount").textContent = ""; return; }
  const list = GAMES.filter(gMatches);
  const s = gSort.value;
  list.sort((a, b) => s === "name" ? a.name.localeCompare(b.name) : s === "checked" ? String(b.latestCheck).localeCompare(String(a.latestCheck)) || a.name.localeCompare(b.name) : b.images - a.images || a.name.localeCompare(b.name));
  document.getElementById("gCount").textContent = "Showing " + list.length + (list.length === 1 ? " game" : " games") + (list.length < GAMES.length ? " of " + GAMES.length : "");
  if (!list.length) {
    const b = h("button", { type: "button", class: "btn", id: "gClear" }, "Clear the filters");
    box.replaceChildren(h("div", { class: "gempty" }, h("p", {}, "No games match."), b));
    return;
  }
  box.replaceChildren(...list.map(gCard));
  gShown = list;
}
let gShown = [];

function gAgo(iso) {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return "Updated " + (m < 1 ? "just now" : m < 60 ? m + (m === 1 ? " minute" : " minutes") + " ago" : gDay(iso));
}

let gTimer = null;
async function gLoad() {
  clearTimeout(gTimer);
  let r;
  try { r = await getJson("/api/games"); }
  catch (e) { if (!GAMES) document.getElementById("gCards").replaceChildren(h("p", { class: "act-msg bad", role: "alert" }, actReason(e))); return; }
  const p = r.progress;
  if (r.games) { const first = !GAMES; GAMES = r.games; gFill(); if (first) gApplyView(); gRender(); void gIcons(gShown); }
  document.getElementById("gUpdated").textContent = gAgo(r.builtAt);
  const line = document.getElementById("gStatus");
  if (p && p.running) {
    actLine(line, "busy", "Updating the list: " + p.message, p.done, p.total);
    gTimer = setTimeout(gLoad, 800);
  } else if (!r.games) {
    actLine(line, "busy", "Loading the games...");
    gTimer = setTimeout(gLoad, 800);
  } else if (p && p.error) actLine(line, "bad", p.error);
  else if (line.classList.contains("busy")) line.hidden = true;
  return r;
}

function gApplyView() {
  const v = gLoadView();
  gSearch.value = v.q || "";
  for (const [el, val] of [[gCat, v.cat], [gCountry, v.country], [gProject, v.project], [gStore, v.store], [gSort, v.sort]]) if (val && [...el.options].some((o) => o.value === val)) el.value = val;
}

document.addEventListener("input", (e) => { if (e.target === gSearch) { gRender(); gSaveView(); } });
document.addEventListener("change", (e) => { if ([gCat, gCountry, gProject, gStore, gSort].includes(e.target)) { gRender(); gSaveView(); } });
document.addEventListener("click", (e) => {
  if (e.target.id === "gClear") { gSearch.value = ""; gCat.value = ""; gCountry.value = ""; gProject.value = ""; gStore.value = ""; gSaveView(); gRender(); }
  if (e.target.id === "gRebuild") act(e.target, {
    busy: "Updating the list...",
    status: "gStatus",
    run: async (progress) => {
      await send("/api/games/rebuild", {});
      for (;;) {
        await new Promise((r) => setTimeout(r, 600));
        const r = await getJson("/api/games");
        const p = r.progress || {};
        if (p.running) { progress("Updating the list: " + p.message, p.done, p.total); continue; }
        if (p.error) throw new Error(p.error);
        GAMES = r.games || [];
        gFill(); gRender(); void gIcons(gShown);
        document.getElementById("gUpdated").textContent = gAgo(r.builtAt);
        return p;
      }
    },
    done: (p) => p.message || "List updated.",
  });
});
gLoad();
`;

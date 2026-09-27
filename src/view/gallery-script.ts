import { ANALYSIS_SCRIPT } from "./gallery-analysis.ts";
import { GRID_SCRIPT } from "./gallery-grid.ts";
import { PICKER_SCRIPT } from "./gallery-picker.ts";

/** Client-side script for the raw deck gallery. Plain JS, no external libraries. */
const RENDER_SCRIPT = `
const DATA = JSON.parse(document.getElementById("data").textContent);
const IMG = "../images/";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let selection = DATA.selection.slice();
const TOKEN = (document.querySelector('meta[name="ssr-token"]') || {}).content || "";
async function apiPost(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-SSR-Token": TOKEN }, body: JSON.stringify(body) });
  return { ok: res.ok, body: await res.json() };
}
let locale = "all";

function caption(i) {
  if (!i.analysis) return "";
  return '<span class="cap">' + esc(i.analysis.screen) + (i.analysis.headline ? ": " + esc(i.analysis.headline) : "") + "</span>";
}

function thumbs(deck) {
  if (deck.status !== "ok") return '<div class="na">' + (deck.status === "unavailable" ? "Not available in this country" : "Could not be read") + "</div>";
  return deck.images.map((i) => i.thumb
    ? '<figure><a href="' + IMG + esc(i.full) + '" target="_blank" rel="noopener" title="Position ' + i.position + ", " + i.width + "x" + i.height + ", " + esc(i.device) + '"><img loading="lazy" src="' + IMG + esc(i.thumb) + '" alt="Position ' + i.position + '">' + (i.sameAsBaseline ? '<span class="badge">same as English</span>' : "") + (i.device === "tablet" ? '<span class="badge tab">tablet-shaped</span>' : "") + "</a>" + caption(i) + "</figure>"
    : '<div class="na">Position ' + i.position + ": download failed</div>").join("");
}

function appCard(a, selectable) {
  const ranks = Object.entries(a.chartRanks).map(([gl, r]) => gl.toUpperCase() + " #" + r).join(", ");
  const decks = a.decks.filter((d) => locale === "all" || d.gl === locale);
  const pick = selectable ? '<label class="pick"><input type="checkbox" data-id="' + esc(a.appId) + '"' + (selection.includes(a.appId) ? " checked" : "") + "> Core competitor</label>" : "";
  const counts = a.analysedLength === a.baselineLength ? String(a.baselineLength || "n/a") : a.analysedLength + " phone of " + a.baselineLength;
  return '<section class="app"><header><h3>' + esc(a.name) + '</h3><span class="meta">' + esc(a.appId) + " &middot; " + esc(a.tier.replace("_", " ")) + (ranks ? " &middot; chart: " + ranks : "") + " &middot; English deck: " + counts + "</span>" + pick + "</header>"
    + decks.map((d) => '<div class="deck"><div class="loc">' + esc(d.label) + (d.status === "ok" ? " (" + d.length + ")" : "") + '</div><div class="row">' + thumbs(d) + "</div></div>").join("")
    + "</section>";
}

function render() {
  document.getElementById("ours").innerHTML = DATA.ours.map((a) => appCard(a, false)).join("");
  document.getElementById("named").innerHTML = DATA.named.map((a) => appCard(a, true)).join("");
  document.getElementById("chart").innerHTML = DATA.chart.map((a) => appCard(a, false)).join("") || "<p>No chart games.</p>";
  renderPanel();
  renderGrid();
}

document.addEventListener("change", (e) => {
  const id = e.target.dataset && e.target.dataset.id;
  if (id) setSelection(e.target.checked ? selection.concat([id]) : selection.filter((x) => x !== id));
  if (e.target.id === "locale") { locale = e.target.value; render(); }
});
document.getElementById("locale").innerHTML = '<option value="all">All countries</option>' + DATA.markets.map((m) => '<option value="' + esc(m.gl) + '">' + esc(m.label) + "</option>").join("");
`;

export const GALLERY_SCRIPT = `${RENDER_SCRIPT}\n${PICKER_SCRIPT}\n${GRID_SCRIPT}\n${ANALYSIS_SCRIPT}\nrender();\nloadSaved();\n`;

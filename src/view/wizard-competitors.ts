/**
 * Wizard step 2, competitors: add by link, package ID or name search (top matches with icon,
 * developer and rating at once; downloads and category filled in one by one, politely), pick
 * how close each one is, remove, and reorder by drag or Alt+Up / Alt+Down. Saved at once.
 */
export const WIZARD_COMPETITORS = `
let hits = null;
let hitCard = null;
let hitGen = 0;
const hitInfo = {};

function compList() { return (W.s.competitors || []).map((c) => ({ id: c.id, tier: c.tier })); }
function inList(id) { return W.s.ourApp.id === id ? "Your game" : W.s.competitors.some((c) => c.id === id) ? "Added" : ""; }

function addButton(id, name) {
  const why = inList(id);
  return why ? '<button type="button" class="btn" disabled>' + esc(why) + "</button>"
    : '<button type="button" class="btn primary" data-add="' + esc(id) + '" data-name="' + esc(name) + '" data-act-key="add:' + esc(id) + '">Add</button>';
}

function drawHits() {
  const box = $("hits");
  if (!box) return;
  if (hitCard) {
    const a = hitCard;
    box.innerHTML = '<div class="appcard">' + icon(googleIcon(a.icon), a.title) + '<div class="who"><strong>' + esc(a.title) + '</strong><div class="meta">' + [a.developer, category(a.genreId), a.installs ? a.installs + " downloads" : "", stars(a.score)].filter(Boolean).map(esc).join(" &middot; ") + "</div></div>" + addButton(a.appId, a.title) + "</div>";
    return;
  }
  if (!hits) { box.innerHTML = ""; return; }
  box.innerHTML = '<p class="meta">Top matches on Google Play. Pick the right one: nothing is added on its own.</p><ul class="hits">' + hits.map((h) => {
    const info = hitInfo[h.appId];
    const more = info ? (info.error ? "" : [category(info.genreId), info.installs ? info.installs + " downloads" : ""].filter(Boolean).map(esc).join(" &middot; ")) : "downloads: checking...";
    return "<li>" + icon(googleIcon(h.icon), h.title, true) + '<div class="who"><strong>' + esc(h.title) + '</strong><div class="meta">' + esc(h.developer) + " &middot; " + esc(stars(h.score)) + (more ? " &middot; " + more : "") + "</div></div>" + addButton(h.appId, h.title) + "</li>";
  }).join("") + "</ul>";
}

// Downloads and category for each match, one by one at background pace; a new search stops it.
async function fillHits(gen) {
  for (const h of hits || []) {
    if (gen !== hitGen) return;
    if (hitInfo[h.appId]) continue;
    try { hitInfo[h.appId] = (await getJson("/api/play/lookup?soft=1&q=" + encodeURIComponent(h.appId))).app; }
    catch { hitInfo[h.appId] = { error: true }; }
    if (gen === hitGen) drawHits();
  }
}

function drawComps() {
  if (!$("compsBox")) return;
  const n = W.s.competitors.length;
  const rows = W.s.competitors.map((c, i) => '<li tabindex="0" data-index="' + i + '" aria-label="' + esc(c.name) + ", position " + (i + 1) + '"><span class="grip" aria-hidden="true">&#8942;&#8942;</span>' + icon(savedIcon(c.iconFile), c.name, true)
    + '<div class="who"><strong>' + esc(c.name) + '</strong><div class="meta">' + esc(c.developer || c.id) + "</div></div>"
    + '<label class="sr" for="tier-' + i + '">How close is ' + esc(c.name) + '?</label><select id="tier-' + i + '" data-tier="' + i + '">' + TIERS.map(([v, l]) => '<option value="' + v + '"' + (v === c.tier ? " selected" : "") + ">" + esc(l) + "</option>").join("") + "</select>"
    + '<button type="button" class="btn" data-remove="' + esc(c.id) + '" data-act-key="remove:' + esc(c.id) + '">Remove</button></li>').join("");
  $("compsBox").innerHTML = n
    ? '<p class="meta">Order is priority: drag a game, or focus it and press Alt+Up / Alt+Down. The competitor pick after the download decides the real core check.</p><ol id="comps">' + rows + "</ol>"
    : '<div class="empty">No competitors yet. Search for a game above, or paste its Google Play link.</div>';
  $("compCount").innerHTML = n >= 5 ? '<span class="ok">' + n + " competitors. Enough for the core check.</span>"
    : '<span class="warn">You have ' + n + " competitor" + (n === 1 ? "" : "s") + ". The core check needs at least 5 whose whole English decks fit.</span>";
}

DRAW[2] = () => {
  $("step").innerHTML = '<h2>Competitors</h2><p class="lead"><label for="compq">Add a competitor: type its name, or paste its Google Play link or package ID</label></p>'
    + '<div class="row"><input type="text" id="compq" placeholder="Survivor.io, or a Google Play link" autocomplete="off"><button type="button" class="btn primary" id="compSearch">Search</button></div>'
    + '<div id="searchLine" class="act-msg" hidden></div><div id="hits"></div>'
    + '<h2>Your competitors</h2><p id="compCount"></p><div id="compsBox"></div>' + nav(1, 3);
  drawHits();
  drawComps();
};

function search(btn) {
  const q = $("compq").value.trim();
  hitGen++;
  return act(btn, {
    key: "compSearch",
    busy: "Searching Google Play...",
    status: "searchLine",
    run: async () => {
      hits = null; hitCard = null; drawHits();
      const r = await getJson("/api/play/search?q=" + encodeURIComponent(q));
      if (r.app) { hitCard = r.app; drawHits(); return "Found " + r.app.title + "."; }
      hits = r.hits; drawHits(); fillHits(hitGen);
      return hits.length + " matches for " + q + ".";
    },
    done: (m) => m,
  });
}

function saveComps(btn, busy, list, done) {
  return act(btn, { busy, status: "saveLine", run: () => save(() => ({ competitors: list() })), done }).then((r) => { if (r) { drawHits(); drawComps(); } return r; });
}

function move(i, j) {
  const list = compList();
  if (j < 0 || j >= list.length) return;
  const [x] = list.splice(i, 1);
  list.splice(j, 0, x);
  autosave({ competitors: list }, () => { drawComps(); const li = document.querySelector('#comps li[data-index="' + j + '"]'); if (li) li.focus(); });
}

document.addEventListener("click", (e) => {
  const t = e.target.closest ? e.target.closest("button") : null;
  if (!t) return;
  if (t.id === "compSearch") search(t);
  if (t.dataset.add) {
    const id = t.dataset.add;
    saveComps(t, "Adding " + t.dataset.name + "...", () => compList().filter((c) => c.id !== id).concat([{ id, tier: "same_audience" }]), t.dataset.name + " added and saved.");
  }
  if (t.dataset.remove) {
    const id = t.dataset.remove;
    const name = (W.s.competitors.find((c) => c.id === id) || { name: id }).name;
    saveComps(t, "Removing...", () => compList().filter((c) => c.id !== id), name + " removed.");
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "compq") { e.preventDefault(); search($("compSearch")); return; }
  const li = e.target.closest && e.target.closest("#comps li");
  if (!li || !e.altKey || e.target !== li) return;
  const i = Number(li.dataset.index);
  if (e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1); }
  if (e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1); }
});
document.addEventListener("change", (e) => {
  if (e.target.dataset.tier === undefined) return;
  const i = Number(e.target.dataset.tier);
  const tier = e.target.value;
  const id = (W.s.competitors[i] || {}).id;
  autosave(() => ({ competitors: compList().map((c) => (c.id === id ? { ...c, tier } : c)) }));
});

// Pointer drag (mouse, pen, touch): the item moves while dragging; the order is saved on release.
let drag = null;
document.addEventListener("pointerdown", (e) => {
  const li = e.target.closest && e.target.closest("#comps li");
  if (!li || e.target.closest("button, select, label")) return;
  drag = { li, id: e.pointerId };
  li.classList.add("dragging");
  li.setPointerCapture(e.pointerId);
  e.preventDefault();
});
document.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const list = drag.li.parentElement;
  const after = [...list.children].find((c) => c !== drag.li && e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2);
  list.insertBefore(drag.li, after || null);
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const old = compList();
  const order = [...drag.li.parentElement.children].map((c) => old[Number(c.dataset.index)]);
  drag.li.classList.remove("dragging");
  drag = null;
  if (order.map((c) => c.id).join() !== old.map((c) => c.id).join()) autosave({ competitors: order }, drawComps);
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
`;

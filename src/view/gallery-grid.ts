/**
 * Comparison grid: one row per game (ours first, then the pick in priority order), one column
 * per store position, so position N lines up across games. Every thumbnail sits in a fixed-size
 * box, so one game's wide (landscape) images cannot stretch a column for all games. Images in the
 * next batch (the stage picked under Analysis) get an accent border and a "will analyse" badge;
 * the others are greyed out with the reason on hover. Each row says how many are in the batch.
 * Re-rendered on every pick or batch change.
 */
export const GRID_SCRIPT = `
function coreDeckOf(a) {
  return a && a.decks.find((d) => d.gl === DATA.coreMarket.gl && d.hl === DATA.coreMarket.hl && d.status === "ok");
}

function gridStage() { const s = document.getElementById("stage"); return s && s.value === "core" ? "core" : "pilot"; }

// Same rule as the tool's plan (src/analysis/plan.ts): pilot = ours + first picked decks that
// fit; core = every deck that fits; only the analysed device classes; only downloaded images.
function batchRows() {
  const f = fit();
  const kept = new Set(f.kept);
  const inBatch = new Set(gridStage() === "pilot" ? f.kept.slice(0, DATA.pilotCompetitors) : f.kept);
  const rows = [];
  if (DATA.ours[0]) rows.push({ app: DATA.ours[0], inCore: true, inBatch: true });
  for (const id of selection) { const a = named.get(id); if (a) rows.push({ app: a, inCore: kept.has(id), inBatch: inBatch.has(id) }); }
  return rows;
}

function whyNot(r, i) {
  if (!r.inCore) return "not in the core check (does not fit, or not picked)";
  if (!r.inBatch) return "not in the core pilot (only the first " + DATA.pilotCompetitors + " competitors); included in the full core check";
  if (!DATA.deviceClasses.includes(i.device)) return i.device + "-shaped screenshot (only " + DATA.deviceClasses.join(", ") + " analysed)";
  if (!i.thumb) return "image missing";
  return "";
}

function rowCount(r, d, stageName) {
  if (!d) return '<span class="count out">No ' + esc(DATA.coreMarket.label) + " deck</span>";
  const all = d.images.length;
  if (!r.inBatch) return '<span class="count out">' + stageName + ": 0 of " + all + " (" + (r.inCore ? "not in this batch" : "not in the core check") + ")</span>";
  const take = d.images.filter((i) => !whyNot(r, i));
  const fresh = take.filter((i) => !i.analysis).length;
  const devOut = d.images.filter((i) => !DATA.deviceClasses.includes(i.device));
  const notes = [];
  if (devOut.length) notes.push(devOut.length + " tablet-shaped excluded");
  if (all - take.length - devOut.length > 0) notes.push(all - take.length - devOut.length + " missing");
  if (take.length - fresh > 0) notes.push(take.length - fresh + " already analysed, no AI");
  return '<span class="count">' + stageName + ": " + fresh + " of " + all + " will be analysed" + (notes.length ? " (" + notes.join(", ") + ")" : "") + "</span>";
}

function renderGrid() {
  const rows = batchRows();
  const stageName = gridStage() === "pilot" ? "Pilot" : "Core check";
  const cols = Math.max(1, ...rows.map((r) => { const d = coreDeckOf(r.app); return d ? d.images.length : 0; }));
  let html = '<table class="grid"><thead><tr><th class="rowh">Game</th>';
  for (let p = 1; p <= cols; p++) html += "<th>" + p + "</th>";
  html += "</tr></thead><tbody>";
  for (const r of rows) {
    const d = coreDeckOf(r.app);
    html += '<tr class="' + (r.inBatch ? "inbatch" : r.inCore ? "" : "outrow") + '"><th class="rowh">' + esc(r.app.name) + (typeof storeBtn === "function" ? storeBtn(r.app.appId) : "") + rowCount(r, d, stageName) + "</th>";
    for (let p = 1; p <= cols; p++) {
      const i = d && d.images.find((x) => x.position === p);
      if (!i || !i.thumb) { html += i ? '<td class="out"><span class="na" title="Not analysed: image missing">Position ' + p + ": download failed</span></td>" : "<td></td>"; continue; }
      const why = whyNot(r, i);
      const live = !why && !i.analysis && typeof runMark === "function" ? runMark(i.imageId) : "";
      const cls = why ? "out" : i.analysis ? "done" : live === "failed" ? "failed" : "next";
      const badge = why ? '<span class="gbadge out">not analysed</span>' : i.analysis ? '<span class="gbadge done">analysed</span>' : live === "failed" ? '<span class="gbadge failed">failed</span>' : live === "current" ? '<span class="gbadge next">' + spinHtml("spin") + 'analysing</span>' : '<span class="gbadge next">will analyse</span>';
      const tip = r.app.name + ", position " + p + ", " + i.width + "x" + i.height + (why ? ". Not analysed: " + why : i.analysis ? ". Already analysed (no AI)" : ". Will be analysed in this batch");
      html += '<td class="' + cls + '"><a class="thumb" href="' + IMG + esc(i.full) + '" target="_blank" rel="noopener" title="' + esc(tip) + '"><img loading="lazy" width="100" height="160" src="' + IMG + esc(i.thumb) + '" alt="' + esc(r.app.name) + " position " + p + '">' + badge + "</a>" + infoBtn(i.imageId, { app: r.app.appId, gl: d.gl, hl: d.hl, pos: i.position }) + caption(i) + "</td>";
    }
    html += "</tr>";
  }
  document.getElementById("grid").innerHTML = html + "</tbody></table>";
  updateGridHint(cols);
}

function updateGridHint(cols) {
  const g = document.getElementById("grid"); const h = document.getElementById("gridHint");
  if (!g || !h) return;
  h.hidden = g.scrollWidth <= g.clientWidth + 2;
  h.textContent = "Wider than the window: scroll the grid sideways (scrollbar at its bottom, or Shift + mouse wheel) to see all " + cols + " positions.";
}

document.addEventListener("change", (e) => { if (e.target.id === "stage") renderGrid(); });
window.addEventListener("resize", () => updateGridHint(document.querySelectorAll("#grid thead th").length - 1));
`;

/**
 * Comparison grid: one row per game (ours first, then the pick in priority order), one column
 * per store position, so position N lines up across games. Screenshots left out of the core
 * (by the fit rule or the device rule) are greyed out. Re-rendered on every pick change.
 */
export const GRID_SCRIPT = `
function coreDeckOf(a) {
  return a && a.decks.find((d) => d.gl === DATA.coreMarket.gl && d.hl === DATA.coreMarket.hl && d.status === "ok");
}

function renderGrid() {
  const f = fit();
  const kept = new Set(f.kept);
  const pilot = new Set(f.kept.slice(0, DATA.pilotCompetitors));
  const rows = [];
  if (DATA.ours[0]) rows.push({ app: DATA.ours[0], inCore: true, pilot: true });
  for (const id of selection) { const a = named.get(id); if (a) rows.push({ app: a, inCore: kept.has(id), pilot: pilot.has(id) }); }
  const cols = Math.max(1, ...rows.map((r) => { const d = coreDeckOf(r.app); return d ? d.images.length : 0; }));
  let html = '<table class="grid"><thead><tr><th class="rowh">Game</th>';
  for (let p = 1; p <= cols; p++) html += "<th>" + p + "</th>";
  html += "</tr></thead><tbody>";
  for (const r of rows) {
    const d = coreDeckOf(r.app);
    const tag = r.pilot ? '<span class="tag">in the pilot</span>' : r.inCore ? "" : '<span class="tag out">not in the core check</span>';
    html += '<tr class="' + (r.inCore ? "" : "outrow") + '"><th class="rowh">' + esc(r.app.name) + '<span class="meta"> ' + (d ? d.images.length : 0) + " screenshots, " + r.app.analysedLength + " analysed</span>" + tag + "</th>";
    for (let p = 1; p <= cols; p++) {
      const i = d && d.images.find((x) => x.position === p);
      if (!i || !i.thumb) { html += "<td></td>"; continue; }
      const excluded = !r.inCore || !DATA.deviceClasses.includes(i.device);
      html += '<td class="' + (excluded ? "out" : "") + '"><a href="' + IMG + esc(i.full) + '" target="_blank" rel="noopener" title="' + esc(r.app.name) + ", position " + p + ", " + i.width + "x" + i.height + (excluded ? ", not analysed" : "") + '"><img loading="lazy" src="' + IMG + esc(i.thumb) + '" alt="' + esc(r.app.name) + " position " + p + '">' + (i.device === "tablet" ? '<span class="badge tab">tablet-shaped</span>' : "") + "</a>" + caption(i) + "</td>";
    }
    html += "</tr>";
  }
  document.getElementById("grid").innerHTML = html + "</tbody></table>";
}
`;

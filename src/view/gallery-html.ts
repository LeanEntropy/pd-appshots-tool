import { GALLERY_SCRIPT } from "./gallery-script.ts";
import type { ViewModel } from "./model.ts";

const CSS = `
:root { --bg: #f7f7f5; --card: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --line: #e2e2e0; --accent: #2f6fdb; --warn: #b3261e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #151517; --card: #1f1f22; --text: #ececef; --muted: #9a9aa2; --line: #333338; --accent: #7aa7ff; --warn: #ff8a80; } }
:root[data-theme="dark"] { --bg: #151517; --card: #1f1f22; --text: #ececef; --muted: #9a9aa2; --line: #333338; --accent: #7aa7ff; --warn: #ff8a80; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, sans-serif; }
.wrap { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; padding: 16px; max-width: 1600px; margin: 0 auto; }
@media (max-width: 900px) { .wrap { grid-template-columns: minmax(0, 1fr); } }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 24px 0 8px; } h3 { font-size: 15px; margin: 0; }
.meta { color: var(--muted); font-size: 12px; }
.app { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 12px; }
.app header { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 8px; }
.pick { margin-left: auto; font-weight: 600; color: var(--accent); }
.deck { margin: 6px 0; } .loc { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.row a { position: relative; flex: none; }
.row img { height: 180px; width: auto; border-radius: 4px; border: 1px solid var(--line); display: block; }
.badge { position: absolute; left: 4px; bottom: 4px; background: rgba(0,0,0,.7); color: #fff; font-size: 10px; padding: 1px 4px; border-radius: 3px; }
.na { color: var(--warn); font-size: 12px; padding: 8px 0; }
aside { position: sticky; top: 16px; align-self: start; max-height: calc(100vh - 32px); overflow-y: auto; }
#panel { top: 16px; align-self: start; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
#panel h2 { margin-top: 0; } #panel li { margin: 4px 0; } #panel li.skip { color: var(--warn); }
button { font: inherit; margin-left: 4px; padding: 2px 8px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--text); cursor: pointer; }
#order { padding-left: 0; list-style: none; counter-reset: pick; }
#order li { counter-increment: pick; display: flex; align-items: center; gap: 6px; padding: 6px; margin: 4px 0; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); cursor: grab; touch-action: none; user-select: none; }
#order li::before { content: counter(pick) "."; color: var(--muted); min-width: 1.5em; }
#order li:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
#order li.dragging { opacity: .6; cursor: grabbing; }
#order .nm { flex: 1; } .grip { color: var(--muted); }
figure { margin: 0; flex: none; width: min-content; }
.cap { display: block; font-size: 11px; color: var(--muted); max-width: 140px; }
.badge.tab { bottom: auto; top: 4px; }
.gridwrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; background: var(--card); }
table.grid { border-collapse: collapse; }
table.grid th, table.grid td { padding: 6px; vertical-align: top; border-bottom: 1px solid var(--line); }
table.grid thead th { background: var(--card); font-size: 12px; color: var(--muted); }
table.grid .rowh { position: sticky; left: 0; background: var(--card); text-align: left; min-width: 150px; max-width: 170px; font-size: 13px; z-index: 1; }
table.grid .rowh .meta { display: block; font-weight: normal; }
table.grid td a { position: relative; display: block; }
table.grid img { height: 160px; width: auto; display: block; border-radius: 4px; border: 1px solid var(--line); }
table.grid td.out img { opacity: .35; filter: grayscale(1); }
tr.outrow .rowh { color: var(--muted); }
.tag { display: inline-block; margin-top: 4px; font-size: 11px; padding: 1px 6px; border-radius: 3px; background: var(--accent); color: #fff; }
.tag.out { background: var(--muted); }
#analysisBox { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 8px; }
table.passes { font-size: 12px; border-collapse: collapse; } table.passes td, table.passes th { padding: 2px 4px; text-align: left; }
.primary { background: var(--accent); color: #fff; border: none; padding: 6px 12px; }
.warn { color: var(--warn); }
select { font: inherit; padding: 4px; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 4px; }
`;

/** Deterministic HTML: the same view model always produces the same page. */
const escHtml = (s: string | number) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Deterministic HTML: the same view model always produces the same page. The token (only when
 * served by the local gallery server) authorises the page's saves and analysis requests.
 */
export function galleryHtml(vm: ViewModel, token = ""): string {
  const data = JSON.stringify(vm).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="ssr-token" content="${escHtml(token)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Raw Store Decks</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<main>
<h1>Raw store decks: ${escHtml(vm.project)}</h1>
<p class="meta">Downloaded run ${escHtml(vm.runId)}. Images as they appear on Google Play, in store order. Analysed screenshots show their screen type and headline under the picture; the rest are raw. Tick the named competitors for the core check and drag them into order on the right. Tablet-shaped screenshots are shown but not analysed.</p>
<p><label>Show country: <select id="locale"></select></label></p>
<h2>Comparison grid: ${escHtml(vm.coreMarket.label)}</h2>
<p class="meta">Our game first, then your pick in priority order. Each column is a store position. Greyed-out screenshots are not analysed (outside the core, or tablet-shaped).</p>
<div class="gridwrap" id="grid"></div>
<h2>All downloaded decks</h2>
<h3>Our game</h3><div id="ours"></div>
<h3>Named competitors</h3><div id="named"></div>
<h3>Chart games (shown raw; analysed only if you pick them later)</h3><div id="chart"></div>
</main>
<aside><div id="panel"></div>
<div id="analysisBox"><h2>Analysis</h2>
<p><label>Batch: <select id="stage"><option value="pilot">Core pilot (ours + first ${escHtml(vm.pilotCompetitors)} competitors)</option><option value="core">Full core check</option></select></label></p>
<button id="startAnalysis">Start analysis</button>
<p class="meta">Shows the image count, model passes and estimated cost first. Nothing is sent to an AI model until you press Approve and run.</p>
<div id="approval" role="status"></div></div></aside>
</div>
<script type="application/json" id="data">${data}</script>
<script>${GALLERY_SCRIPT}</script>
</body>
</html>
`;
}

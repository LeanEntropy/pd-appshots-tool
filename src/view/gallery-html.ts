import { GALLERY_SCRIPT } from "./gallery-script.ts";
import type { ViewModel } from "./model.ts";

const CSS = `
:root { --bg: #f7f7f5; --card: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --line: #e2e2e0; --accent: #2f6fdb; --warn: #b3261e; --next: #c2410c; --tint: #eef3fd; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #151517; --card: #1f1f22; --text: #ececef; --muted: #9a9aa2; --line: #333338; --accent: #7aa7ff; --warn: #ff8a80; --next: #fb923c; --tint: #1c2438; } }
:root[data-theme="dark"] { --bg: #151517; --card: #1f1f22; --text: #ececef; --muted: #9a9aa2; --line: #333338; --accent: #7aa7ff; --warn: #ff8a80; --next: #fb923c; --tint: #1c2438; }
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
.gridwrap { overflow: auto; max-height: 78vh; border: 1px solid var(--line); border-radius: 8px; scrollbar-color: var(--muted) var(--line);
  background: linear-gradient(to left, var(--card) 40%, transparent) right / 48px 100% no-repeat local, linear-gradient(to left, rgba(0,0,0,.28), transparent) right / 18px 100% no-repeat scroll, var(--card); }
#gridHint { font-weight: 600; color: var(--accent); margin: 4px 0; }
table.grid { border-collapse: separate; border-spacing: 0; }
table.grid th, table.grid td { padding: 6px; vertical-align: top; border-bottom: 1px solid var(--line); }
table.grid thead th { position: sticky; top: 0; z-index: 2; background: var(--card); font-size: 12px; color: var(--muted); }
table.grid .rowh { position: sticky; left: 0; background: var(--card); text-align: left; min-width: 170px; max-width: 190px; font-size: 13px; z-index: 1; }
table.grid thead .rowh { z-index: 3; }
table.grid tr.inbatch .rowh { box-shadow: inset 4px 0 0 var(--accent); padding-left: 10px; }
table.grid .count { display: block; margin-top: 4px; font-size: 12px; font-weight: 600; color: var(--accent); }
table.grid .count.out { color: var(--muted); font-weight: normal; }
table.grid td { min-width: 112px; }
table.grid a.thumb { position: relative; display: block; width: 100px; height: 160px; border-radius: 6px; background: var(--bg); border: 1px solid var(--line); }
table.grid a.thumb img { width: 100%; height: 100%; object-fit: contain; display: block; border-radius: 5px; }
table.grid td.next a.thumb { border: 3px solid var(--next); }
table.grid td.done a.thumb { border: 2px solid var(--accent); }
table.grid td.out img { opacity: .35; filter: grayscale(1); }
table.grid td.out a.thumb { border-style: dashed; }
table.grid .cap { max-width: 100px; }
.gbadge { position: absolute; left: 3px; bottom: 3px; font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 3px; color: #fff; background: var(--muted); }
.gbadge.next { background: #c2410c; } .gbadge.done { background: var(--accent); }
tr.outrow .rowh { color: var(--muted); }
#analysisBox { margin-top: 16px; border-top: 1px solid var(--line); padding-top: 8px; }
table.passes { font-size: 12px; border-collapse: collapse; } table.passes td, table.passes th { padding: 2px 4px; text-align: left; }
.primary { background: var(--accent); color: #fff; border: none; padding: 6px 12px; }
.warn { color: var(--warn); }
figure, table.grid td { position: relative; }
button.info { position: absolute; top: 4px; right: 4px; margin: 0; width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 1px solid #fff; background: var(--accent); color: #fff; font: italic 700 13px/20px Georgia, serif; text-align: center; z-index: 2; }
button.info.pending { background: var(--muted); font: 700 13px/18px system-ui, sans-serif; }
details.tech summary { cursor: pointer; color: var(--muted); font-size: 12px; }
button.info:focus-visible { outline: 3px solid var(--text); outline-offset: 1px; }
#infoPop { position: fixed; z-index: 50; max-width: calc(100vw - 16px); box-sizing: border-box; overflow-y: auto; background: var(--card); color: var(--text); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; box-shadow: 0 6px 24px rgba(0,0,0,.25); font-size: 13px; }
#infoPop h4 { margin: 0 0 2px; font-size: 14px; } #infoPop h5 { margin: 8px 0 2px; font-size: 13px; }
#infoPop dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 8px; margin: 0; } #infoPop dt { color: var(--muted); } #infoPop dd { margin: 0; }
#infoPop ul, #infoPop ol { margin: 4px 0; padding-left: 18px; }
.sw { display: inline-block; width: 11px; height: 11px; border: 1px solid var(--line); border-radius: 2px; margin: 0 3px -1px 0; }
#status { background: var(--card); border: 2px solid var(--accent); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; }
#status h2 { margin: 0 0 4px; font-size: 15px; } #status p { margin: 4px 0; }
#status .now { font-weight: 600; } .ok { color: var(--accent); }
#status.running { background: var(--tint); border-width: 3px; box-shadow: 0 0 0 4px var(--tint); }
#status:focus { outline: 3px solid var(--text); outline-offset: 2px; }
#approvalDlg { width: min(1000px, calc(100vw - 32px)); max-height: calc(100vh - 32px); padding: 16px 20px; border: 3px solid var(--accent); border-radius: 10px; background: var(--tint); color: var(--text); box-shadow: 0 12px 48px rgba(0,0,0,.4); }
#approvalDlg::backdrop { background: rgba(0,0,0,.55); }
#approvalDlg h3 { margin: 0 0 8px; font-size: 18px; } #approvalDlg .big { font-size: 16px; }
#approvalDlg .agame { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; margin: 8px 0; }
#approvalDlg .athumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
#approvalDlg .athumbs figure { width: 64px; } #approvalDlg .athumbs img { width: 64px; height: 100px; object-fit: contain; display: block; background: var(--bg); border: 2px solid #c2410c; border-radius: 4px; }
#approvalDlg figcaption { font-size: 11px; color: var(--muted); text-align: center; }
#approvalDlg .actions { display: flex; gap: 8px; margin-top: 12px; } #approvalDlg .actions button { margin: 0; padding: 8px 16px; font-size: 15px; }
#overview summary { cursor: pointer; }
#runbar { position: sticky; top: 0; z-index: 40; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 16px; background: var(--accent); color: #fff; font-weight: 600; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
#runbar[hidden] { display: none; } body:has(#runbar:not([hidden])) aside { top: 56px; max-height: calc(100vh - 72px); } #runbar.stopped { background: var(--warn); } #runbar a { color: #fff; }
#runbar .spin { border-color: #fff; border-right-color: transparent; } #runbar button { margin: 0; background: #fff; color: #1d1d1f; border: none; }
#status progress, #approval progress { width: 100%; height: 14px; accent-color: var(--accent); }
.runlist ol { margin: 4px 0; padding-left: 22px; font-size: 12px; } .runlist li .st { color: var(--muted); }
.runlist li.done .st { color: var(--accent); font-weight: 600; } .runlist li.failed, .runlist li.failed .st { color: var(--warn); font-weight: 600; }
.runlist li.current { font-weight: 600; } .runlist li.current .st { color: #c2410c; }
.gbadge.failed { background: var(--warn); } table.grid td.failed a.thumb { border: 3px solid var(--warn); }
.gbadge .spin { width: 8px; height: 8px; border-width: 2px; border-color: #fff; border-right-color: transparent; margin-right: 3px; }
#status h2 .spin { margin-right: 8px; }
.spin { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border: 2px solid var(--accent); border-right-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
details.errs summary { color: var(--warn); cursor: pointer; } details.errs li { color: var(--warn); font-size: 12px; }
#overview > details, #report > details { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 12px; margin-bottom: 16px; }
#report h2 { font-size: 17px; } #report h3 { font-size: 15px; margin-top: 16px; } #report h4 { font-size: 14px; }
.tablewrap { overflow-x: auto; } table.rtable { border-collapse: collapse; font-size: 12px; margin: 6px 0; }
table.rtable th, table.rtable td { border: 1px solid var(--line); padding: 4px 6px; vertical-align: top; text-align: left; }
.rimg { position: relative; display: inline-block; } .rimg img { height: 110px; width: auto; border-radius: 4px; display: block; }
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
<div id="runbar" role="status" aria-live="polite" hidden></div>
<div class="wrap">
<main>
<div id="overview"></div>
<div id="report"></div>
<h1>Raw store decks: ${escHtml(vm.project)}</h1>
<p class="meta">Downloaded run ${escHtml(vm.runId)}. Images as they appear on Google Play, in store order. Analysed screenshots show their screen type and headline under the picture, and an (i) button: hover or focus it to see the full analysis. Tick the named competitors for the core check and drag them into order on the right. Tablet-shaped screenshots are shown but not analysed.</p>
<p><label>Show country: <select id="locale"></select></label></p>
<h2>Comparison grid: ${escHtml(vm.coreMarket.label)}</h2>
<p class="meta">Our game first, then your pick in priority order. Each column is a store position. Orange border and "will analyse": in the next batch (pick the batch under Analysis). Blue: already analysed. Greyed out: not analysed; hover for the reason.</p>
<p id="gridHint" hidden></p>
<div class="gridwrap" id="grid"></div>
<h2>All downloaded decks</h2>
<h3>Our game</h3><div id="ours"></div>
<h3>Named competitors</h3><div id="named"></div>
<h3>Chart games (shown raw; analysed only if you pick them later)</h3><div id="chart"></div>
</main>
<aside><div id="status" role="status" aria-live="polite" tabindex="-1"></div><div id="panel"></div>
<div id="analysisBox"><h2>Analysis</h2>
<p><label>Batch: <select id="stage"><option value="pilot">Core pilot (ours + first ${escHtml(vm.pilotCompetitors)} competitors)</option><option value="core">Full core check</option></select></label></p>
<button id="startAnalysis">Start analysis</button>
<p class="meta">Shows the image count, model passes and estimated cost first. Nothing is sent to an AI model until you press Approve and run.</p>
</div></aside>
</div>
<dialog id="approvalDlg" aria-label="Analysis approval and progress"><div id="approval" tabindex="-1"></div></dialog>
<div id="infoPop" role="dialog" aria-label="Screenshot analysis" hidden></div>
<script type="application/json" id="data">${data}</script>
<script>${GALLERY_SCRIPT}</script>
</body>
</html>
`;
}

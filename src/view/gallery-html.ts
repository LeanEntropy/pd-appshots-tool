import { CSS } from "./gallery-css.ts";
import { GALLERY_SCRIPT } from "./gallery-script.ts";
import type { ViewModel } from "./model.ts";
import { REPORT_LIST_CSS } from "./report-list.ts";
import { appBar, escHtml, type Step, stepBar } from "./shell.ts";

/** Served by the tool server: where the project's API is, and the project's steps. */
export interface GalleryServed {
  /** The project's display name. */
  name: string;
  apiBase: string;
  steps: readonly Step[];
  stage: string;
}

/**
 * Deterministic HTML: the same view model always produces the same page. The token (only when
 * served by the local gallery server) authorises the page's saves and analysis requests.
 */
export function galleryHtml(vm: ViewModel, token = "", served?: GalleryServed): string {
  const data = JSON.stringify(vm).replace(/</g, "\\u003c");
  const app = JSON.stringify({ apiBase: served?.apiBase ?? "/api", stage: served?.stage ?? "" });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="ssr-token" content="${escHtml(token)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Store Screenshot Recipe</title>
<style>${CSS}${REPORT_LIST_CSS}</style>
</head>
<body>
<div id="runbar" role="status" aria-live="polite" hidden></div>
${served ? appBar(served.name) + stepBar(served.steps) : ""}
<header class="top">
<div class="titlebar"><h1>${served ? escHtml(served.name) : `Store Screenshot Recipe: ${escHtml(vm.project)}`}</h1><span class="meta grow">Downloaded run ${escHtml(vm.runId)}. Market for the analysis: ${escHtml(vm.coreMarket.label)}.</span><label>Show country: <select id="locale"></select></label></div>
<nav class="tabs" aria-label="Pages"><a href="#overview" data-tab="overview">Overview</a><a href="#competitors" data-tab="competitors">Competitors</a><a href="#screenshots" data-tab="screenshots">Screenshots</a><a href="#analysis" data-tab="analysis">Analysis</a><a href="#report" data-tab="report">Report</a></nav>
</header>
<main class="pages">
<section data-page="overview" hidden><h2 class="ph" tabindex="-1">Store overview</h2>
<p class="meta">Free: computed from the downloaded images only, no AI. Orientation mix, aspect ratios, deck lengths, reuse of US images and measured colours per country.</p>
<div id="overview"></div></section>
<section data-page="competitors" hidden><h2 class="ph" tabindex="-1">Competitors</h2>
<p class="meta">Tick the named competitors for the core check, then drag them into priority order in the list. Your pick saves automatically. Tablet-shaped screenshots are shown but not analysed.</p>
<div class="twocol"><div id="named"></div><div class="side"><div id="panel"></div></div></div></section>
<section data-page="screenshots" hidden><h2 class="ph" tabindex="-1">Screenshots</h2>
<details class="sec" open><summary><span class="sec-t">Comparison grid: ${escHtml(vm.coreMarket.label)}</span></summary><div class="sec-b">
<p class="meta">Our game first, then your pick in priority order. Each column is a store position. Orange border and "will analyse": in the next batch (pick the batch on the Analysis page). Blue: already analysed. Greyed out: not analysed; hover for the reason. The (i) button shows the full analysis.</p>
<p id="gridHint" hidden></p>
<div class="gridwrap" id="grid"></div></div></details>
<details class="sec" open><summary><span class="sec-t">Our game: all countries</span></summary><div class="sec-b" id="ours"></div></details>
<details class="sec"><summary><span class="sec-t">Chart games (shown raw; analysed only if you pick them later)</span></summary><div class="sec-b" id="chart"></div></details>
</section>
<section data-page="analysis" hidden><h2 class="ph" tabindex="-1">Analysis</h2>
<div class="twocol"><div><div id="status" class="card" role="status" aria-live="polite" tabindex="-1"></div></div>
<div class="side"><div id="analysisBox" class="card"><h2>Start a batch</h2>
<p><label>Batch: <select id="stage"><option value="pilot">Core pilot (ours + first ${escHtml(vm.pilotCompetitors)} competitors)</option><option value="core">Full core check</option></select></label></p>
<button id="startAnalysis" class="primary">Start analysis</button>
<p class="meta">Shows the image count, model passes and estimated cost first. Nothing is sent to an AI model until you press Approve and run. Screenshots already analysed are never sent again.</p>
</div></div></div></section>
<section data-page="report" hidden><h2 class="ph" tabindex="-1">Report</h2>
<div class="card"><label><input type="checkbox" id="showImages" checked> Show images</label>
<span class="meta">All reports of this project, newest first. Each one is folded: open it to read it.</span><p id="reportStatus" class="act-msg" hidden></p></div>
<div id="reportList"></div><div id="expansion"></div></section>
</main>
<dialog id="approvalDlg" aria-label="Analysis approval and progress"><div id="approval" tabindex="-1"></div></dialog>
<div id="infoPop" role="dialog" aria-label="Screenshot analysis" hidden></div>
<script type="application/json" id="data">${data}</script>
<script type="application/json" id="app">${app.replace(/</g, "\\u003c")}</script>
<script>${GALLERY_SCRIPT}</script>
</body>
</html>
`;
}

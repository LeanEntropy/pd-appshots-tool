import { HEAD_FONT_CSS } from "./shell.ts";

/**
 * The look of the library pages (image page, games directory, game page): style A "Tinted
 * bands" (user, 2026-09-29) - a dark teal header band, full-width soft-tinted bands by kind,
 * rows with dividers, no boxes inside boxes, details behind folds. Light and dark.
 */
const LIGHT =
  "--a-canvas: #faf9f6; --a-head: #1f4f5c; --a-teal: #e3eef1; --a-sand: #f7efe2; --a-green: #e6f1e8; --a-blue: #e7ecf4; --a-grey: #eef0f0; --a-h: #1f4f5c; --a-h2: #7a4417; --a-h3: #2c6a45; --a-div: rgba(31,79,92,.16); --a-surface: #ffffff; --a-muted: #5d656c; --a-amber: #fff4d6; --a-amber-line: #d9a21b; --a-bad: #b3261e;";
const DARK =
  "--a-canvas: #171a1b; --a-head: #1d4955; --a-teal: #1a2c31; --a-sand: #2a241b; --a-green: #1b2b21; --a-blue: #1c2330; --a-grey: #1f2426; --a-h: #9fd0dd; --a-h2: #e8b184; --a-h3: #8fd0a6; --a-div: rgba(255,255,255,.1); --a-surface: #1c2022; --a-muted: #a3aaaf; --a-amber: #3a2f12; --a-amber-line: #d9a21b; --a-bad: #f87171;";

export const LIB_CSS = `
${HEAD_FONT_CSS}
:root { ${LIGHT} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { ${DARK} }
body { background: var(--a-canvas); }
main.lib { max-width: 1180px; margin: 0 auto; padding: 0 0 60px; }
.lib .meta { color: var(--a-muted); }
.lib-crumbs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding: 14px 16px 10px; font-size: 14px; }
.lib-crumbs a { color: var(--a-h); } .lib-crumbs .grow { flex: 1; }
.lib-crumbs select { font: inherit; padding: 3px 6px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--text); }
.lib-head { background: var(--a-head); color: #fff; padding: 16px 24px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 18px; }
.lib-head h1 { margin: 0; color: #fff; font-size: 22px; font-weight: 800; flex: 1 1 320px; min-width: 0; overflow-wrap: anywhere; }
.lib-head .sub { color: rgba(255,255,255,.85); font-size: 14px; }
.lib-head abbr { text-decoration: underline dotted; cursor: help; }
.lib-head img.flag { box-shadow: 0 0 0 1px rgba(255,255,255,.4); }
.band { padding: 20px 24px; border-top: 1px solid var(--a-div); background: var(--a-grey); }
.band > h2 { margin: 0 0 10px; font-size: 13px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--a-h); }
.band.teal { background: var(--a-teal); } .band.sand { background: var(--a-sand); } .band.sand > h2 { color: var(--a-h2); }
.band.green { background: var(--a-green); } .band.green > h2 { color: var(--a-h3); } .band.blue { background: var(--a-blue); }
.band.notice { background: var(--a-amber); border-left: 6px solid var(--a-amber-line); font-weight: 600; }
.band.plain { background: none; }
.rows { list-style: none; margin: 0; padding: 0; }
.rows > li { padding: 7px 0; border-top: 1px solid var(--a-div); overflow-wrap: anywhere; }
.rows > li:first-child { border-top: 0; }
.rows .k { display: inline-block; min-width: 150px; font-weight: 700; color: var(--a-h); }
.rows li.current { font-weight: 700; }
.bad { color: var(--a-bad); font-weight: 700; }
.state { font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--a-surface); color: var(--a-muted); margin-left: 6px; white-space: nowrap; }
.state.matched { color: var(--a-h3); }
.pic { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 16px; background: var(--a-surface); }
.pic img.big { max-width: 100%; max-height: calc(100vh - 120px); object-fit: contain; border-radius: 8px; box-shadow: 0 2px 12px rgba(0,0,0,.18); }
.pic .gone { width: min(100%, 360px); aspect-ratio: 9 / 16; display: grid; place-items: center; text-align: center; padding: 16px; background: var(--a-grey); color: var(--a-muted); border-radius: 8px; }
details.fold { border-top: 1px solid var(--a-div); padding: 10px 24px; background: var(--a-canvas); }
details.fold > summary { cursor: pointer; font-weight: 700; color: var(--a-h); }
details.fold[open] > summary { margin-bottom: 8px; }
.sw { display: inline-block; width: 12px; height: 12px; border-radius: 3px; margin: 0 4px 0 10px; vertical-align: -1px; box-shadow: 0 0 0 1px rgba(0,0,0,.2); }
.said { font-size: 16px; }
.wf-panels { display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start; }
.wf-panel { max-width: 100%; } .wf-panel svg.wireframe { max-width: 100%; height: auto; }
.wf-title { font-weight: 800; color: var(--a-h); margin-bottom: 4px; }
.wf-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 0; margin: 6px 0; font-size: 12px; }
.wf-legend li { display: flex; align-items: center; gap: 4px; }
ol.wf-rows { list-style: none; padding: 0; margin: 6px 0; font-size: 14px; }
ol.wf-rows li { display: flex; gap: 8px; padding: 5px 0; border-top: 1px solid var(--a-div); }
ol.wf-rows .wf-no { flex: none; min-width: 26px; font-weight: 800; color: var(--a-h); }
.wf-sum { font-size: 13px; margin: 4px 0; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { display: inline-flex; align-items: center; gap: 3px; font-size: 12px; font-weight: 650; padding: 2px 7px; border-radius: 999px; background: var(--a-teal); color: var(--a-h); }
.chip img.flag { margin-right: 0; }
.chip.dim { opacity: .45; }
@media (max-width: 560px) {
  .band, details.fold, .lib-head { padding-left: 16px; padding-right: 16px; }
  .rows .k { display: block; min-width: 0; }
  .lib-head h1 { font-size: 19px; }
}
`;

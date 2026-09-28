/**
 * The Reports tab's look ("Tinted bands", chosen by the user on 2026-09-29): a warm canvas, "What
 * next?" and "Suggested next research" as tinted blocks with rows inside, report cards as tinted
 * blocks (dark teal header band when open), and each report section as a full-width band tinted
 * by its kind (data-sec). No side bands and no boxes inside boxes. Scoped to the Reports tab
 * (section[data-page="report"]): the other tabs and the print page keep their own styles.
 */
const LIGHT =
  "--a-canvas: #faf9f6; --a-head: #1f4f5c; --a-teal: #e3eef1; --a-sand: #f7efe2; --a-green: #e6f1e8; --a-blue: #e7ecf4; --a-grey: #eef0f0; --a-grey2: #e7eaeb; --a-h: #1f4f5c; --a-h2: #7a4417; --a-h3: #2c6a45; --a-div: rgba(31,79,92,.16); --a-surface: #ffffff; --a-muted: #5d656c; --a-line: #c9cdcf; --a-accent: #2d6a7a; --a-on-accent: #ffffff; --a-good: #2c7549; --a-good-bg: #e4f1e8; --a-bad: #9d5520; --a-bad-bg: #f7ebdf; --a-miss: rgba(194,106,34,.1); --a-our: rgba(255,255,255,.55);";
const DARK =
  "--a-canvas: #171a1b; --a-head: #1d4955; --a-teal: #1a2c31; --a-sand: #2a241b; --a-green: #1b2b21; --a-blue: #1c2330; --a-grey: #1f2426; --a-grey2: #1b1f21; --a-h: #9fd0dd; --a-h2: #e8b184; --a-h3: #8fd0a6; --a-div: rgba(255,255,255,.1); --a-surface: #1c2022; --a-muted: #a3aaaf; --a-line: #434b4f; --a-accent: #86bccb; --a-on-accent: #0f1a1d; --a-good: #80c79b; --a-good-bg: #1f3428; --a-bad: #e2a574; --a-bad-bg: #3a2b1e; --a-miss: rgba(226,165,116,.12); --a-our: rgba(255,255,255,.04);";

const S = 'section[data-page="report"]';
/** A selector for every band section (with its suffix on each part). */
const band = (x = "") =>
  `${S} .rbox details.sec[data-sec]${x}, ${S} .rbox details.sec.research${x}`;

export const REPORTS_A_CSS = `
:root { ${LIGHT} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${DARK} } }
:root[data-theme="dark"] { ${DARK} }
@media screen {
body:has(${S}:not([hidden])) { background: var(--a-canvas); }
${S} { container-type: inline-size; --muted: var(--a-muted); }
main.pages > ${S} > h2.ph { font-size: 28px; font-weight: 800; color: var(--a-h); letter-spacing: -.015em; margin: 0 0 12px; }
${S} > .card:has(#newReport) { background: none; border: 0; padding: 0; margin: 0 0 16px; }
${S} .rcard > summary, ${S} #sgSec > summary, ${S} .rbox details.sec > summary { list-style: none; }
${S} .rcard > summary::-webkit-details-marker, ${S} #sgSec > summary::-webkit-details-marker, ${S} .rbox details.sec > summary::-webkit-details-marker { display: none; }
${S} .rcard > summary::after, ${S} #sgSec > summary::after, ${S} .rbox details.sec > summary::after { content: ""; flex: none; width: 8px; height: 8px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg); opacity: .7; margin: 0 4px 4px; }
${S} .rcard[open] > summary::after, ${S} #sgSec[open] > summary::after, ${S} .rbox details.sec[open] > summary::after { transform: rotate(-135deg); margin: 4px 4px 0; }

/* Buttons and chips */
${S} button:where(:not(.linkbtn, .info, .sgd, .covc, .stopbtn)) { font-size: 13px; padding: 5px 12px; border-radius: 8px; border: 1px solid var(--a-line); background: var(--a-surface); color: var(--text); }
${S} button.primary { background: var(--a-accent); color: var(--a-on-accent); border-color: transparent; }
${S} button.imgbtn { font-size: 12px; padding: 2px 8px; border-radius: 6px; border-color: transparent; }
${S} button.linkbtn { color: var(--a-accent); }
${S} .pill, ${S} .chip { display: inline-block; font-size: 12px; font-weight: 650; line-height: 1.3; padding: 3px 10px; border: 0; border-radius: 999px; background: var(--a-surface); color: var(--muted); }
${S} .pill.following, ${S} .pill.current, ${S} .pill.strong, ${S} .pill.t-core { background: var(--a-good-bg); color: var(--a-good); }
${S} .pill.slightly, ${S} .pill.stale, ${S} .pill.moderate, ${S} .pill.very, ${S} .pill.missing, ${S} .pill.newer { background: var(--a-bad-bg); color: var(--a-bad); }
${S} .pill.t-pilot, ${S} .pill.t-compare, ${S} .pill.t-country { background: var(--a-teal); color: var(--a-h); }

/* What next?, Suggested next research, the builder */
${S} .expand, ${S} #sgSec, ${S} #builder { border: 0; border-radius: 14px; padding: 18px 24px; margin: 0 0 14px; }
${S} .expand { background: var(--a-teal); } ${S} #sgSec { background: var(--a-sand); } ${S} #builder { background: var(--a-grey); }
${S} .expand h3 { font-size: 20px; font-weight: 800; color: var(--a-h); margin: 0 0 6px; }
${S} #sgSec > summary { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px; padding: 0; background: none; border-radius: 0; }
${S} #sgSec > summary .sec-t { flex: 1; font-size: 20px; font-weight: 800; color: var(--a-h2); }
${S} #sgSec > .sec-b { padding: 10px 0 0; }
${S} .offers { grid-template-columns: minmax(0, 1fr); gap: 0; margin: 6px 0 10px; }
${S} .offer { gap: 6px; padding: 12px 0 8px; border: 0; border-top: 1px solid var(--a-div); border-radius: 0; background: none; }
${S} .offer h4 { font-size: 16px; font-weight: 750; }
${S} .offer .offer-acts { margin-top: 2px; }
${S} .bwarn { border-left: 0; border-radius: 8px; background: var(--a-bad-bg); }

/* Report cards */
${S} .rcard { border: 0; border-radius: 14px; overflow: clip; background: var(--a-grey); }
${S} .rcard.t-pilot { background: var(--a-blue); } ${S} .rcard.t-compare { background: var(--a-grey2); }
${S} .rcard > summary { position: relative; padding: 16px 44px 16px 24px; color: var(--a-h); }
${S} .rcard > summary::after { position: absolute; right: 18px; top: 24px; margin: 0; }
${S} .rcard[open] > summary::after { top: 30px; margin: 0; }
${S} .rcard > summary .pill { white-space: normal; max-width: 100%; }
${S} .rc-name { font-size: 18px; font-weight: 800; color: var(--a-h); }
${S} .rc-desc { font-size: 13px; color: var(--muted); }
${S} .rcard[open] > summary { background: var(--a-head); color: #fff; padding: 22px 44px 8px 24px; }
${S} .rcard[open] .rc-name { color: #fff; font-size: 24px; }
${S} .rcard[open] > summary .rc-desc { color: rgba(255,255,255,.8); }
${S} .rcard[open] > summary .pill { background: rgba(255,255,255,.16); color: #fff; }
${S} .rcard > .rc-b { padding: 0; border: 0; }
${S} .rc-b > .banner { margin: 0; padding: 12px 24px; border: 0; border-radius: 0; background: var(--a-bad-bg); }
${S} .rc-b > .banner p { margin: 0; }
${S} .rc-top { background: var(--a-head); color: rgba(255,255,255,.85); padding: 4px 24px 18px; }
${S} .rc-top .rc-bar { margin: 0; } ${S} .rc-top .meta { color: rgba(255,255,255,.75); } ${S} .rc-top .meta:empty { display: none; }
${S} .rc-top button:not(.linkbtn) { background: rgba(255,255,255,.14); color: #fff; border-color: transparent; }
${S} .rc-top button.primary, ${S} .rc-top button.rc-pdf { background: #fff; color: #1f4f5c; }
${S} .rc-top button.danger { color: #ffd0c8; }
${S} .rc-top select { background: rgba(255,255,255,.14); color: #fff; border: 1px solid rgba(255,255,255,.3); border-radius: 6px; }
${S} .rc-top select option, ${S} .rc-top select optgroup { color: #1e2327; background: #fff; }
${S} .rc-top .act-msg { color: #fff; } ${S} .rc-top .act-msg.bad { color: #ffd0c8; }
${S} .rc-top .pdfres, ${S} .rc-top .banner { border: 0; border-radius: 8px; background: var(--a-surface); color: var(--text); }
${S} .rc-top .pdfres .meta, ${S} .rc-top .banner .meta { color: var(--muted); }
${S} .rbox > p, ${S} .rbox > .card, ${S} .rbox > .banner { margin: 0; padding: 16px 24px; border: 0; border-radius: 0; background: none; }

/* Report sections: full-width tinted bands, coloured by kind */
${band()} { --k-h: var(--a-h); margin: 0; padding: 24px 24px 26px; border: 0; border-radius: 0; background: var(--a-grey); }
${S} .rbox details.sec[data-sec="summary"], ${S} .rbox details.sec[data-sec="abtests"] { background: var(--a-teal); }
${S} .rbox details.sec[data-sec="patterns"], ${S} .rbox details.sec[data-sec="research"], ${S} .rbox details.sec.research { --k-h: var(--a-h2); background: var(--a-sand); }
${S} .rbox details.sec[data-sec="recs"] { --k-h: var(--a-h3); background: var(--a-green); }
${S} .rbox details.sec[data-sec="store"] { background: var(--a-grey2); }
${band(" > summary")} { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; padding: 0; background: none; border-radius: 0; color: var(--k-h); }
${band(" > summary::after")} { align-self: center; }
${band(" .sec-t")} { flex: 1; min-width: 0; font-size: 24px; font-weight: 800; color: var(--k-h); letter-spacing: -.015em; line-height: 1.2; }
${band(":not([open]) .sec-t")} { font-size: 19px; }
${band(" .secno")} { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; margin-right: -.1em; opacity: .4; color: transparent; background: linear-gradient(to right, var(--k-h) 1ch, transparent 1ch); -webkit-background-clip: text; background-clip: text; }
${band(" > .sec-b")} { padding: 12px 0 0; }
${band(" h3")} { font-size: 12.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--k-h); margin: 24px 0 4px; }
${S} .rbox > details.sec:not([data-sec]):not(.research) { margin: 0; padding: 0; border: 0; border-radius: 0; background: none; }
${S} .rbox > details.sec:not([data-sec]):not(.research) > summary { display: flex; align-items: center; gap: 10px; padding: 18px 24px 12px; background: none; border-radius: 0; color: var(--a-h); }
${S} .rbox > details.sec:not([data-sec]):not(.research) > summary .sec-t { flex: 1; font-size: 22px; font-weight: 800; }
${S} .rbox > details.sec:not([data-sec]):not(.research) > .sec-b { padding: 0; }
${S} .rbox nav.toc { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin: 0; padding: 14px 24px; border: 0; border-radius: 0; background: var(--a-grey2); }
${S} .rbox nav.toc strong { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
${S} .rbox nav.toc ol { display: contents; list-style: none; } ${S} .rbox nav.toc li { display: inline; margin: 0; }
${S} .rbox nav.toc .linkbtn { background: var(--a-surface); border-radius: 999px; padding: 3px 11px; text-decoration: none; font-size: 13px; }
${S} .rbox .banner { border: 0; border-radius: 10px; background: var(--a-bad-bg); }

/* Inside the sections: rows with dividers, no boxes */
${S} .verdict { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; min-width: 0; margin: 0 0 6px; padding: 0; border: 0; border-radius: 0; background: none; }
${S} .verdict .vlabel { font-size: 15px; color: var(--muted); text-transform: none; letter-spacing: 0; }
${S} .verdict .vword { font-size: 34px; font-weight: 850; line-height: 1.1; color: var(--muted); }
${S} .verdict.following .vword { color: var(--a-good); } ${S} .verdict.slightly .vword, ${S} .verdict.very .vword { color: var(--a-bad); }
${S} .verdict > .meta { flex-basis: 100%; font-size: 14px; }
${S} .short { font-size: 16.5px; line-height: 1.6; max-width: 760px; }
${S} ol.keypoints, ${S} ol.keyrecs { list-style: none; padding: 0; margin: 0; counter-reset: k; }
${S} ol.keypoints li, ${S} ol.keyrecs li { counter-increment: k; position: relative; margin: 0; padding: 10px 0 10px 28px; border-top: 1px solid var(--a-div); font-size: 15px; }
${S} ol.keypoints li::before, ${S} ol.keyrecs li::before { content: counter(k); position: absolute; left: 0; font-weight: 800; color: var(--a-h); }
${S} .abcards { grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 0 28px; margin: 6px 0 8px; }
${S} .abcard { padding: 12px 0; border: 0; border-top: 1px solid var(--a-div); border-radius: 0; background: none; }
${S} .abcard h4 { font-size: 16px; font-weight: 750; margin: 0 0 4px; } ${S} .abcard p { margin: 3px 0; font-size: 14px; }
${S} .abcard .abno { display: inline-grid; place-items: center; width: 24px; min-width: 0; height: 24px; line-height: 1; border-radius: 50%; background: var(--a-head); color: #fff; font-size: 13px; margin-right: 8px; vertical-align: 1px; }
${S} .dates { font-size: 13px; color: var(--muted); margin-top: 14px; }
${S} table.rt th, ${S} table.rt td { border: 0; border-bottom: 1px solid var(--a-div); background: none; padding: 6px 9px; }
${S} table.rt th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--a-h); }
${S} table.rt tr:first-child th { border-bottom: 2px solid var(--a-div); }
${S} table.rt tr.miss td { background: var(--a-miss); }
${S} table.rt.pos td.ourcell { background: var(--a-our); }
${S} .slot, ${S} .abtest { margin: 0; padding: 14px 0 6px; border: 0; border-top: 1px solid var(--a-div); border-radius: 0; background: none; }
${band(" .slot h4")}, ${band(" .abtest h3")} { font-size: 17px; font-weight: 750; text-transform: none; letter-spacing: 0; margin: 0 0 4px; color: var(--a-h3); }
${band(" .abtest h3")} { color: var(--a-h); }
${S} .pcard { border: 0; background: var(--a-our); }
}
@container (max-width: 560px) {
  ${S} .expand, ${S} #sgSec, ${S} #builder, ${S} .rc-top, ${S} .rc-b > .banner, ${S} .rbox > p, ${S} .rbox > .card, ${S} .rbox nav.toc, ${band()} { padding-left: 14px; padding-right: 14px; }
  ${S} .rcard > summary, ${S} .rcard[open] > summary { padding-left: 14px; padding-right: 40px; }
  ${S} .rcard > summary::after { right: 14px; }
  ${S} .rbox > details.sec:not([data-sec]):not(.research) > summary { padding-left: 14px; padding-right: 14px; }
  ${band(" .sec-t")} { font-size: 21px; } ${S} .rcard[open] .rc-name { font-size: 21px; }
}
@container (max-width: 600px) {
  ${S} table.rt.fit, ${S} table.rt.fit tbody { display: block; }
  ${S} table.rt.fit tr:first-child { display: none; }
  ${S} table.rt.fit tr { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; padding: 8px 0; border-bottom: 1px solid var(--a-div); }
  ${S} table.rt.fit td, ${S} table.rt.fit tr.miss td { border: 0; padding: 0; background: none; }
  ${S} table.rt.fit tr.miss { background: var(--a-miss); }
  ${S} table.rt.fit td:nth-child(n+2) { grid-column: 2; }
  ${S} table.rt.fit td:nth-child(n+3) { font-size: 13px; color: var(--muted); }
}
`;

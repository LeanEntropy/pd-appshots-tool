import { CSS } from "./gallery-css.ts";
import { REPORT_SCRIPT } from "./gallery-report.ts";
import { REPORT_PARTS_SCRIPT } from "./gallery-report-parts.ts";
import { STORE_SCRIPT } from "./gallery-store.ts";
import { REPORT_ENGINE_SCRIPT } from "./report-engine.ts";
import { SUGGEST_CSS } from "./report-suggest.ts";
import { REPORT_SUMMARY_CSS, REPORT_SUMMARY_SCRIPT } from "./report-summary.ts";
import { escHtml } from "./shell.ts";

/** What the print page shows: one report version, and the export options. */
export interface PrintPage {
  /** The report's name, e.g. "Pilot (United States, English)". */
  title: string;
  /** The report type in plain words ("Pilot", "Full check"). */
  kind: string;
  /** Title-page lines: countries, competitors, dates, version. */
  facts: [string, string][];
  /** The saved report data, rendered by the same renderer as the page. */
  data: unknown | null;
  /** An older run saved without data: its markdown as HTML. */
  html: string | null;
  /** Short info line per image id (screen type and headline), shown instead of the (i) button. */
  captions: Record<string, string>;
  images: boolean;
  /** Sections whose pictures the user hid (only when they ticked the option). */
  hiddenSections: string[];
  /** The report's id (the renderer prefixes its element ids with it). */
  reportId: string;
  /** The batch whose data the report shows. */
  stage: "pilot" | "core";
  /** "What to research next" as saved with the version (its suggestions.json), or null. */
  research?: unknown;
}

/**
 * Print mode of the report renderer (plan 6.3): every section and sub-section expanded, section
 * titles as headings (they become the PDF bookmarks), the contents as real links, no buttons,
 * table headers repeated on each page, pictures loaded eagerly. `window.reportReady` turns true
 * when every picture has loaded or failed; `window.reportProgress` counts them meanwhile.
 */
export const PRINT_SCRIPT = `
function printRender(box) {
  showImgs = PRINT.images;
  if (!PRINT.data) { box.classList.toggle("noimg", !showImgs); return; }
  for (const s of PRINT.hiddenSections) hiddenImgSecs.add(PRINT.reportId + ":" + s);
  // The list saved with the version only (a PDF shows the version as it was built).
  const saved = PRINT.research && Array.isArray(PRINT.research.items) ? PRINT.research.items : null;
  const research = saved ? (saved.length ? researchList(saved) : "<p>Nothing to suggest when this version was made.</p>") : "";
  renderReport(box, PRINT.data, PRINT.reportId, PRINT.stage, research);
}

function printMode(root) {
  for (const d of root.querySelectorAll("details")) {
    d.open = true;
    const s = d.querySelector(":scope > summary");
    const t = s && s.querySelector(".sec-t");
    if (t) { const h = document.createElement("h2"); h.className = "sec-t"; h.innerHTML = t.innerHTML; t.replaceWith(h); }
    else if (s) s.innerHTML = "<h3>" + s.innerHTML + "</h3>";
  }
  for (const b of root.querySelectorAll("button[data-goto]")) {
    const a = document.createElement("a");
    a.href = "#" + b.dataset.goto;
    a.textContent = b.textContent;
    b.replaceWith(a);
  }
  for (const b of root.querySelectorAll("button")) b.remove();
  // The contents go on the title page, so the summary starts on page 2.
  const toc = root.querySelector(".toc");
  const title = document.querySelector(".titlepage");
  if (toc && title) title.appendChild(toc);
  // Pictures left out: all of them without pictures, or those of the sections the user hid.
  for (const i of root.querySelectorAll(PRINT.images ? ".noimg .rimgs" : ".rimgs, img")) i.remove();
  for (const t of root.querySelectorAll("table")) {
    const first = t.rows[0];
    if (t.tHead || !first || t.rows.length < 2 || [...first.cells].some((c) => c.tagName !== "TH")) continue;
    t.createTHead().appendChild(first);
  }
}

function printWait(root) {
  const imgs = [...root.querySelectorAll("img")];
  window.reportProgress = { loaded: 0, total: imgs.length };
  const one = (i) => new Promise((r) => {
    const done = () => { window.reportProgress.loaded++; r(); };
    i.loading = "eager";
    if (i.complete) return done();
    i.addEventListener("load", done, { once: true });
    i.addEventListener("error", done, { once: true });
  });
  return Promise.all(imgs.map(one)).then(() => { window.reportReady = true; });
}
`;

/** The standalone print page the PDF export opens (served under the project's views/). */
export function reportPrintHtml(p: PrintPage): string {
  const json = JSON.stringify(p).replace(/</g, "\\u003c");
  const facts = p.facts.map(([k, v]) => `<dt>${escHtml(k)}</dt><dd>${escHtml(v)}</dd>`).join("");
  // An older run: its own HTML (written by the tool's markdown renderer, escaped there).
  const body = p.data ? "" : `<div class="card">${p.html ?? ""}</div>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(p.title)}</title>
<style>${CSS}${REPORT_SUMMARY_CSS}${SUGGEST_CSS}</style>
</head>
<body class="printpage">
<main class="pages">
<section class="titlepage"><div class="kind">${escHtml(p.kind)}</div><h1>${escHtml(p.title)}</h1><dl>${facts}</dl></section>
<div id="report">${body}</div>
</main>
<script type="application/json" id="print">${json}</script>
<script>
const PRINT = JSON.parse(document.getElementById("print").textContent);
const DATA = {};
const IMG = "../images/";
const API = "";
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function infoBtn(id) { const c = id && PRINT.captions[id]; return c ? '<span class="pinfo">' + esc(c) + "</span>" : ""; }
${REPORT_SCRIPT}
${REPORT_PARTS_SCRIPT}
${REPORT_SUMMARY_SCRIPT}
${REPORT_ENGINE_SCRIPT}
${STORE_SCRIPT}
${PRINT_SCRIPT}
{
  const box = document.getElementById("report");
  printRender(box);
  printMode(box);
  // Opened from the page's "Print or save as PDF" (no Chrome or Edge): the print dialog once ready.
  printWait(box).then(() => { if (location.hash === "#autoprint") window.print(); });
}
</script>
</body>
</html>
`;
}

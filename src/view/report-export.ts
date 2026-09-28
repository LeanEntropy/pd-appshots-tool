/**
 * Export PDF on the page (plan 6.3). `exportReportPdf(ref, o)` is the one entry point: each card
 * of the report list (report-list.ts) calls it for the version picked in that card. It asks with
 * or without pictures, the paper and the orientation (defaults from the Settings page, sent with
 * the report list), runs the export job with live progress and Stop, then offers Download, Open
 * and Show in folder. With no Chrome or Edge it offers the browser's own "Print or save as PDF":
 * the same print page of the same version and choices, in a new tab, with the print dialog.
 *   ref: { report: <report id>, version: "now" | <version id> }
 *   o:   { button, status (element or id), result (element or id), images, hiddenSections }
 */
export const EXPORT_CSS = `
#pdfDlg { width: min(520px, calc(100vw - 32px)); border: 3px solid var(--accent); border-radius: 10px; background: var(--card); color: var(--text); padding: 16px 20px; }
#pdfDlg::backdrop { background: rgba(0,0,0,.45); }
#pdfDlg h3 { margin: 0 0 10px; font-size: 18px; } #pdfDlg label { margin-right: 12px; }
#pdfDlg .actions { display: flex; gap: 8px; margin-top: 12px; } #pdfDlg .actions button { margin: 0; padding: 6px 14px; }
.pdfres { border-left: 5px solid var(--ok); background: var(--card); border-radius: 8px; padding: 8px 12px; margin: 8px 0; }
.pdfres .path { font-family: ui-monospace, monospace; font-size: 12px; overflow-wrap: anywhere; }
a.pdfdl { display: inline-block; margin: 6px 4px 0 0; padding: 4px 12px; border-radius: 4px; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600; }
`;

export const EXPORT_SCRIPT = `
// The Settings page's PDF defaults (setPdfDefaults is called with them when the report list loads).
let PDF_DEFAULTS = { paper: "A4", landscape: true, images: true };
function setPdfDefaults(p) {
  if (p) PDF_DEFAULTS = { paper: p.paper === "Letter" ? "Letter" : "A4", landscape: p.orientation !== "portrait", images: p.images !== false };
}
const pdfEl = (x) => (typeof x === "string" ? document.getElementById(x) : x || null);
function pdfSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round((n || 0) / 1024)) + " KB"; }

// The small dialog: with or without pictures, paper, orientation. Resolves null on Cancel.
function pdfAsk(o) {
  return new Promise((resolve) => {
    let d = document.getElementById("pdfDlg");
    if (!d) { d = document.createElement("dialog"); d.id = "pdfDlg"; d.setAttribute("aria-label", "Export PDF"); document.body.appendChild(d); }
    const hidden = o.hiddenSections || [];
    const radio = (v, text) => '<label><input type="radio" name="pdfImg" value="' + v + '"' + ((o.images !== false) === (v === "1") ? " checked" : "") + "> " + text + "</label>";
    d.innerHTML = '<form method="dialog"><h3>Export PDF</h3><p>' + radio("1", "With pictures") + radio("0", "Without pictures") + "</p>"
      + '<p><label>Paper <select name="pdfPaper"><option value="A4">A4</option><option value="Letter"' + (PDF_DEFAULTS.paper === "Letter" ? " selected" : "") + '>Letter</option></select></label>'
      + '<label><input type="checkbox" name="pdfLand"' + (PDF_DEFAULTS.landscape ? " checked" : "") + "> Landscape</label></p>"
      + (hidden.length ? '<p><label><input type="checkbox" name="pdfHidden"> Also hide the pictures I hid in single sections (' + hidden.length + ")</label></p>" : "")
      + '<p class="meta">Every section is printed open. The PDF is saved in the project, and you can download or open it.</p>'
      + '<div class="actions"><button type="submit" value="go" class="primary">Export</button><button type="submit" value="cancel">Cancel</button></div></form>';
    d.returnValue = "";
    d.addEventListener("close", () => {
      if (d.returnValue !== "go") return resolve(null);
      const f = d.querySelector("form").elements;
      resolve({
        images: f.namedItem("pdfImg").value !== "0",
        paper: f.namedItem("pdfPaper").value,
        landscape: f.namedItem("pdfLand").checked,
        hiddenSections: f.namedItem("pdfHidden") && f.namedItem("pdfHidden").checked ? hidden : [],
      });
    }, { once: true });
    d.showModal();
    d.querySelector("button.primary").focus();
  });
}

function pdfResultHtml(job) {
  const id = encodeURIComponent(job.id);
  return '<div class="pdfres" role="status"><strong>' + (job.existing ? "Ready (saved before):" : "Saved:") + "</strong> " + actEsc(job.fileName) + ' <span class="meta">(' + pdfSize(job.sizeBytes) + ")</span>"
    + '<div class="path meta">' + actEsc(job.path || "") + "</div>"
    + '<a class="pdfdl" href="' + API + "/export/pdf/file?job=" + id + '" download>Download PDF</a>'
    + '<button type="button" data-pdf-open="' + actEsc(job.id) + '">Open</button><button type="button" data-pdf-reveal="' + actEsc(job.id) + '">Show in folder</button></div>';
}

// The print page of exactly this version and these choices (served next to this page), in a new
// tab that opens the browser's print dialog once every picture has loaded.
function pdfPrintUrl(ref, opts) {
  const q = new URLSearchParams({ report: ref.report, version: ref.version, images: opts.images ? "1" : "0", hidden: (opts.hiddenSections || []).join(",") });
  return "report-print.html?" + q.toString() + "#autoprint";
}

function pdfFallbackHtml(reason, url) {
  return '<div class="banner stale" role="alert"><p>' + actEsc(reason) + '</p><p><a class="pdfdl" href="' + actEsc(url) + '" target="_blank" rel="noopener">Print or save as PDF</a> <span class="meta">Opens the report in a new tab with the print dialog. Choose "Save as PDF" there.</span></p></div>';
}

/** Exports one report to PDF with live progress; resolves the finished job, or undefined. */
async function exportReportPdf(ref, o) {
  o = o || {};
  const opts = await pdfAsk(o);
  if (!opts) return undefined;
  const box = pdfEl(o.result);
  if (box) box.innerHTML = "";
  let failed = null;
  const job = await act(pdfEl(o.button), {
    key: "pdf:" + ref.report + ":" + ref.version,
    busy: "Exporting the PDF...",
    status: o.status,
    run: async (progress) => {
      let j = (await send(API + "/export/pdf", Object.assign({ report: ref }, opts))).job;
      if (box && (j.state === "waiting" || j.state === "running")) box.innerHTML = '<button type="button" class="stopbtn" data-pdf-stop="' + actEsc(j.id) + '">Stop</button>';
      while (j.state === "waiting" || j.state === "running") {
        progress(j.message, j.done, j.total);
        await new Promise((r) => setTimeout(r, 600));
        j = (await getJson(API + "/export/pdf/status?job=" + encodeURIComponent(j.id))).job;
      }
      if (j.state !== "finished") { failed = j; throw new Error(j.error || "The PDF export stopped."); }
      return j;
    },
    done: (j) => (j.existing ? "This PDF was saved before: it is ready." : "PDF saved (" + pdfSize(j.sizeBytes) + ")."),
    fail: (e) => { if (box) box.innerHTML = failed && failed.noBrowser ? pdfFallbackHtml(actReason(e), pdfPrintUrl(ref, opts)) : ""; },
  });
  if (job && box) box.innerHTML = pdfResultHtml(job);
  return job;
}

// The browser's own print of this page (Ctrl+P): the open reports print with every section open.
// Only report bodies are opened (opening a folded report card would load it).
let pdfReopen = null;
function pdfPrepare(roots) {
  const closed = [];
  for (const root of roots) {
    for (const d of root.querySelectorAll("details")) if (!d.open) { closed.push(d); d.open = true; }
    for (const i of root.querySelectorAll("img")) i.loading = "eager";
  }
  return closed;
}
window.addEventListener("beforeprint", () => { if (!pdfReopen) pdfReopen = pdfPrepare([...document.querySelectorAll(".rcard[open] .rbox")]); });
window.addEventListener("afterprint", () => { for (const d of pdfReopen || []) d.open = false; pdfReopen = null; });

document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-pdf-open], [data-pdf-reveal], [data-pdf-stop]");
  if (!b) return;
  e.preventDefault();
  if (b.dataset.pdfStop) act(b, { busy: "Stopping...", run: () => send(API + "/export/pdf/stop", { job: b.dataset.pdfStop }), done: "Stopping the export." });
  else {
    const reveal = !!b.dataset.pdfReveal;
    act(b, { busy: "Opening...", run: () => send(API + "/export/pdf/open", { job: b.dataset.pdfReveal || b.dataset.pdfOpen, reveal }), done: reveal ? "Shown in its folder." : "Opened in your PDF viewer." });
  }
});
`;

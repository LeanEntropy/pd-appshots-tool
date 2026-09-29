import { WIREFRAME_SCRIPT } from "./gallery-wireframe.ts";

/**
 * The (i) button on every analysed image. Hover or keyboard focus shows the image's analysis
 * (both layers) in a popover; click or Enter pins it; Escape or a click outside closes it.
 */
export const INFO_SCRIPT = `${WIREFRAME_SCRIPT}
let INFO = DATA.info || {};
let infoBtnOpen = null;
let infoPinned = false;
let infoHideTimer = null;
let infoHover = false;
const inPop = (el) => !!(el && el.closest && el.closest("#infoPop"));

// ctx (optional): where this thumbnail sits { app, gl, hl, pos }, carried to its image page.
function infoBtn(id, ctx) {
  const v = id && INFO[id];
  if (!v) return "";
  const c = ctx && ctx.app ? ' data-ctx="' + esc([ctx.app, ctx.gl, ctx.hl, ctx.pos].join("|")) + '"' : "";
  if (v.pending) return '<button type="button" class="info pending" data-info="' + esc(id) + '"' + c + ' aria-label="Not analysed yet" title="Not analysed yet" aria-expanded="false" aria-controls="infoPop">&hellip;</button>';
  return '<button type="button" class="info" data-info="' + esc(id) + '"' + c + ' aria-label="Show analysis" aria-expanded="false" aria-controls="infoPop">i</button>';
}

// The picture's own page (/image/<sha>) with the thumbnail's context, or "" outside the tool.
let infoLink = "";
function imagePageHref(id, btn) {
  const m = /^\\/p\\/([a-z0-9-]{1,60})\\/api$/.exec((typeof APP !== "undefined" && APP.apiBase) || "");
  if (!m || !/^[0-9a-f]{64}$/.test(id)) return "";
  const q = new URLSearchParams({ project: m[1] });
  const c = String((btn && btn.dataset.ctx) || "").split("|");
  if (c.length === 4 && c[0]) { q.set("app", c[0]); q.set("gl", c[1]); q.set("hl", c[2]); q.set("pos", c[3]); }
  return "/image/" + id + "?" + q.toString();
}

function swatches(cs) {
  return (cs || []).map((c) => '<span class="sw" style="background:' + (/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "transparent") + '"></span>' + esc(c.name)).join(" ");
}

function words(s) { return esc(String(s).replace(/_/g, " ")); }

function identityHtml(v) {
  return '<p class="meta"><strong>' + esc(v.game) + " #" + esc(v.position) + "</strong> &middot; " + esc(v.filename) + "<br>"
    + (v.file ? '<a href="../' + esc(v.file) + '" target="_blank" rel="noopener">Open image</a>' : "")
    + (infoLink ? (v.file ? " &middot; " : "") + '<a class="imgpage" href="' + esc(infoLink) + '" target="_blank" rel="noopener">Open image page</a>' : "")
    + (v.sourceUrl && String(v.sourceUrl).startsWith("https://play-lh.googleusercontent.com/") ? ' &middot; <a href="' + esc(v.sourceUrl) + '" target="_blank" rel="noopener noreferrer">On Google Play</a>' : "") + "</p>"
    + (v.appearances && v.appearances.length > 1 ? '<p class="meta">Appears ' + v.appearances.length + " times: " + esc(v.appearances.join(", ")) + "</p>" : "");
}

function infoHtml(v) {
  if (v.pending) {
    return "<h4>Not analysed yet</h4>" + identityHtml(v)
      + (v.image ? "<dl><dt>Image</dt><dd>" + esc(v.image) + "</dd></dl>" : "")
      + "<p>" + esc(v.pending) + "</p>"
      + (v.problems.length ? '<details class="tech"><summary>Technical details</summary><p class="meta">' + esc(v.problems.join("; ")) + "</p></details>" : "");
  }
  let h = "<h4>" + esc(v.screen) + '</h4><p class="meta">Status: ' + esc(v.status) + (v.models.length ? " &middot; " + esc(v.models.join(", ")) : "") + "</p>" + identityHtml(v);
  if (v.mappedFrom) h += '<p class="meta">Screen type mapped by rule from ' + esc(v.mappedFrom) + " (no model call).</p>";
  const a = v.final;
  const s = a.screenshot, m = a.marketingLayer;
  h += "<dl>" + (v.image ? "<dt>Image</dt><dd>" + esc(v.image) + "</dd>" : "")
    + (v.imageColours.length ? "<dt>Measured colours</dt><dd>" + swatches(v.imageColours) + "</dd>" : "")
    + (v.composition ? "<dt>Composition</dt><dd>" + esc(v.composition) + "</dd>" : "")
    + (v.captures.length ? "<dt>In-game " + (v.captures.length > 1 ? "captures" : "capture") + "</dt><dd>" + (v.captures.length > 1 ? "<ol>" + v.captures.map((c) => "<li>" + esc(c) + "</li>").join("") + "</ol>" : esc(v.captures[0])) + "</dd>" : "") + "</dl>";
  h += "<h5>Screenshot</h5><dl>"
    + "<dt>Shows</dt><dd>" + esc(s.description) + "</dd>"
    + "<dt>Action</dt><dd>" + esc(s.action) + "</dd>"
    + "<dt>Atmosphere</dt><dd>" + esc(s.atmosphere) + "</dd>"
    + "<dt>Colours</dt><dd>" + swatches(s.mainColours) + "</dd></dl>";
  h += "<h5>Marketing layer</h5>";
  if (!m.present) h += "<p>No marketing layer.</p>";
  else {
    h += "<dl><dt>Covers</dt><dd>" + esc(m.coveragePercent) + "% of the image" + (m.relationToScreen === "none" ? "" : ", " + words(m.relationToScreen) + " the screen") + "</dd>"
      + "<dt>Colours</dt><dd>" + swatches(m.mainColours) + "</dd></dl><ul>"
      + m.backgroundMasks.map((b) => "<li>Mask: " + words(b.shape) + ", " + swatches([{ name: b.colourName, hex: b.colourHex }]) + ", " + words(b.location) + "</li>").join("")
      + m.texts.map((t) => "<li>Text <strong>" + esc(t.text) + "</strong>: " + esc(t.colour) + (t.strokeColour && t.strokeColour !== "none" ? ", outline " + esc(t.strokeColour) : "") + ", " + esc(t.fontStyle) + ", " + esc(t.size) + ", " + words(t.position) + "</li>").join("")
      + m.elements.map((e) => "<li>" + words(e.kind) + ": " + esc(e.what) + ", " + esc(e.position) + (e.pose && e.pose !== "n/a" ? ", pose " + esc(e.pose) : "") + ", " + esc(e.colours) + "</li>").join("")
      + "</ul>";
  }
  // The wireframe slot stays empty here: showInfo draws it with DOM calls (wireframeNode), since
  // its labels come from the model and are never parsed as markup.
  if (v.layout) {
    h += "<h5>Layout</h5>";
    const f = v.layout.focus;
    if (f) h += "<dl>" + (f.focus ? "<dt>Focus</dt><dd>" + esc(f.focus) + "</dd>" : "")
      + (f.covers ? "<dt>Marketing covers</dt><dd>" + esc(f.covers) + "</dd>" : "")
      + (f.match ? "<dt>Focus match</dt><dd" + (f.verdict === "mismatch" ? ' class="bad"' : "") + ">" + esc(f.match) + "</dd>" : "")
      + (f.reinforcement ? "<dt>Reinforcement</dt><dd>" + esc(f.reinforcement) + "</dd>" : "") + "</dl>";
    if (v.layout.older) h += '<p class="meta">Drawn from a layout saved by an older version; adding layouts again replaces it.</p>';
    if (v.layout.wireframe) h += '<div class="wf"></div>' + (v.layout.summary ? '<p class="meta">In one sentence: ' + esc(v.layout.summary) + "</p>" : "")
      + (v.layout.notes && v.layout.notes.length ? '<details class="tech"><summary>Layout notes (' + v.layout.notes.length + ")</summary><ul>" + v.layout.notes.map((n) => '<li class="meta">' + esc(n) + "</li>").join("") + "</ul></details>" : "");
    else h += '<p class="meta">' + (v.layout.status === "outdated" ? "The layout is from an older version." : v.layout.status === "stale" ? "The saved layout no longer matches this analysis." : "Layout missing: analysed before layouts existed. Add it on the Analysis page.") + "</p>";
  }
  if (a.notes) h += '<p class="meta">' + esc(a.notes) + "</p>";
  if (v.differences.length) h += '<p class="meta">Readings differed on: ' + esc(v.differences.join("; ")) + "</p>";
  return h;
}

/** Keeps the popover inside the viewport: below the button, flipped up or left near the edges. */
function placeInfo(btn, pop) {
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  // Two wireframe panels side by side need a wider popover; they stack on a narrow screen.
  const wide = pop.querySelector(".wf-panels") ? Math.min(760, Array.from(pop.querySelectorAll(".wf-panel svg.wireframe")).reduce((a, s) => a + Number(s.getAttribute("width") || 0) + 16, 40)) : 380;
  pop.style.width = Math.max(0, Math.min(Math.max(380, wide), vw - 16)) + "px";
  pop.style.maxHeight = Math.max(0, Math.min(wide > 380 ? 720 : 480, vh - 16)) + "px";
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = r.left;
  if (left + w > vw - 8) left = r.right - w;
  left = Math.max(8, Math.min(left, vw - w - 8));
  let top = r.bottom + 6;
  if (top + h > vh - 8) top = r.top - h - 6;
  top = Math.max(8, Math.min(top, vh - h - 8));
  pop.style.left = left + "px";
  pop.style.top = top + "px";
}

function showInfo(btn) {
  const id = btn.dataset.info || "";
  infoLink = id.startsWith("store:") ? "" : imagePageHref(id, btn);
  const html = id.startsWith("store:") ? storeHtml(id.slice(6)) : INFO[id] ? infoHtml(INFO[id]) : "";
  if (!html) return;
  clearTimeout(infoHideTimer);
  if (infoBtnOpen && infoBtnOpen !== btn) infoBtnOpen.setAttribute("aria-expanded", "false");
  const pop = document.getElementById("infoPop");
  pop.innerHTML = html;
  const wf = !id.startsWith("store:") && INFO[id] && INFO[id].layout && INFO[id].layout.wireframe;
  const wfSlot = wf && pop.querySelector(".wf");
  if (wfSlot) wfSlot.appendChild(wireframeNode(wf));
  pop.setAttribute("aria-label", id.startsWith("store:") ? "Store page" : "Screenshot analysis");
  pop.hidden = false;
  placeInfo(btn, pop);
  btn.setAttribute("aria-expanded", "true");
  infoBtnOpen = btn;
}

// Scrolling inside the popover never closes it; a page scroll keeps it open (and in place) while
// it is pinned or the cursor is over it, and closes it otherwise.
window.addEventListener("scroll", (e) => {
  if (!infoBtnOpen || inPop(e.target)) return;
  if (infoPinned || infoHover) placeInfo(infoBtnOpen, document.getElementById("infoPop"));
  else hideInfo(false);
}, true);
window.addEventListener("resize", () => { if (infoBtnOpen) placeInfo(infoBtnOpen, document.getElementById("infoPop")); });

function hideInfo(returnFocus) {
  const pop = document.getElementById("infoPop");
  infoHover = false;
  pop.hidden = true;
  infoPinned = false;
  if (infoBtnOpen) { infoBtnOpen.setAttribute("aria-expanded", "false"); if (returnFocus) infoBtnOpen.focus(); }
  infoBtnOpen = null;
}

const infoTarget = (e) => e.target.closest && e.target.closest("button.info");
document.addEventListener("mouseover", (e) => {
  const b = infoTarget(e);
  if (b && !infoPinned) { if (b !== infoBtnOpen) showInfo(b); clearTimeout(infoHideTimer); }
  else if (inPop(e.target)) { infoHover = true; clearTimeout(infoHideTimer); }
});
// Closes only when the cursor has left both the (i) button and the popover, after a short delay.
document.addEventListener("mouseout", (e) => {
  if (!(infoTarget(e) || inPop(e.target))) return;
  const to = e.relatedTarget;
  if (inPop(to) || (to && infoBtnOpen && (to === infoBtnOpen || infoBtnOpen.contains(to)))) return;
  infoHover = false;
  if (!infoPinned) { clearTimeout(infoHideTimer); infoHideTimer = setTimeout(() => hideInfo(false), 300); }
});
document.addEventListener("focusin", (e) => {
  if (inPop(e.target)) { clearTimeout(infoHideTimer); return; }
  const b = infoTarget(e);
  if (b && !infoPinned) showInfo(b);
});
document.addEventListener("focusout", (e) => {
  if (infoPinned || !(infoTarget(e) || inPop(e.target))) return;
  if (e.relatedTarget && (inPop(e.relatedTarget) || e.relatedTarget === infoBtnOpen)) return;
  infoHideTimer = setTimeout(() => hideInfo(false), 150);
});
document.addEventListener("click", (e) => {
  const b = infoTarget(e);
  if (b) { e.preventDefault(); if (infoPinned && infoBtnOpen === b) hideInfo(false); else { showInfo(b); infoPinned = true; } return; }
  if (infoPinned && !(e.target.closest && e.target.closest("#infoPop"))) hideInfo(false);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && infoBtnOpen) hideInfo(true); });
`;

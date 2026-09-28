/**
 * The (i) button on every analysed image. Hover or keyboard focus shows the image's analysis
 * (both layers) in a popover; click or Enter pins it; Escape or a click outside closes it.
 */
export const INFO_SCRIPT = `
let INFO = DATA.info || {};
let infoBtnOpen = null;
let infoPinned = false;
let infoHideTimer = null;
let infoHover = false;
const inPop = (el) => !!(el && el.closest && el.closest("#infoPop"));

function infoBtn(id) {
  const v = id && INFO[id];
  if (!v) return "";
  if (v.pending) return '<button type="button" class="info pending" data-info="' + esc(id) + '" aria-label="Not analysed yet" title="Not analysed yet" aria-expanded="false" aria-controls="infoPop">&hellip;</button>';
  return '<button type="button" class="info" data-info="' + esc(id) + '" aria-label="Show analysis" aria-expanded="false" aria-controls="infoPop">i</button>';
}

function swatches(cs) {
  return (cs || []).map((c) => '<span class="sw" style="background:' + (/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "transparent") + '"></span>' + esc(c.name)).join(" ");
}

function words(s) { return esc(String(s).replace(/_/g, " ")); }

function identityHtml(v) {
  return '<p class="meta"><strong>' + esc(v.game) + " #" + v.position + "</strong> &middot; " + esc(v.filename) + "<br>"
    + (v.file ? '<a href="../' + esc(v.file) + '" target="_blank" rel="noopener">Open image</a>' : "")
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
    h += "<dl><dt>Covers</dt><dd>" + m.coveragePercent + "% of the image" + (m.relationToScreen === "none" ? "" : ", " + words(m.relationToScreen) + " the screen") + "</dd>"
      + "<dt>Colours</dt><dd>" + swatches(m.mainColours) + "</dd></dl><ul>"
      + m.backgroundMasks.map((b) => "<li>Mask: " + words(b.shape) + ", " + swatches([{ name: b.colourName, hex: b.colourHex }]) + ", " + words(b.location) + "</li>").join("")
      + m.texts.map((t) => "<li>Text <strong>" + esc(t.text) + "</strong>: " + esc(t.colour) + (t.strokeColour && t.strokeColour !== "none" ? ", outline " + esc(t.strokeColour) : "") + ", " + esc(t.fontStyle) + ", " + esc(t.size) + ", " + words(t.position) + "</li>").join("")
      + m.elements.map((e) => "<li>" + words(e.kind) + ": " + esc(e.what) + ", " + esc(e.position) + (e.pose && e.pose !== "n/a" ? ", pose " + esc(e.pose) : "") + ", " + esc(e.colours) + "</li>").join("")
      + "</ul>";
  }
  if (a.notes) h += '<p class="meta">' + esc(a.notes) + "</p>";
  if (v.differences.length) h += '<p class="meta">Readings differed on: ' + esc(v.differences.join("; ")) + "</p>";
  return h;
}

/** Keeps the popover inside the viewport: below the button, flipped up or left near the edges. */
function placeInfo(btn, pop) {
  const r = btn.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  pop.style.width = Math.max(0, Math.min(380, vw - 16)) + "px";
  pop.style.maxHeight = Math.max(0, Math.min(480, vh - 16)) + "px";
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
  const html = id.startsWith("store:") ? storeHtml(id.slice(6)) : INFO[id] ? infoHtml(INFO[id]) : "";
  if (!html) return;
  clearTimeout(infoHideTimer);
  if (infoBtnOpen && infoBtnOpen !== btn) infoBtnOpen.setAttribute("aria-expanded", "false");
  const pop = document.getElementById("infoPop");
  pop.innerHTML = html;
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

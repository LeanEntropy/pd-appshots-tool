/**
 * The (i) button on every analysed image. Hover or keyboard focus shows the image's analysis
 * (both layers) in a popover; click or Enter pins it; Escape or a click outside closes it.
 */
export const INFO_SCRIPT = `
let INFO = DATA.info || {};
let infoBtnOpen = null;
let infoPinned = false;
let infoHideTimer = null;

function infoBtn(id) {
  return id && INFO[id] ? '<button type="button" class="info' + (INFO[id].final ? "" : " bad") + '" data-info="' + esc(id) + '" aria-label="Show analysis" aria-expanded="false" aria-controls="infoPop">i</button>' : "";
}

function swatches(cs) {
  return (cs || []).map((c) => '<span class="sw" style="background:' + (/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : "transparent") + '"></span>' + esc(c.name)).join(" ");
}

function words(s) { return esc(String(s).replace(/_/g, " ")); }

function infoHtml(v) {
  let h = "<h4>" + (v.final ? esc(v.screen) : "No usable analysis") + '</h4><p class="meta">Status: ' + esc(v.status) + (v.models.length ? " &middot; " + esc(v.models.join(", ")) : "") + "</p>";
  h += '<p class="meta"><strong>' + esc(v.game) + " #" + v.position + "</strong> &middot; " + esc(v.filename) + "<br>"
    + (v.file ? '<a href="../' + esc(v.file) + '" target="_blank" rel="noopener">Open image</a>' : "")
    + (v.sourceUrl && /^https:\\/\\/play-lh\\.googleusercontent\\.com\\//.test(v.sourceUrl) ? ' &middot; <a href="' + esc(v.sourceUrl) + '" target="_blank" rel="noopener noreferrer">On Google Play</a>' : "") + "</p>";
  if (v.appearances && v.appearances.length > 1) h += '<p class="meta">Appears ' + v.appearances.length + " times: " + esc(v.appearances.join(", ")) + "</p>";
  if (v.mappedFrom) h += '<p class="meta">Screen type mapped by rule from ' + esc(v.mappedFrom) + " (no model call).</p>";
  if (v.problems.length) h += '<p class="warn">' + esc(v.problems.join("; ")) + "</p>";
  const a = v.final;
  if (a) {
    const s = a.screenshot, m = a.marketingLayer;
    h += "<h5>Screenshot</h5><dl>"
      + "<dt>Orientation</dt><dd>" + words(s.orientation) + ", " + words(s.framing) + ", " + s.captureAreaPercent + "% of the image</dd>"
      + "<dt>Shows</dt><dd>" + esc(s.description) + "</dd>"
      + "<dt>Action</dt><dd>" + esc(s.action) + "</dd>"
      + "<dt>Atmosphere</dt><dd>" + esc(s.atmosphere) + "</dd>"
      + "<dt>Colours</dt><dd>" + swatches(s.mainColours) + "</dd></dl>";
    h += "<h5>Marketing layer</h5>";
    if (!m.present) h += "<p>No marketing layer.</p>";
    else {
      h += "<dl><dt>Covers</dt><dd>" + m.coveragePercent + "% of the image, " + words(m.relationToScreen) + " the screen</dd>"
        + "<dt>Colours</dt><dd>" + swatches(m.mainColours) + "</dd></dl><ul>"
        + m.backgroundMasks.map((b) => "<li>Mask: " + words(b.shape) + ", " + swatches([{ name: b.colourName, hex: b.colourHex }]) + ", " + words(b.location) + "</li>").join("")
        + m.texts.map((t) => "<li>Text <strong>" + esc(t.text) + "</strong>: " + esc(t.colour) + ", outline " + esc(t.strokeColour) + ", " + esc(t.fontStyle) + ", " + esc(t.size) + ", " + words(t.position) + "</li>").join("")
        + m.elements.map((e) => "<li>" + words(e.kind) + ": " + esc(e.what) + ", " + esc(e.position) + ", pose " + esc(e.pose) + ", " + esc(e.colours) + "</li>").join("")
        + "</ul>";
    }
    if (a.notes) h += '<p class="meta">' + esc(a.notes) + "</p>";
  }
  if (v.differences.length) h += '<p class="meta">Readings differed on: ' + esc(v.differences.join("; ")) + "</p>";
  return h;
}

function showInfo(btn) {
  const v = INFO[btn.dataset.info];
  if (!v) return;
  clearTimeout(infoHideTimer);
  if (infoBtnOpen && infoBtnOpen !== btn) infoBtnOpen.setAttribute("aria-expanded", "false");
  const pop = document.getElementById("infoPop");
  pop.innerHTML = infoHtml(v);
  pop.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = Math.min(380, window.innerWidth - 16);
  pop.style.width = w + "px";
  pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + window.innerWidth - w - 8)) + "px";
  pop.style.top = window.scrollY + r.bottom + 6 + "px";
  btn.setAttribute("aria-expanded", "true");
  infoBtnOpen = btn;
}

function hideInfo(returnFocus) {
  const pop = document.getElementById("infoPop");
  pop.hidden = true;
  infoPinned = false;
  if (infoBtnOpen) { infoBtnOpen.setAttribute("aria-expanded", "false"); if (returnFocus) infoBtnOpen.focus(); }
  infoBtnOpen = null;
}

const infoTarget = (e) => e.target.closest && e.target.closest("button.info");
document.addEventListener("mouseover", (e) => {
  const b = infoTarget(e);
  if (b && !infoPinned) showInfo(b);
  else if (e.target.closest && e.target.closest("#infoPop")) clearTimeout(infoHideTimer);
});
document.addEventListener("mouseout", (e) => {
  if (infoPinned || !(infoTarget(e) || (e.target.closest && e.target.closest("#infoPop")))) return;
  infoHideTimer = setTimeout(() => hideInfo(false), 250);
});
document.addEventListener("focusin", (e) => { const b = infoTarget(e); if (b && !infoPinned) showInfo(b); });
document.addEventListener("focusout", (e) => { if (infoTarget(e) && !infoPinned) infoHideTimer = setTimeout(() => hideInfo(false), 150); });
document.addEventListener("click", (e) => {
  const b = infoTarget(e);
  if (b) { e.preventDefault(); if (infoPinned && infoBtnOpen === b) hideInfo(false); else { showInfo(b); infoPinned = true; } return; }
  if (infoPinned && !(e.target.closest && e.target.closest("#infoPop"))) hideInfo(false);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && infoBtnOpen) hideInfo(true); });
`;

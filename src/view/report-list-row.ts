/**
 * The folded report row of the Report tab (report-list.ts): a short title (more than three
 * countries show the first three and "+N"; the full name on hover and when open), the date, the
 * "same setup as" hint, and the in-page Delete confirmation (no browser dialog) that says plainly
 * what is kept: paid image analyses stay in the shared library and are reused for free.
 */
export const REPORT_ROW_SCRIPT = `
// "Japan, South Korea, Taiwan +2 vs 8 competitors" for a name that starts with its country list.
function shortTitle(r) {
  const names = r.countryNames || [];
  const lead = names.join(", ");
  const name = String(r.name || "");
  if (names.length <= 3 || !lead || !name.startsWith(lead)) return name;
  return names.slice(0, 3).join(", ") + " +" + (names.length - 3) + name.slice(lead.length);
}

// The date at the right of a folded row: "29 Sep 2026" (the time is in the tooltip).
function rowDate(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function rowTitleHtml(r) {
  const short = shortTitle(r);
  if (short === r.name) return '<span class="rc-name">' + flagText(r.name) + "</span>";
  return '<span class="rc-name" title="' + esc(r.name) + '"><span class="rc-short">' + flagText(short) + '</span><span class="rc-full">' + flagText(r.name) + "</span></span>";
}

// Asked in the card itself: what goes and what stays, then Delete or Cancel.
function deleteConfirmHtml(r, id) {
  const n = r.versions.length;
  const what = n === 1 ? "this report and its version, with its written parts," : n ? "this report and its " + n + " versions, with their written parts," : "this draft (its saved choices; it has no written report yet)";
  return '<div class="rc-del" id="rd-' + id + '" hidden role="group" aria-label="Confirm delete"><p><strong>Delete \\u201c' + esc(r.name) + '\\u201d?</strong> Only ' + what + " will be removed. "
    + "Image analyses already paid for stay in the shared library and are reused for free by later reports.</p>"
    + '<button type="button" class="rc-delyes danger" data-rid="' + id + '" data-act-key="rc-delyes-' + id + '">Delete</button> '
    + '<button type="button" class="rc-delno" data-rid="' + id + '">Cancel</button></div>';
}

function showDeleteConfirm(rid, on) {
  const box = document.getElementById("rd-" + rid);
  if (!box) return;
  box.hidden = !on;
  const btn = box.querySelector(on ? "button.rc-delno" : "button");
  if (on && btn && btn.focus) btn.focus();
}
`;

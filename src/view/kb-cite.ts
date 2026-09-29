/**
 * Citation marks of the knowledge base in the report page (user rule, 2026-09-29): a marker such
 * as [1] whose tooltip holds ONLY the source link(s), each opening in a new tab. No trust level,
 * dates, publishers or other data. Items carry kbCites / kbNotes only when the knowledge base was
 * on for them; otherwise these functions add nothing. Needs the page's esc().
 */
export const KB_CITE_SCRIPT = `
function kbSafeLink(u) {
  try { const x = new URL(String(u)); return x.protocol === "https:" || x.protocol === "http:" ? x.href : ""; } catch (e) { return ""; }
}
function kbCiteStyle() {
  try {
    if (typeof document === "undefined" || !document.head || document.getElementById("kb-cite-css")) return;
    const s = document.createElement("style");
    s.id = "kb-cite-css";
    s.textContent = ".kb-cite{position:relative;cursor:help;margin-left:2px;color:var(--accent,#0b6e6e)}.kb-cite-tip{display:none;position:absolute;left:0;top:1.4em;z-index:20;min-width:16em;max-width:28em;padding:6px 8px;background:#fff;border:1px solid #ccd;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);font-size:12px;line-height:1.5}.kb-cite-tip a{display:block;word-break:break-all}.kb-cite:hover .kb-cite-tip,.kb-cite:focus-within .kb-cite-tip{display:block}.kb-note{display:block;margin-top:4px}";
    document.head.appendChild(s);
  } catch (e) {}
}
function kbCiteMark(c) {
  const links = (c.links || []).map(kbSafeLink).filter(Boolean)
    .map((u) => '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u) + "</a>").join("");
  return links ? '<sup class="kb-cite" tabindex="0">[' + esc(c.n) + ']<span class="kb-cite-tip" role="tooltip">' + links + "</span></sup>" : "";
}
// The marks of one item ("position:2", "test:1" ...) of an AI answer, and its plain notes.
function kbMarks(o, item) {
  const cs = (o && o.kbCites && o.kbCites[item]) || [];
  const notes = (o && o.kbNotes && o.kbNotes[item]) || [];
  if (!cs.length && !notes.length) return "";
  kbCiteStyle();
  const seen = new Set();
  return cs.filter((c) => !seen.has(c.n) && seen.add(c.n)).map(kbCiteMark).join("")
    + notes.map((n) => '<span class="kb-note">' + esc(n) + "</span>").join("");
}
`;

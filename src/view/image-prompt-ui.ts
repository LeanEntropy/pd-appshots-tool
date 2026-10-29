import { escHtml as esc } from "./shell.ts";

/**
 * "Write an image prompt" on the report's recommendations, the country decks and the image page
 * (user, 2026-10-30). A button fetches the prompts the server built by code (free, instant) and
 * shows one in a read-only text box with "Copy to clipboard". The prompt text only ever goes in
 * through the textarea's value, never as HTML. Buttons in one .ip group share one text box.
 */
export const IMAGE_PROMPT_CSS = `
.ip { margin: 10px 0; } .ip-btns { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.ip-btn[aria-pressed="true"] { outline: 2px solid var(--accent); outline-offset: 1px; }
.ip-out { margin-top: 8px; } .ip-out[hidden] { display: none; }
.ip-text { display: block; width: 100%; box-sizing: border-box; min-height: 14em; padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--text); font: 12px/1.45 ui-monospace, Consolas, monospace; resize: vertical; }
.ip-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
@media print { .ip { display: none; } }
`;

/** Server-built pages: the same button group as the page script's ipButtons (escaped here). */
export function ipButtonsHtml(rel: string, items: readonly [string, string][]): string {
  const btns = items
    .map(
      ([pos, label]) =>
        `<button type="button" class="ip-btn" data-ip="${esc(rel)}" data-ip-pos="${esc(pos)}" aria-pressed="false">${esc(label)}</button>`,
    )
    .join("");
  return `<div class="ip"><div class="ip-btns">${btns}</div><span class="act-msg" hidden></span></div>`;
}

export const IMAGE_PROMPT_SCRIPT = `
const ipCache = new Map();
function ipBase() { return typeof API !== "undefined" ? API : (typeof APP !== "undefined" && APP.apiBase) || "/api"; }
// One group of prompt buttons: items are [position or "all", label]; nothing without a link.
function ipButtons(rel, items) {
  if (!rel) return "";
  return '<div class="ip"><div class="ip-btns">' + items.map((x) => '<button type="button" class="ip-btn" data-ip="' + actEsc(rel) + '" data-ip-pos="' + actEsc(x[0]) + '" aria-pressed="false">' + actEsc(x[1]) + "</button>").join("") + '</div><span class="act-msg" hidden></span></div>';
}
function ipLoad(rel) {
  if (!ipCache.has(rel)) ipCache.set(rel, getJson(ipBase() + "/" + rel).catch((e) => { ipCache.delete(rel); throw e; }));
  return ipCache.get(rel);
}
function ipPick(r, pos) {
  if (pos === "all") return r.all;
  const p = (r.prompts || []).find((x) => String(x.position) === String(pos));
  if (!p) throw new Error("This report has no prompt for position " + pos + ".");
  return p.text;
}
// The text box under a group, made once with DOM calls; the prompt goes in as .value only.
function ipShow(box, text) {
  let out = box.querySelector(".ip-out");
  if (!out) {
    out = document.createElement("div"); out.className = "ip-out";
    const ta = document.createElement("textarea");
    ta.className = "ip-text"; ta.readOnly = true; ta.rows = 16; ta.spellcheck = false;
    ta.setAttribute("aria-label", "Image prompt");
    const bar = document.createElement("div"); bar.className = "ip-bar";
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "ip-copy primary"; copy.textContent = "Copy to clipboard";
    const msg = document.createElement("span"); msg.className = "act-msg"; msg.hidden = true;
    const note = document.createElement("span"); note.className = "meta"; note.textContent = "Made by code from this report: free, no AI call.";
    bar.append(copy, msg, note); out.append(ta, bar); box.appendChild(out);
  }
  out.hidden = false;
  out.querySelector("textarea").value = text;
  return out;
}
async function ipCopy(ta) {
  try { await navigator.clipboard.writeText(ta.value); return "Copied"; }
  catch {
    ta.focus(); ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch {}
    return ok ? "Copied" : "Selected: press Ctrl+C to copy";
  }
}
function ipClick(btn) {
  const box = btn.closest(".ip");
  const out = box.querySelector(".ip-out");
  // The shown prompt's button again: hides it.
  if (out && !out.hidden && btn.getAttribute("aria-pressed") === "true") { out.hidden = true; btn.setAttribute("aria-pressed", "false"); return Promise.resolve(); }
  return act(btn, { busy: "Writing the prompt...", status: box.querySelector(":scope > .act-msg"), done: "", run: async () => ipPick(await ipLoad(btn.dataset.ip), btn.dataset.ipPos) }).then((text) => {
    if (typeof text !== "string") return;
    for (const b of box.querySelectorAll(".ip-btn")) b.setAttribute("aria-pressed", String(b === btn));
    const shown = ipShow(box, text);
    // "Copy all prompts" copies at once too (the box stays for a manual copy).
    if (btn.dataset.ipPos === "all") ipCopyClick(shown.querySelector(".ip-copy"));
  });
}
function ipCopyClick(c) {
  const out = c.closest(".ip-out");
  return act(c, { busy: "Copying...", status: out.querySelector(".act-msg"), run: () => ipCopy(out.querySelector("textarea")), done: (m) => m });
}
document.addEventListener("click", (e) => {
  const t = e.target;
  const btn = t && t.closest && t.closest(".ip-btn");
  if (btn) { ipClick(btn); return; }
  const c = t && t.closest && t.closest(".ip-copy");
  if (c) ipCopyClick(c);
});
`;

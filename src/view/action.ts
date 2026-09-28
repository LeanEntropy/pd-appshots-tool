/**
 * One helper for every button or action on the tool's pages (PILLARS: every action gives
 * immediate on-screen feedback). act() puts the button in a busy state at once (disabled,
 * spinner, a plain "what is happening" text), shows progress while it runs, ends with a clear
 * success message or a red error with a readable reason, and ignores double clicks. The busy
 * state survives a re-render of the button (matched by its id or data-act-key). Links styled as
 * buttons show "Opening..." while the next page loads.
 */
export const ACTION_CSS = `
.act-spin { display: inline-block; width: 11px; height: 11px; margin-right: 6px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: act-spin 1s linear infinite; vertical-align: -1px; }
@keyframes act-spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { .act-spin { animation: none; } }
[aria-busy="true"] { cursor: progress; opacity: .85; }
.act-msg { margin: 6px 0; font-weight: 600; } .act-msg[hidden] { display: none; }
.act-msg.busy { color: var(--text); } .act-msg.ok { color: var(--ok); } .act-msg.bad { color: var(--bad); }
.act-msg progress { display: block; width: 100%; max-width: 360px; height: 10px; margin-top: 4px; accent-color: var(--accent); }
#act-toasts { position: fixed; right: 16px; bottom: 16px; z-index: 1000; display: flex; flex-direction: column; gap: 8px; max-width: min(440px, calc(100vw - 32px)); }
.act-toast { padding: 10px 14px; border-radius: 10px; background: var(--card); color: var(--text); border: 1px solid var(--line); border-left: 6px solid var(--ok); box-shadow: 0 4px 16px rgba(0,0,0,.2); font-weight: 600; display: flex; gap: 10px; align-items: flex-start; }
.act-toast.bad { border-left-color: var(--bad); color: var(--bad); } .act-toast span { flex: 1; overflow-wrap: anywhere; }
.act-toast button { margin: 0; padding: 0 6px; background: none; border: none; color: inherit; font: inherit; cursor: pointer; }
.act-flash { outline: 4px solid var(--ok); outline-offset: 2px; transition: outline-color 2s; }
`;

export const ACTION_SCRIPT = `
const ACT_TOKEN = (document.querySelector('meta[name="ssr-token"]') || {}).content || "";
const ACT_OFFLINE = "The tool did not answer. Is npm start still running in its terminal?";
const actEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ACT_SPIN = '<span class="act-spin" aria-hidden="true"></span>';
// Running actions by key: { text } of the busy button, re-applied if the button is re-rendered.
const actRunning = new Map();

function actReason(e) { return (e && e.message) || ACT_OFFLINE; }

// A readable reason from the server's { problems } or the status; a network failure says so.
async function actRead(res) {
  let body = {};
  try { body = await res.json(); } catch {}
  if (!res.ok) throw new Error(((body && body.problems) || []).join(" ") || "The tool answered with an error (" + res.status + ").");
  return body;
}
async function send(url, body) {
  let res;
  // keepalive: a save still reaches the tool when the page is closed right after it.
  try { res = await fetch(url, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-SSR-Token": ACT_TOKEN }, body: JSON.stringify(body || {}) }); }
  catch { throw new Error(ACT_OFFLINE); }
  return actRead(res);
}
async function getJson(url) {
  let res;
  try { res = await fetch(url); } catch { throw new Error(ACT_OFFLINE); }
  return actRead(res);
}

function toast(text, kind) {
  let box = document.getElementById("act-toasts");
  if (!box) { box = document.createElement("div"); box.id = "act-toasts"; document.body.appendChild(box); }
  const t = document.createElement("div");
  t.className = "act-toast" + (kind === "bad" ? " bad" : "");
  t.setAttribute("role", kind === "bad" ? "alert" : "status");
  t.innerHTML = "<span>" + actEsc(text) + '</span><button type="button" aria-label="Close this message">&times;</button>';
  t.querySelector("button").addEventListener("click", () => t.remove());
  box.appendChild(t);
  if (kind !== "bad") setTimeout(() => t.remove(), 8000);
  return t;
}

// The status line under an action: busy (spinner), ok (green) or bad (red), with optional progress.
function actLine(el, kind, text, done, total) {
  if (!el) return;
  el.hidden = false;
  el.className = "act-msg " + kind;
  el.setAttribute("role", kind === "bad" ? "alert" : "status");
  el.innerHTML = (kind === "busy" ? ACT_SPIN : "") + actEsc(text) + (total ? '<progress max="' + total + '" value="' + (done || 0) + '"></progress>' : "");
}

function actBusy(btn, text) {
  if (!btn || (btn.getAttribute("aria-busy") === "true" && btn.dataset.actText === text)) return;
  if (btn.dataset.actLabel === undefined) btn.dataset.actLabel = btn.innerHTML;
  btn.dataset.actText = text;
  btn.disabled = true;
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = ACT_SPIN + actEsc(text);
}
function actIdle(btn) {
  if (!btn || btn.dataset.actLabel === undefined) return;
  btn.innerHTML = btn.dataset.actLabel;
  delete btn.dataset.actLabel; delete btn.dataset.actText;
  btn.disabled = false;
  btn.removeAttribute("aria-busy");
}
function actFind(key) {
  return document.querySelector('[data-act-key="' + CSS.escape(key) + '"]') || document.getElementById(key);
}

/**
 * Runs one action with feedback. o: { key?, busy, status? (element or id), run(progress),
 * done? (text or fn(result) -> text; "" for no message), fail? (fn(error)), keep? (leave the
 * button disabled after success) }. progress(text, done?, total?) updates the status line, or the
 * button when there is no status line. Returns the result, or undefined when it failed or was
 * already running.
 */
async function act(btn, o) {
  const key = o.key || (btn && (btn.dataset.actKey || btn.id)) || o.busy;
  if (actRunning.has(key)) return undefined;
  // Looked up each time: the status line may be re-rendered while the action runs.
  const lineOf = () => (typeof o.status === "string" ? document.getElementById(o.status) : o.status || null);
  const cur = { text: o.busy, lineOf, line: [o.busy] };
  actRunning.set(key, cur);
  actBusy(btn, o.busy);
  actLine(lineOf(), "busy", o.busy);
  const progress = (text, done, total) => {
    const t = text + (total ? ": " + Number(done || 0).toLocaleString() + " / " + Number(total).toLocaleString() : "");
    cur.line = [t, done, total];
    if (lineOf()) actLine(lineOf(), "busy", t, done, total);
    else { cur.text = t; actBusy(actFind(key) || btn, t); }
  };
  let result;
  try {
    result = await o.run(progress);
  } catch (e) {
    actRunning.delete(key);
    const target = actFind(key) || btn;
    actIdle(target);
    const reason = actReason(e);
    actLine(lineOf(), "bad", reason);
    toast(reason, "bad");
    if (o.fail) o.fail(e);
    return undefined;
  }
  actRunning.delete(key);
  const target = actFind(key) || btn;
  if (!o.keep) actIdle(target);
  const msg = typeof o.done === "function" ? o.done(result) : o.done;
  const line = lineOf();
  if (msg) { actLine(line, "ok", msg); toast(msg, "ok"); }
  else if (line && line.classList.contains("busy")) line.hidden = true;
  return result;
}

// A re-rendered button (or status line) of a running action is shown busy again at once.
new MutationObserver(() => {
  for (const [key, cur] of actRunning) {
    const el = actFind(key); if (el && el.getAttribute("aria-busy") !== "true") actBusy(el, cur.text);
    const line = cur.lineOf(); if (line && !line.classList.contains("busy")) actLine(line, "busy", cur.line[0], cur.line[1], cur.line[2]);
  }
}).observe(document.documentElement, { childList: true, subtree: true });

// Links styled as buttons: "Opening..." while the next page loads.
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a.btn, a.btn-new");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank") return;
  // A second click while the next page loads does nothing.
  if (a.getAttribute("aria-busy") === "true") { e.preventDefault(); return; }
  const href = a.getAttribute("href") || "";
  if (!href || href.startsWith("#")) return;
  if (a.dataset.actLabel === undefined) a.dataset.actLabel = a.innerHTML;
  a.setAttribute("aria-busy", "true");
  a.innerHTML = ACT_SPIN + actEsc(a.dataset.busy || "Opening...");
});
// Back/forward cache: a page shown again has its links idle.
window.addEventListener("pageshow", () => { document.querySelectorAll("a[aria-busy]").forEach((a) => { a.innerHTML = a.dataset.actLabel || a.innerHTML; delete a.dataset.actLabel; a.removeAttribute("aria-busy"); }); });
`;

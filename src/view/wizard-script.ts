/**
 * New-project wizard, shared part: state, step navigation and autosave. Every change is saved
 * through one queue (in order, never two at once) and the save line says what happened. The
 * step scripts (wizard-game, -competitors, -countries, -review) draw one step each.
 */
import { ACTION_SCRIPT } from "./action.ts";

export const WIZARD_CORE = `${ACTION_SCRIPT}
const esc = actEsc;
const STEP_NAMES = ["Your game", "Competitors", "Countries", "Charts", "Review and create"];
const TIERS = [["direct", "Direct competitor"], ["same_audience", "Same audience"], ["reference", "Big reference game"]];
// id: the project (null until step 1 is confirmed); s: its saved settings; cat: countries.
const W = { id: null, s: null, step: 1, cat: null, warnings: [] };
const $ = (id) => document.getElementById(id);
const api = (p) => "/p/" + encodeURIComponent(W.id) + "/api" + p;
const DRAW = {};

// A store icon: the saved copy for the project's games, Google's picture for search results.
function icon(src, name, small) {
  const cls = "ico" + (small ? " sm" : "");
  const letter = '<span class="' + cls + '" aria-hidden="true">' + esc((name || "?").slice(0, 1).toUpperCase()) + "</span>";
  if (!src) return letter;
  return '<img class="' + cls + '" src="' + esc(src) + '" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.outerHTML=this.dataset.fallback" data-fallback="' + esc(letter) + '">';
}
function googleIcon(url) {
  return /^https:\\/\\/[a-z0-9-]+\\.(googleusercontent|ggpht)\\.com\\//.test(url || "") ? url + "=s96" : "";
}
function savedIcon(file) {
  return file && W.id ? "/p/" + encodeURIComponent(W.id) + "/icons/" + encodeURIComponent(file) : "";
}
function stars(score) { return typeof score === "number" && score > 0 ? score.toFixed(1) + " stars" : "no rating yet"; }
function category(genreId) {
  const g = String(genreId || "").replace(/^GAME_?/, "").toLowerCase().replace(/_/g, " ");
  return g ? g.charAt(0).toUpperCase() + g.slice(1) : "Games";
}

// Saves go one after another; each patch is built when its turn comes, from the latest settings.
let saveChain = Promise.resolve();
function save(build) {
  const run = saveChain.then(async () => {
    const r = await send(api("/settings"), typeof build === "function" ? build() : build);
    W.s = r.settings;
    W.warnings = r.warnings || [];
    return r;
  });
  saveChain = run.catch(() => {});
  return run;
}

// Checkboxes, menus and fields: saved at once, with "Saving..." then "All changes saved".
let autoRuns = 0;
function autosave(build, after) {
  autoRuns++;
  actLine($("saveLine"), "busy", "Saving...");
  return save(build).then(
    (r) => { if (--autoRuns === 0) actLine($("saveLine"), "ok", "All changes saved."); if (after) after(r); return r; },
    (e) => { autoRuns--; const why = "Not saved: " + actReason(e); actLine($("saveLine"), "bad", why); toast(why, "bad"); draw(); },
  );
}

// Closing or leaving the page while a change is still being saved asks first.
window.addEventListener("beforeunload", (e) => {
  const name = $("pname");
  const nameUnsaved = W.id && W.s && name && name.value.trim() && name.value.trim() !== W.s.name;
  if (autoRuns > 0 || nameUnsaved) { e.preventDefault(); e.returnValue = ""; }
});

function drawSteps() {
  $("wsteps").innerHTML = STEP_NAMES.map((n, i) => {
    const k = i + 1;
    const locked = !W.id && k > 1;
    return '<li><button type="button" data-go="' + k + '"' + (k === W.step ? ' aria-current="step"' : "") + (k < W.step ? ' class="done"' : "") + (locked ? " disabled" : "") + ">" + esc(n) + "</button></li>";
  }).join("");
}

function draw() {
  drawSteps();
  DRAW[W.step]();
}

function nav(back, next, nextLabel) {
  return '<div class="nav">' + (back ? '<button type="button" class="btn" data-go="' + back + '">Back</button>' : "<span></span>")
    + (next ? '<button type="button" class="btn primary" data-go="' + next + '">' + esc(nextLabel || "Next: " + STEP_NAMES[next - 1]) + "</button>" : "") + "</div>";
}

// Moving between steps is instant; the step to reopen on is saved in the background.
function go(step) {
  if (!W.id && step > 1) return;
  W.step = step;
  draw();
  $("wsteps").scrollIntoView({ block: "nearest", behavior: "smooth" });
  const first = $("step").querySelector("input, select, button");
  if (first) first.focus({ preventScroll: true });
  if (W.id && W.s && W.s.setupStep !== step) autosave({ setupStep: step });
}

document.addEventListener("click", (e) => {
  const b = e.target.closest ? e.target.closest("[data-go]") : null;
  if (b && !b.disabled) go(Number(b.dataset.go));
});

async function wizardStart() {
  const m = /^\\/p\\/([a-z0-9-]+)\\/setup/.exec(location.pathname);
  try {
    W.cat = await getJson("/api/countries");
    if (m) {
      W.id = m[1];
      const r = await getJson(api("/settings"));
      W.s = r.settings;
      W.warnings = r.warnings || [];
      if (!W.s || (W.s.setupStep === undefined && W.s.competitors.length)) { location.href = "/p/" + encodeURIComponent(W.id) + "/"; return; }
      W.step = W.s.setupStep || 2;
    }
    draw();
  } catch (e) {
    $("step").innerHTML = '<p class="act-msg bad" role="alert">The page could not load: ' + esc(actReason(e)) + '</p><p><a class="btn" href="">Try again</a></p>';
  }
}
`;

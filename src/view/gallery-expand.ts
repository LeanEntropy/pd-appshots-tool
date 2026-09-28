/**
 * The expansion question after the core check: more English competitors and/or other countries,
 * each with its image count. The choice is saved automatically; running an expansion is the
 * next stage, so the page says it is waiting for that step.
 */
export const EXPAND_SCRIPT = `
let expansion = null;

function expansionHtml(o) {
  const saved = o.saved || { competitors: [], countries: [] };
  const box = (name, value, text, on) => '<label><input type="checkbox" name="' + name + '" value="' + esc(value) + '"' + (on ? " checked" : "") + "> " + text + "</label>";
  const comps = o.competitors.map((c) => box("xcomp", c.appId, esc(c.name) + ' <span class="meta">(' + c.images + " English images)</span>", saved.competitors.includes(c.appId))).join("")
    || '<p class="meta">Every competitor with an English deck is in the core check already.</p>';
  const countries = o.countries.map((c) => box("xcountry", c.gl, esc(c.label) + ' <span class="meta">(' + c.images + " images from ours and the core competitors)</span>", saved.countries.includes(c.gl))).join("")
    || '<p class="meta">No other countries in this project.</p>';
  const note = saved.savedAt
    ? '<p class="ok"><strong>Your choice is saved.</strong> It is waiting for the expansion step, which comes in the next update of the tool. Nothing runs and nothing is spent until then.</p>'
    : '<p class="meta">Tick what you want next. Your choice saves automatically. Nothing runs until the expansion step, and it will show its numbers for approval first.</p>';
  return '<section class="expand" aria-labelledby="expandTitle"><h3 id="expandTitle">How do you want to expand?</h3>'
    + "<fieldset><legend>More English competitors</legend>" + comps + "</fieldset>"
    + "<fieldset><legend>Other countries</legend>" + countries + "</fieldset>"
    + '<div id="expandNote" role="status" aria-live="polite">' + note + "</div></section>";
}

async function loadExpansion() {
  const el = document.getElementById("expansion");
  if (!el || !location.protocol.startsWith("http")) return;
  try {
    const st = await (await fetch(API + "/state")).json();
    if (st.stage !== "recommendations" && st.stage !== "expand") { el.innerHTML = ""; return; }
    expansion = await (await fetch(API + "/expansion")).json();
    el.innerHTML = expansionHtml(expansion);
  } catch {}
}

async function saveExpansionChoice() {
  const pick = (n) => [...document.querySelectorAll('input[name="' + n + '"]:checked')].map((x) => x.value);
  const note = document.getElementById("expandNote");
  if (note) note.innerHTML = '<p class="meta">Saving...</p>';
  const r = await apiPost(API + "/expansion", { competitors: pick("xcomp"), countries: pick("xcountry") });
  if (!r.ok) { if (note) note.innerHTML = '<p class="warn">' + esc((r.body.problems || ["Not saved."]).join(" ")) + "</p>"; return; }
  expansion = r.body;
  document.getElementById("expansion").innerHTML = expansionHtml(expansion);
}

document.addEventListener("change", (e) => { if (e.target.name === "xcomp" || e.target.name === "xcountry") saveExpansionChoice(); });
window.addEventListener("hashchange", () => { if (pageFromHash(location.hash) === "report") loadExpansion(); });
if (pageFromHash(location.hash) === "report") loadExpansion();
`;

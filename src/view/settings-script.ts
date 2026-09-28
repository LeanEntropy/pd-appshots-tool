/**
 * Browser script of the Settings page. Draws every group from the server's values, saves each
 * change at once through act() (busy line, then "saved" or the reason in red next to the field),
 * asks first when the server answers with consequences, and offers "Back to default" on every
 * changed value. A refused or cancelled change puts the control back to the saved value, and a
 * change made while the same field is still saving is undone (the save in progress wins).
 */
export const SETTINGS_SCRIPT = `
const SET = JSON.parse(document.getElementById("settingsData").textContent);
let VIEW = SET.view;
const SET_API = "/p/" + encodeURIComponent(SET.id) + "/api/analysis-settings";
const fieldOf = (id) => VIEW.fields.find((f) => f.id === id);
const ctlId = (id) => "set-" + id.replace(/[^A-Za-z0-9_-]/g, "_");

function shown(f, v) {
  if (f.kind === "switch") return v ? "On" : "Off";
  if (f.kind === "percent") return Math.round(Number(v) * 1000) / 10 + "%";
  if (f.kind === "usd") return "$" + v;
  if (f.choices) { const c = f.choices.find((x) => x.value === v); return c ? c.label : String(v); }
  return String(v);
}

function control(f) {
  const id = ctlId(f.id);
  const common = ' id="' + id + '" data-field="' + actEsc(f.id) + '"';
  if (f.kind === "switch") return '<input type="checkbox" role="switch"' + common + (f.value ? " checked" : "") + ">";
  if (f.choices) return "<select" + common + ">" + f.choices.map((c) => '<option value="' + actEsc(c.value) + '"' + (c.value === f.value ? " selected" : "") + ">" + actEsc(c.label) + "</option>").join("") + "</select>";
  const v = f.kind === "percent" ? Math.round(Number(f.value) * 1000) / 10 : f.value;
  return (f.kind === "usd" ? "$ " : "") + '<input type="number" inputmode="decimal" step="any"' + common + ' value="' + actEsc(v) + '">' + (f.kind === "percent" ? " %" : "");
}

function row(f) {
  const id = ctlId(f.id);
  return '<div class="row"><label for="' + id + '">' + actEsc(f.label) + "</label>"
    + '<div class="ctl">' + control(f)
    + (f.changed ? ' <span class="changed">Changed</span> <button type="button" class="linkbtn" data-reset="' + actEsc(f.id) + '">Back to default (' + actEsc(shown(f, f.defaultValue)) + ")</button>" : "") + "</div>"
    + (f.help ? '<p class="help meta">' + actEsc(f.help) + "</p>" : "")
    + '<p class="act-msg" id="st-' + id + '" hidden></p></div>';
}

function renderSettings() {
  const box = document.getElementById("settings");
  if (!box || !VIEW) return;
  box.innerHTML = VIEW.groups.map((g) => {
    let inner = "";
    if (g.id === "steps") {
      inner = VIEW.steps.map((s) => {
        const fs = VIEW.fields.filter((f) => f.group === "steps" && f.step === s.step);
        return '<div class="step"><h3>' + actEsc(s.label) + '</h3><p class="meta">Cost: ' + actEsc(s.cost) + "." + (s.note ? " " + actEsc(s.note) : "") + "</p>" + fs.map(row).join("") + "</div>";
      }).join("");
    } else inner = VIEW.fields.filter((f) => f.group === g.id).map(row).join("");
    return '<section class="card grp" aria-labelledby="g-' + g.id + '"><h2 id="g-' + g.id + '">' + actEsc(g.title) + '</h2><p class="meta">' + actEsc(g.help) + "</p>" + inner + "</section>";
  }).join("");
}

// A refused or cancelled change: the control shows the saved value again.
function restore(fid) {
  const f = fieldOf(fid); const el = document.getElementById(ctlId(fid));
  if (!f || !el) return;
  if (f.kind === "switch") el.checked = !!f.value;
  else if (f.kind === "percent") el.value = Math.round(Number(f.value) * 1000) / 10;
  else el.value = f.value;
}

function readValue(el, f) {
  if (f.kind === "switch") return el.checked;
  if (f.choices) return el.value;
  const n = Number(String(el.value).trim().replace(",", "."));
  if (String(el.value).trim() === "" || !Number.isFinite(n)) throw new Error(f.label + ": enter a number.");
  return f.kind === "percent" ? Math.round(n * 10) / 1000 : n;
}

// The consequences of a change with a cost; resolves true when the user says save.
function confirmChange(r) {
  const dlg = document.getElementById("confirmDlg");
  document.getElementById("confirmBody").innerHTML = "<p><strong>" + actEsc(r.field) + "</strong></p><ul>" + r.consequences.map((c) => "<li>" + actEsc(c.text) + "</li>").join("") + "</ul>" + (r.changedMeanwhile ? "<p><strong>These numbers changed since you last saw them.</strong></p>" : "") + "<p>Save this change?</p>";
  return new Promise((resolve) => {
    const yes = document.getElementById("confirmYes"); const no = document.getElementById("confirmNo");
    const end = (ok) => { yes.onclick = null; no.onclick = null; dlg.oncancel = null; if (dlg.open) dlg.close(); resolve(ok); };
    yes.onclick = () => end(true); no.onclick = () => end(false);
    dlg.oncancel = (e) => { e.preventDefault(); end(false); };
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    no.focus();
  });
}

// btn: the "Back to default" button (busy while it runs); a changed control shows its busy state
// on its status line instead (a select or input cannot hold a spinner).
async function saveField(fid, reset, btn) {
  const f = fieldOf(fid);
  if (!f) return;
  if (actRunning.has("save:" + fid)) { restore(fid); return; }
  const el = document.getElementById(ctlId(fid));
  const body = { field: fid };
  if (reset) body.reset = true;
  else {
    try { body.value = readValue(el, f); }
    catch (e) { actLine(document.getElementById("st-" + ctlId(fid)), "bad", e.message); restore(fid); return; }
  }
  await act(btn || null, {
    key: "save:" + fid,
    busy: reset ? "Going back to the default..." : "Saving...",
    status: "st-" + ctlId(fid),
    run: async (progress) => {
      let r = await send(SET_API, body);
      if (r.needsConfirm) {
        progress("Waiting for your answer...");
        if (!(await confirmChange(r))) { restore(fid); return { cancelled: true }; }
        progress("Saving...");
        r = await send(SET_API, Object.assign({}, body, { confirm: r.confirmKey }));
        // The numbers changed meanwhile (another tab): show the new ones and ask again.
        if (r.needsConfirm) {
          if (!(await confirmChange(r))) { restore(fid); return { cancelled: true }; }
          r = await send(SET_API, Object.assign({}, body, { confirm: r.confirmKey }));
          if (r.needsConfirm) throw new Error("The settings keep changing in another tab. Reload this page.");
        }
      }
      VIEW = r.view;
      renderSettings();
      return r;
    },
    done: (r) => (r.cancelled ? "Not changed." : r.message),
    fail: () => restore(fid),
  });
}

document.addEventListener("change", (e) => {
  const el = e.target.closest ? e.target.closest("[data-field]") : null;
  if (el) saveField(el.dataset.field, false);
});
document.addEventListener("click", (e) => {
  const b = e.target.closest ? e.target.closest("button[data-reset]") : null;
  if (b) saveField(b.dataset.reset, true, b);
});
renderSettings();
`;

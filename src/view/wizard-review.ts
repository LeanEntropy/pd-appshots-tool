/**
 * Wizard step 5, review and create: everything chosen on one screen, soft warnings, and
 * "Create project", which makes the project ready and opens its page with the next step.
 */
export const WIZARD_REVIEW = `
DRAW[5] = () => {
  const s = W.s;
  const comps = s.competitors.length
    ? "<ol>" + s.competitors.map((c) => "<li>" + esc(c.name) + ' <span class="meta">(' + esc((TIERS.find((t) => t[0] === c.tier) || ["", c.tier])[1]) + ")</span></li>").join("") + "</ol>"
    : '<span class="warn">None yet. Add at least one in step 2.</span>';
  const charts = s.charts.enabled ? "Top " + s.charts.depth + " grossing in " + category(s.ourApp.genreId) + ", in each country" : "Not included";
  $("step").innerHTML = "<h2>Review and create</h2>"
    + '<dl class="sum"><dt>Project</dt><dd>' + esc(s.name) + "</dd><dt>Your game</dt><dd>" + esc(s.ourApp.name) + ' <span class="meta">(' + esc(s.ourApp.id) + ")</span></dd>"
    + "<dt>Competitors</dt><dd>" + comps + "</dd><dt>Countries</dt><dd>" + s.markets.map((m) => esc(m.label)).join(", ") + "</dd><dt>Charts</dt><dd>" + esc(charts) + "</dd></dl>"
    + W.warnings.map((w) => '<div class="warnbox">' + esc(w) + "</div>").join("")
    + '<p class="meta">Nothing is downloaded yet. After this, the next step is the download preview: it reads the store pages and says how many images it would download, before anything is downloaded.</p>'
    + '<div class="nav"><button type="button" class="btn" data-go="4">Back</button><button type="button" class="btn primary" id="finish"' + (s.competitors.length ? "" : " disabled") + ">Create project</button></div>"
    + '<div id="finishLine" class="act-msg" hidden></div>';
};

document.addEventListener("click", (e) => {
  const t = e.target.closest ? e.target.closest("button") : null;
  if (!t || t.id !== "finish") return;
  act(t, {
    busy: "Creating the project...",
    status: "finishLine",
    keep: true,
    run: async () => {
      await saveChain;
      const r = await send(api("/settings/finish"), {});
      return r;
    },
    done: "Project created. Opening it...",
  }).then((r) => { if (r) location.href = r.href; });
});
`;

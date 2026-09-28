/**
 * Wizard step 1, your game: a Google Play link or package ID (never a name), a confirmation
 * card, the project name, then "This is my game" creates the project. Once created, the game is
 * fixed (a new project is needed for another game); the name stays editable.
 */
export const WIZARD_GAME = `
let found = null;

function gameCard(a, fixed) {
  const line = [a.developer, category(a.genreId), a.installs ? a.installs + " downloads" : "", fixed ? "" : stars(a.score)].filter(Boolean).map(esc).join(" &middot; ");
  return '<div class="appcard' + (fixed ? " fixed" : "") + '">' + icon(fixed ? savedIcon(a.iconFile) : googleIcon(a.icon), a.title || a.name) + '<div class="who"><strong>' + esc(a.title || a.name) + '</strong><div class="meta">' + line + '</div><div class="meta">' + esc(a.appId || a.id) + "</div></div></div>";
}

DRAW[1] = () => {
  if (W.id && W.s) {
    const g = W.s.ourApp;
    $("step").innerHTML = '<h2>Your game</h2>' + gameCard({ ...g, installs: "" }, true)
      + '<p class="meta">Your game is fixed for this project. To work on another game, start a new project from the home page.</p>'
      + '<p><label for="pname"><strong>Project name</strong></label></p><div class="row"><input type="text" id="pname" maxlength="100" value="' + esc(W.s.name) + '"></div>'
      + nav(0, 2);
    return;
  }
  $("step").innerHTML = '<h2>Your game</h2><p class="lead"><label for="gameq">Paste your game\\'s Google Play link or package ID</label></p>'
    + '<div class="row"><input type="text" id="gameq" placeholder="https://play.google.com/store/apps/details?id=..." autocomplete="off"><button type="button" class="btn primary" id="lookup">Look up</button></div>'
    + '<p class="meta">Open your game on Google Play and copy the address, for example <code>https://play.google.com/store/apps/details?id=com.example.game</code>. A name is not enough here, so the tool cannot pick the wrong game.</p>'
    + '<div id="lookLine" class="act-msg" hidden></div><div id="found"></div>';
  if (found) showFound();
};

function showFound() {
  const a = found;
  $("found").innerHTML = gameCard(a, false)
    + a.warnings.map((w) => '<div class="warnbox">' + esc(w) + "</div>").join("")
    + '<p><label for="pname"><strong>Project name</strong></label></p><div class="row"><input type="text" id="pname" maxlength="100" value="' + esc(a.title) + '"></div>'
    + '<div class="nav"><span class="meta">Not it? Paste another link above.</span><button type="button" class="btn primary" id="confirmGame">This is my game: create the project</button></div>'
    + '<div id="createLine" class="act-msg" hidden></div>';
}

function lookup(btn) {
  const q = $("gameq").value.trim();
  return act(btn, {
    key: "lookup",
    busy: "Looking it up on Google Play...",
    status: "lookLine",
    run: async () => {
      found = null;
      $("found").innerHTML = "";
      const r = await getJson("/api/play/lookup?q=" + encodeURIComponent(q));
      found = r.app;
      showFound();
      return r.app;
    },
    done: (a) => "Found " + a.title + ". Check it is your game, then confirm.",
  });
}

function createProject(btn) {
  const name = ($("pname").value || "").trim();
  return act(btn, {
    key: "createProject",
    busy: "Creating the project...",
    status: "createLine",
    keep: true,
    run: async () => {
      if (!name) throw new Error("Give the project a name.");
      const r = await send("/api/projects", { appId: found.appId, name });
      W.id = r.id;
      W.s = r.settings;
      history.replaceState(null, "", "/p/" + encodeURIComponent(r.id) + "/setup");
      document.title = r.settings.name;
      return r;
    },
    done: (r) => "Project " + r.settings.name + " created and saved. You can close the page at any time and continue later.",
  }).then((r) => { if (r) go(2); });
}

document.addEventListener("click", (e) => {
  const t = e.target.closest ? e.target.closest("button") : null;
  if (!t) return;
  if (t.id === "lookup") lookup(t);
  if (t.id === "confirmGame") createProject(t);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.id === "gameq") { e.preventDefault(); lookup($("lookup")); }
});
document.addEventListener("change", (e) => {
  if (e.target.id !== "pname" || !W.id) return;
  const name = e.target.value.trim();
  if (!name) { actLine($("saveLine"), "bad", "The project needs a name. It keeps its old one until you type a new one."); return; }
  autosave({ name }, (r) => { document.title = r.settings.name; });
});
`;

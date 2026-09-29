/**
 * The free "same screen uploaded twice" check runs in the background (its first run per project
 * takes minutes): the Report page shows a short note while it runs, and reloads the reports and
 * the builder's choices when it is done. Nothing waits for it.
 */
export const SAME_SCREEN_SCRIPT = `
async function watchSameScreens() {
  if (!location.protocol.startsWith("http")) return;
  let note = null;
  for (;;) {
    let s;
    try { s = await getJson(API + "/same-screens"); } catch { if (note) note.remove(); return; }
    if (!s.running) break;
    if (!note) {
      const list = document.getElementById("reportList");
      if (!list) return;
      note = document.createElement("p");
      note.id = "sameScreenNote";
      note.className = "meta";
      note.setAttribute("role", "status");
      note.textContent = "Checking for repeated screens (free, once per project). The reports update when it is done.";
      list.before(note);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  if (!note) return;
  note.remove();
  if (typeof loadReport === "function") loadReport();
  if (typeof loadExpansion === "function" && pageFromHash(location.hash) === "report") loadExpansion();
}
`;

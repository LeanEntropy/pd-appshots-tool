import { escHtml } from "./shell.ts";

/**
 * Archive (or show again) on the project's own Settings page: the home card has one button only.
 * Archiving asks first, in the page; nothing is deleted, the card moves under "Show archived".
 */
export function archiveBoxHtml(id: string, name: string, archived: boolean): string {
  const n = escHtml(name);
  const body = archived
    ? `<h2>This project is archived</h2>
<p class="meta">Its card is under "Show archived" on the home page. Nothing was deleted.</p>
<p><button type="button" class="btn" id="archiveRestore" data-act-key="archive">Show it on the home page again</button></p>`
    : `<h2>Archive this project</h2>
<p class="meta">Archiving hides ${n}'s card on the home page (it moves under "Show archived"). Nothing is deleted, and you can show it again here.</p>
<p><button type="button" class="btn" id="archiveAsk">Archive project</button></p>
<div id="archiveConfirm" class="card" role="group" aria-labelledby="archiveQ" hidden><p id="archiveQ"><strong>Archive ${n}?</strong> Its card moves under "Show archived" on the home page.</p>
<p><button type="button" class="btn primary" id="archiveYes" data-act-key="archive">Yes, archive it</button> <button type="button" class="btn" id="archiveNo">Cancel</button></p></div>`;
  return `<section class="card" id="archiveBox" data-id="${escHtml(id)}">${body}
<p id="archiveStatus" class="act-msg" hidden></p></section>`;
}

export const ARCHIVE_SCRIPT = `
document.addEventListener("click", (e) => {
  const t = e.target.closest ? e.target.closest("button") : null;
  const box = document.getElementById("archiveBox");
  if (!t || !box) return;
  const confirmBox = document.getElementById("archiveConfirm");
  if (t.id === "archiveAsk") { confirmBox.hidden = false; document.getElementById("archiveYes").focus(); }
  if (t.id === "archiveNo") { confirmBox.hidden = true; document.getElementById("archiveAsk").focus(); }
  if (t.id !== "archiveYes" && t.id !== "archiveRestore") return;
  const to = t.id === "archiveYes";
  act(t, {
    busy: to ? "Archiving..." : "Showing it again...",
    status: "archiveStatus",
    keep: true,
    run: () => send("/p/" + encodeURIComponent(box.dataset.id) + "/api/archive", { archived: to }),
    done: () => {
      if (confirmBox) confirmBox.hidden = true;
      const ask = document.getElementById("archiveAsk"); if (ask) ask.hidden = true;
      return to ? "Archived. Its card is under Show archived on the home page." : "It is back on the home page.";
    },
  });
});
`;

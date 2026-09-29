import { ACTION_SCRIPT } from "./action.ts";
import { APPSTORE_CSS, APPSTORE_SETTINGS_SCRIPT, appStoreBoxHtml } from "./appstore-ui.ts";
import { ARCHIVE_SCRIPT, archiveBoxHtml } from "./archive-box.ts";
import { page } from "./pages-html.ts";
import { SETTINGS_SCRIPT } from "./settings-script.ts";
import { appBar, escHtml } from "./shell.ts";

/**
 * The project's Settings page (plan-reports 5B): main country, the model and second opinion of
 * each AI step, early stop, spending limits, core size, suggestion thresholds, visitors per
 * country and the PDF defaults. Every change saves at once with feedback; a change with a cost
 * shows it first and asks. Drawn in the browser from the values the server sends.
 */
const SETTINGS_CSS = `
.grp h2 { margin-top: 0; } .grp > p.meta { margin-top: 0; }
.row { display: grid; grid-template-columns: minmax(200px, 1.2fr) minmax(160px, 1fr); gap: 4px 16px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.row:first-of-type { border-top: none; }
.row label { font-weight: 600; } .row .help, .row .dflt { grid-column: 1 / -1; margin: 0; }
.row .ctl { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.row .act-msg { grid-column: 1 / -1; }
.row select, .row input[type=number] { font: inherit; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--text); min-width: 120px; }
.row input[type=number] { width: 120px; }
.row input[type=checkbox] { width: 20px; height: 20px; accent-color: var(--accent); }
.row .changed { color: var(--next); font-weight: 700; font-size: 13px; }
.linkbtn { background: none; border: none; padding: 0; color: var(--accent); font: inherit; font-size: 13px; text-decoration: underline; cursor: pointer; }
.step { border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px; margin: 10px 0; }
.step h3 { margin: 4px 0; font-size: 16px; } .step p.meta { margin: 2px 0 6px; }
dialog#confirmDlg { max-width: 560px; border: 3px solid var(--next); border-radius: 12px; background: var(--card); color: var(--text); padding: 18px 20px; }
dialog#confirmDlg::backdrop { background: rgba(0,0,0,.45); }
dialog#confirmDlg li { margin: 6px 0; }
.btns { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
@media (max-width: 640px) { .row { grid-template-columns: 1fr; } }
`;

export interface SettingsPageView {
  name: string;
  groups: { id: string; title: string; help: string }[];
  steps: { step: string; label: string; cost: string; note?: string }[];
  fields: unknown[];
}

export function settingsPage(
  id: string,
  name: string,
  view: SettingsPageView | null,
  token: string,
  fixedText: string,
  /** Archived or not; null when the project cannot be archived (not in the registry). */
  archived: boolean | null = null,
  /** The project's App Store switch; null hides it (a project from a config file). */
  appStore: boolean | null = null,
): string {
  const back = `<a class="btn-new" href="/p/${encodeURIComponent(id)}/">Back to the project</a> <a class="btn-new" href="/games">Games library</a>`;
  const data = JSON.stringify({ id, view }).replace(/</g, "\\u003c");
  const body = `${appBar(name, back)}
<style>${SETTINGS_CSS}${APPSTORE_CSS}</style>
<main><h1>Settings</h1>
<p class="meta">Every change is saved at once. A change that costs money (for example a new model, which means analysing images again) shows the number of images and the cost first and asks you.</p>
${view ? '<div id="settings"></div>' : `<div class="card"><p>${escHtml(fixedText)}</p></div>`}
<p class="meta">The knowledge base is shared by all projects: <a href="/knowledge">review and approve its entries</a>.</p>
${view && appStore !== null ? appStoreBoxHtml(id, appStore) : ""}
${archived === null ? "" : archiveBoxHtml(id, name, archived)}
</main>
<dialog id="confirmDlg" aria-labelledby="confirmTitle"><h2 id="confirmTitle">Before this is saved</h2><div id="confirmBody"></div>
<div class="btns"><button type="button" class="btn primary" id="confirmYes">Save this change</button><button type="button" class="btn" id="confirmNo">Cancel</button></div></dialog>
<script type="application/json" id="settingsData">${data}</script>`;
  return page(
    `Settings: ${name}`,
    body,
    token,
    `${ACTION_SCRIPT}${SETTINGS_SCRIPT}${ARCHIVE_SCRIPT}${APPSTORE_SETTINGS_SCRIPT}`,
  );
}

import { APP_ICON_CSS } from "./app-icon.ts";
import { HOME_SCRIPT } from "./home-script.ts";
import { page } from "./pages-html.ts";
import { appBar } from "./shell.ts";

const HOME_CSS = `
#working { position: sticky; top: 0; z-index: 20; display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center; padding: 10px 16px; background: var(--accent); color: #fff; font-weight: 600; box-shadow: 0 2px 10px rgba(0,0,0,.2); }
#working[hidden] { display: none; } #working a { color: #fff; } #working progress { width: 160px; height: 10px; accent-color: #fff; }
.spin { display: inline-block; width: 11px; height: 11px; margin-right: 6px; border: 2px solid #fff; border-right-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; vertical-align: -1px; }
@keyframes spin { to { transform: rotate(360deg); } } @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 460px), 1fr)); gap: 16px; }
.pcard { background: var(--card); border: 1px solid var(--line); border-left: 8px solid var(--muted); border-radius: 14px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.pcard .phead { display: flex; gap: 12px; align-items: center; }
.pcard .icon { width: 44px; height: 44px; flex: none; border-radius: 10px; display: grid; place-items: center; font-weight: 800; font-size: 20px; color: #fff; background: var(--brand); }
.pcard h2 { margin: 0; font-size: 19px; } .pcard .who { flex: 1; min-width: 0; } .pcard .who .meta { overflow-wrap: anywhere; }
.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 800; color: #fff; background: var(--muted); white-space: nowrap; }
.pcard .line { font-size: 16px; font-weight: 600; margin: 0; }
.pcard progress { width: 100%; height: 12px; accent-color: var(--accent); }
.pcard .actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; }
.pcard .btn.big { font-size: 17px; padding: 10px 28px; }
.pcard .line .pill { margin-right: 6px; vertical-align: 2px; }
.pcard.st-setup, .pcard.st-preview { border-left-color: var(--muted); }
.pcard.st-pick { border-left-color: var(--mid); } .pcard.st-pick .pill { background: var(--mid); }
.pcard.st-pilot, .pcard.st-core { border-left-color: var(--accent); } .pcard.st-pilot .pill, .pcard.st-core .pill { background: var(--accent); }
.pcard.st-recommendations { border-left-color: var(--ok); } .pcard.st-recommendations .pill { background: var(--ok); }
.pcard.st-expand { border-left-color: var(--accent-2); } .pcard.st-expand .pill { background: var(--accent-2); }
.pcard.sub-stopped, .pcard.sub-failed { border-left-color: var(--bad); } .pcard.sub-stopped .pill, .pcard.sub-failed .pill { background: var(--bad); }
.pcard.sub-running .pill { background: var(--accent); }
.pcard.archived { opacity: .7; border-left-style: dashed; }
.importbox { border: 3px solid var(--accent-2); background: var(--head-bg); border-radius: 14px; padding: 14px 16px; margin-bottom: 18px; }
.importbox h2 { margin: 0 0 6px; color: var(--accent-2); } .importbox pre { white-space: pre-wrap; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 10px; font-size: 13px; max-height: 50vh; overflow: auto; }
.empty { text-align: center; padding: 40px 16px; }
.linkbtn { background: none; border: none; color: var(--accent); font: inherit; font-weight: 600; cursor: pointer; text-decoration: underline; padding: 0; }
`;

/** The projects home (plan 1.1): one card per project with its status and one button, Open. */
export function homeHtml(token: string): string {
  const body = `<div id="working" role="status" aria-live="polite" hidden></div>
${appBar(null, '<a class="btn-new" href="/new">+ New project</a>')}
<main>
<h1>Your projects</h1>
<div id="import"></div>
<div id="cards" class="cards" aria-live="polite"><p class="meta">Loading your projects...</p></div>
<p id="archivedToggle" hidden><button type="button" class="linkbtn" id="showArchived"></button></p>
<div id="archivedCards" class="cards" hidden></div>
</main>
<style>${HOME_CSS}${APP_ICON_CSS}</style>`;
  return page("Store Screenshot Recipe", body, token, HOME_SCRIPT);
}

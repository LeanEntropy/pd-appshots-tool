import { page } from "./pages-html.ts";
import { appBar } from "./shell.ts";
import { WIZARD_COMPETITORS } from "./wizard-competitors.ts";
import { WIZARD_COUNTRIES } from "./wizard-countries.ts";
import { WIZARD_GAME } from "./wizard-game.ts";
import { WIZARD_REVIEW } from "./wizard-review.ts";
import { WIZARD_CORE } from "./wizard-script.ts";

const WIZARD_CSS = `
.wsteps { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0 0 16px; padding: 0; counter-reset: ws; }
.wsteps li { counter-increment: ws; }
.wsteps button { display: flex; align-items: center; gap: 8px; font: inherit; font-size: 14px; font-weight: 700; padding: 6px 14px 6px 8px; border-radius: 999px; border: 2px solid var(--line); background: var(--card); color: var(--muted); cursor: pointer; }
.wsteps button::before { content: counter(ws); display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--line); color: var(--text); font-size: 12px; }
.wsteps li:nth-child(1) button { --c: var(--brand); } .wsteps li:nth-child(2) button { --c: var(--accent); } .wsteps li:nth-child(3) button { --c: var(--accent-2); } .wsteps li:nth-child(4) button { --c: var(--mid); } .wsteps li:nth-child(5) button { --c: var(--ok); }
.wsteps button.done { color: var(--c); border-color: var(--c); } .wsteps button.done::before { background: var(--c); color: #fff; }
.wsteps button[aria-current="step"] { background: var(--c); border-color: var(--c); color: #fff; } .wsteps button[aria-current="step"]::before { background: #fff; color: var(--c); }
.wsteps button[disabled] { opacity: .55; cursor: not-allowed; }
.wsteps button:focus-visible, .wiz button:focus-visible, .wiz input:focus-visible, .wiz select:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 2px; }
.wiz h2 { margin-top: 0; } .wiz .lead { font-size: 16px; }
.row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.wiz input[type=text], .wiz input[type=number], .wiz select { font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text); }
.wiz input[type=text] { flex: 1; min-width: min(100%, 280px); }
.appcard { display: flex; gap: 12px; align-items: center; padding: 12px; border: 2px solid var(--accent); border-radius: 12px; background: var(--tint); margin: 12px 0; }
.appcard.fixed { border-color: var(--ok); }
.ico { width: 48px; height: 48px; flex: none; border-radius: 12px; object-fit: cover; display: grid; place-items: center; font-weight: 800; font-size: 20px; color: #fff; background: var(--brand); }
.ico.sm { width: 36px; height: 36px; font-size: 16px; border-radius: 9px; }
.who { flex: 1; min-width: 0; } .who strong { font-size: 17px; } .who .meta { overflow-wrap: anywhere; }
.hits { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 6px; }
.hits li { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); }
#comps { list-style: none; padding: 0; margin: 10px 0; display: grid; gap: 6px; counter-reset: comp; }
#comps li { counter-increment: comp; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-left: 6px solid var(--accent); border-radius: 10px; background: var(--card); touch-action: none; cursor: grab; }
#comps li::before { content: counter(comp) "."; font-weight: 800; color: var(--accent); min-width: 22px; }
#comps li.dragging { opacity: .6; outline: 2px dashed var(--accent); }
#comps li:focus-visible { outline: 3px solid var(--accent-2); }
.grip { color: var(--muted); font-size: 18px; user-select: none; }
.empty { padding: 16px; text-align: center; border: 2px dashed var(--line); border-radius: 12px; color: var(--muted); }
fieldset { border: 1px solid var(--line); border-radius: 12px; margin: 0 0 12px; padding: 8px 12px 12px; }
legend { font-weight: 800; color: var(--accent-2); padding: 0 6px; }
.clist { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 6px 16px; }
.crow { display: flex; gap: 8px; align-items: center; justify-content: space-between; padding: 4px 0; }
.crow label { display: flex; gap: 8px; align-items: center; font-weight: 600; cursor: pointer; }
.crow input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--accent); }
.crow select { padding: 4px 6px; }
.baseline { background: var(--head-bg); border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; font-weight: 600; }
.nav { display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; margin-top: 16px; }
.warnbox { border-left: 6px solid var(--mid); background: var(--card); padding: 8px 12px; border-radius: 8px; margin: 8px 0; }
.sum { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0 0 12px; } .sum dt { font-weight: 700; color: var(--muted); } .sum dd { margin: 0; }
.radio { display: flex; gap: 8px; align-items: center; margin: 6px 0; font-weight: 600; }
#saveLine { min-height: 1.5em; }
`;

/**
 * The new-project wizard (plan 1.2): five short steps on one page, saved as they go. With a
 * project name it reopens that project's setup where the user stopped.
 */
export function wizardHtml(token: string, projectName: string | null): string {
  const body = `${appBar(projectName ?? "New project")}
<main class="wiz">
<h1>${projectName ? "Set up your project" : "New project"}</h1>
<ol class="wsteps" id="wsteps" aria-label="New project steps"></ol>
<div id="saveLine" class="act-msg"></div>
<section id="step" class="card" aria-live="polite"><p class="meta">Loading...</p></section>
</main>
<style>${WIZARD_CSS}</style>`;
  const script = `${WIZARD_CORE}${WIZARD_GAME}${WIZARD_COMPETITORS}${WIZARD_COUNTRIES}${WIZARD_REVIEW}\nwizardStart();\n`;
  return page(projectName ?? "New project", body, token, script);
}

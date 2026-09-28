import type { ProjectState } from "../projects/state.ts";
import { ACTION_CSS, ACTION_SCRIPT } from "./action.ts";
import { appBar, escHtml, SHELL_CSS, stepBar, TOKENS } from "./shell.ts";

export const PAGE_CSS = `${TOKENS}
${SHELL_CSS}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 60px; }
h1 { font-size: 24px; margin: 4px 0 12px; color: var(--brand); } h2 { font-size: 18px; margin: 18px 0 8px; }
.meta { color: var(--muted); font-size: 13px; } .warn { color: var(--warn); } .ok { color: var(--ok); }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; }
.btn { display: inline-block; font: inherit; font-weight: 700; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--line); background: var(--bg); color: var(--text); text-decoration: none; cursor: pointer; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 2px; }
code { background: var(--bg); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
${ACTION_CSS}
`;

function page(title: string, body: string, token = "", script = ""): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="ssr-token" content="${escHtml(token)}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
${body}
<script>${script || ACTION_SCRIPT}</script>
</body>
</html>
`;
}

export { page };

/** The "New project" button's page until the setup wizard exists. */
export function newProjectHtml(): string {
  return page(
    "New project",
    `${appBar("New project")}
<main><h1>New project</h1>
<div class="card"><p><strong>Creating a project from this page arrives in the next update (milestone 3).</strong></p>
<p>There you will paste your game's Google Play link, add competitors by link or name, tick the countries and charts, and check the store, all in this page and saved as you go.</p>
<p><a class="btn primary" href="/">Back to all projects</a></p></div></main>`,
  );
}

/**
 * A project that has nothing downloaded yet (or is still a draft): what it needs next. Checking
 * the store and downloading from this page arrive in a later update.
 */
export function statusPage(id: string, name: string, s: ProjectState, token: string): string {
  const next =
    s.stage === "setup" || s.stage === "preview"
      ? `<p>Checking the store and downloading from this page arrive in a later update. Until then, run these in a terminal in the tool's folder:</p>
<ol><li><code>npm run preview -- --project ${escHtml(id)}</code> shows what would be downloaded (no images yet)</li>
<li><code>npm run download -- --project ${escHtml(id)}</code> downloads after your approval</li></ol>
<p>Then open this project again from the home page.</p>`
      : `<p><a class="btn primary" href="${escHtml(s.next.href)}">${escHtml(s.next.label)}</a></p>`;
  return page(
    name,
    `${appBar(name)}${stepBar(s.steps)}
<main><h1>${escHtml(name)}</h1>
<div class="card"><h2>${escHtml(s.line)}</h2>${next}</div>
${s.notices.map((n) => `<p class="warn">${escHtml(n)}</p>`).join("")}
<p><a class="btn" href="/">Back to all projects</a></p></main>`,
    token,
  );
}

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

/**
 * A project that has nothing downloaded yet (or is still a draft): what it needs next. Checking
 * the store and downloading from this page arrive in a later update.
 */
export function statusPage(id: string, name: string, s: ProjectState, token: string): string {
  const cmd = (c: string) =>
    `<code class="cmd">${escHtml(c)}</code> <button type="button" class="btn copy" data-copy="${escHtml(c)}">Copy</button>`;
  const preview = s.stage === "preview";
  const next =
    s.stage === "setup" || preview
      ? `<p class="next-step">Next step: <strong>${preview ? "Approve the download" : "Download preview"}</strong></p>
<p>${preview ? "The download preview is ready: it says how many store pages and images will be downloaded and the disk space." : "The tool reads the store pages and the charts, then shows how many images it would download and the disk space. No images are downloaded and nothing is sent to AI."} Doing this from this page arrives in the next update. Until then, run this in a terminal in the tool's folder:</p>
<ol>${preview ? "" : `<li>Download preview: ${cmd(`npm run preview -- --project ${id}`)}</li>`}
<li>${preview ? "" : "Then, after reading the numbers: "}${cmd(`npm run download -- --project ${id}`)} shows the numbers again and downloads after your approval.</li></ol>
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
    `${ACTION_SCRIPT}${COPY_SCRIPT}`,
  );
}

/** "Copy" next to a terminal command: copies it and says so. */
const COPY_SCRIPT = `
document.addEventListener("click", (e) => {
  const b = e.target.closest ? e.target.closest("button[data-copy]") : null;
  if (!b) return;
  act(b, {
    busy: "Copying...",
    run: () => navigator.clipboard.writeText(b.dataset.copy).catch(() => { throw new Error("The browser did not allow copying. Select the command and copy it by hand."); }),
    done: "Copied. Paste it into a terminal in the tool's folder.",
  });
});
`;

/**
 * Shared look of every page (plan 6.4): colour tokens for light and dark, the top bar with
 * "All projects", and the project's step bar. Deterministic HTML, no framework.
 */
export const TOKENS = `
:root { --bg: #f7f7f5; --card: #ffffff; --text: #1d1d1f; --muted: #6b6b70; --line: #e2e2e0; --accent: #2f6fdb; --warn: #b3261e; --next: #c2410c; --tint: #eef3fd; --accent-2: #0f766e; --head-bg: #e6f4f1; --ok: #15803d; --mid: #b45309; --bad: #b91c1c; --brand: #4338ca; --brand-2: #0f766e; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #151517; --card: #1f1f22; --text: #ececef; --muted: #9a9aa2; --line: #333338; --accent: #7aa7ff; --warn: #ff8a80; --next: #fb923c; --tint: #1c2438; --accent-2: #5eead4; --head-bg: #16302c; --ok: #4ade80; --mid: #fbbf24; --bad: #f87171; --brand: #3730a3; --brand-2: #115e59; } }
:root[data-theme="dark"] { --bg: #151517; --card: #1f1f22; --text: #ececef; --muted: #9a9aa2; --line: #333338; --accent: #7aa7ff; --warn: #ff8a80; --next: #fb923c; --tint: #1c2438; --accent-2: #5eead4; --head-bg: #16302c; --ok: #4ade80; --mid: #fbbf24; --bad: #f87171; --brand: #3730a3; --brand-2: #115e59; }
`;

export const SHELL_CSS = `
.appbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 16px; background: linear-gradient(90deg, var(--brand), var(--brand-2)); color: #fff; }
.appbar a { color: #fff; }
.appbar .brand { font-weight: 800; font-size: 17px; text-decoration: none; letter-spacing: .01em; }
.appbar .crumbs { font-size: 15px; font-weight: 600; } .appbar .crumbs a { text-decoration: none; opacity: .9; } .appbar .crumbs a:hover { text-decoration: underline; }
.appbar .grow { flex: 1; }
.appbar .btn-new { background: #fff; color: var(--brand); border: none; border-radius: 8px; padding: 7px 14px; font-weight: 700; text-decoration: none; }
.appbar .btn-new:focus-visible, .appbar a:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
ol.steps { display: flex; flex-wrap: wrap; gap: 4px; list-style: none; margin: 0; padding: 8px 16px; background: var(--card); border-bottom: 1px solid var(--line); counter-reset: step; }
ol.steps li { counter-increment: step; display: flex; align-items: center; gap: 6px; padding: 4px 12px 4px 8px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--muted); background: var(--bg); border: 1px solid var(--line); }
ol.steps li::before { content: counter(step); display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; font-size: 11px; background: var(--line); color: var(--text); }
ol.steps li.done { color: var(--ok); } ol.steps li.done::before { content: "\\2713"; background: var(--ok); color: #fff; }
ol.steps li.current { color: #fff; background: var(--accent); border-color: var(--accent); } ol.steps li.current::before { background: #fff; color: var(--accent); }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
ol.steps li + li { margin-left: 18px; position: relative; } ol.steps li + li::after { content: ""; position: absolute; left: -18px; top: 50%; width: 14px; height: 2px; background: var(--line); }
`;

export const escHtml = (s: string | number) =>
  String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface Step {
  label: string;
  state: "done" | "current" | "todo";
}

/** The top bar: brand (home link), "All projects / <project>", and an optional right side. */
export function appBar(project: string | null, right = ""): string {
  const crumbs = project
    ? `<nav class="crumbs" aria-label="Where you are"><a href="/">All projects</a> / <span>${escHtml(project)}</span></nav>`
    : `<nav class="crumbs" aria-label="Where you are"><span>All projects</span></nav>`;
  return `<header class="appbar"><a class="brand" href="/">Store Screenshot Recipe</a>${crumbs}<span class="grow"></span>${right}</header>`;
}

/** Settings, Download, Pick competitors, Pilot, Core check, Recommendations. */
export function stepBar(steps: readonly Step[]): string {
  if (!steps.length) return "";
  const items = steps
    .map(
      (s) =>
        `<li class="${s.state}"${s.state === "current" ? ' aria-current="step"' : ""}>${escHtml(s.label)}${s.state === "done" ? '<span class="sr"> (done)</span>' : ""}</li>`,
    )
    .join("");
  return `<ol class="steps" aria-label="Project steps">${items}</ol>`;
}

# Review: home Open opens directly (fix/home-open-direct)

Reviewer: gpt-5.6-terra (codex exec, read-only), 2026-09-29, diff inline.

## Finding
- High, `src/view/home-script.ts` render(): refreshes are dropped while a project is opening, and
  `pageshow` only clears `actLeaving`. Coming back through the browser's page cache would show the
  old card until some later render.

## Outcome
- Fixed: the home page renders again on `pageshow` when the page comes back from the cache (the
  link labels are already reset by the shared action script).

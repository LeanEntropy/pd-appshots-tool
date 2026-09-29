# Home "Open" needs one press: code review (gpt-5.6-terra)

Reviewer: gpt-5.6-terra via Codex CLI (read-only, ephemeral), 2026-09-29. Scope: branch fix/home-open-once (src/view/action.ts, src/view/home-script.ts, test/home-open.test.ts), base 402dce7. The Codex sandbox blocks local commands on this machine, so the reviewer got the full diff and the bug analysis as input.

## Findings (as returned)

- **Medium: modified/new-context clicks leave `actLeaving` stuck.** The handler sets it for Ctrl/Cmd-clicks, middle/new-tab behavior, `target="_blank"`, downloads, and likely same-document full-URL fragment links. The originating page does not navigate or receive `pageshow`, so home polling is suppressed indefinitely and later re-renders keep matching links busy. Set `actLeaving` only for an unmodified primary click that replaces the current document, or clear it when navigation does not occur.
- **Low: same-document URLs with fragments are not excluded.** Only `href.startsWith("#")` is skipped. A link such as `/current/page#section` is treated as leaving despite staying on the page, causing the same stuck state above.

Otherwise, the MutationObserver restoration, unchanged-HTML guard, and test's held-navigation scenario look sound.

## What was done

- Modified clicks, non-primary buttons and `target="_blank"` were already filtered out before `actLeaving` is set (the handler returns early for them); no change needed there.
- Downloads (`download` attribute) and links to a place on the same page (same origin, path and query, with a hash) no longer count as leaving the page, so they neither show "Opening..." nor stop the home page's refreshes. Both findings are addressed.

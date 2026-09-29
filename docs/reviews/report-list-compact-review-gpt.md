# Review: compact report list, no duplicate drafts, in-page delete

- Reviewer: `gpt-5.6-terra` via `codex exec -m gpt-5.6-terra -s read-only --skip-git-repo-check --ephemeral` (diff and requirements inline on stdin), 2026-09-29
- Scope: branch `fix/report-list-compact` (same-setup detection in the builder, compact Reports tab rows and suggestion rows, short status chips, in-page Delete confirmation, no delete while a run is going)

## Findings

1. **Medium, `src/view/report-list.ts`**: a report whose run is going still showed Delete and its confirmation; only the server refused.
   - Fixed: a running report shows "Stop the run before deleting this report." instead of the button, and has no confirmation box. Test added.
2. **Low, `src/reports/builder-status.ts`**: `shortRange()` picked whole dollars for both ends when the high end was $10 or more, so `$9.95-$10.05` collapsed to `~$10`.
   - Fixed: each end is formatted on its own (`~$9.95-10`). Test added.

No other findings: every new HTML path escapes names and data (`esc` / `flagText`), and the server also refuses deleting a report with a running AI job.

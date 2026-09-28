# R2 PDF export: code review by gpt-5.6-sol

Date: 2026-09-28. Reviewer: gpt-5.6-sol via Codex CLI (cross-family), on commit decad98 (branch feat/r2-pdf). The Codex sandbox could not run git on this machine, so the diff, plan section 6 and the pillars excerpt were passed inline.

## Review (verbatim)

The basic export is largely implemented, but I found one major security problem: the headless browserâ€™s supposedly local-only origin is derived from the untrusted HTTP `Host` header. I also found two smaller correctness/resource issues and one misleading integration test.

1. **Major â€” `src/server/export-api.ts:120` â€” Untrusted `Host` header controls the browser destination**

   `origin` is constructed as ``http://${req.headers.host}``, and that same value becomes both the page URL and `allowPrefix`. A crafted authenticated request with a foreign `Host` header therefore causes Chrome to navigate to that foreign origin, while the route filter explicitly permits it. This breaks the requirement that the headless browser load only this projectâ€™s local URLs.

   **Fix:** obtain the origin from trusted server state established when the listener starts, or construct it from the bound loopback address and actual listening port. Do not use `req.headers.host`. Additionally, compare parsed URL origins and project-path prefixes rather than relying solely on string `startsWith`.

2. **Minor â€” `src/export/pdf.ts:151-178` â€” Browser shutdown is started but never awaited**

   `close()` discards the `browser.close()` promise, including in `finally`. Consequently, `renderPdf` and the export lane can finish while Chromium is still shutting down, allowing consecutive jobs to briefly overlap browser processes. Shutdown failures are also silently treated as successful closure, so the â€œbrowser is always closedâ€ guarantee is weaker than stated.

   **Fix:** keep an idempotent asynchronous close function and `await` it in `finally`. The abort listener can initiate closure immediately, while `finally` awaits the same promise before releasing the export lane.

3. **Minor â€” `src/view/report-export.ts:76-80, 103-124` â€” Browser fallback ignores the selected export options**

   When browser launch fails, the fallback button calls `printReportFallback(b)` against the currently displayed report. It does not preserve the dialogâ€™s `images` choice or selected report reference. For example, selecting â€œWithout picturesâ€ can print pictures if they are visible on screen; selecting â€œWith picturesâ€ can retain the screenâ€™s hidden-image state. This makes the fallback behave differently from the requested export.

   **Fix:** retain the failed exportâ€™s options and report target in the fallback control. Before printing, apply the requested global image state and relevant per-section hidden state, then restore the prior screen state in `afterprint`. Add coverage for both picture modes.

4. **Minor â€” `test/pdf-export-server.test.ts:93-96` â€” The real-browser test incorrectly makes bookmarks mandatory**

   The test always requires `/Outlines` in the generated PDF. Section 6.2 explicitly says bookmarks are optional when the installed browser does not support `outline`; the PDF should still be considered successful. On such a browser, working export functionality will fail the test.

   **Fix:** assert PDF validity and multiple pages unconditionally, but make the outline assertion conditional on detected support or record it as diagnostic information rather than failing the test.

## Outcome

| # | Finding | Outcome |
|---|---|---|
| 1 | Origin taken from the request's Host header | Fixed: the origin is the address the server listens on (127.0.0.1 and the socket's local port). The server already refused non-local hosts, but a foreign port could have been chosen. |
| 2 | Browser close not awaited | Fixed: one idempotent close, awaited in finally before the export lane moves on. |
| 3 | The browser fallback ignores the dialog's picture choice | Declined for now: the user lowered PDF export to low priority; the fallback prints what is on screen (the page's own Show images and per-section toggles). To do when PDF work resumes. |
| 4 | Real-browser test requires bookmarks | Fixed: bookmarks are reported as a test diagnostic, not required (plan 6.2). |

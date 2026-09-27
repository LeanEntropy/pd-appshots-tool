# Gallery pages plan: review (gpt-5.6-sol)

Reviewer: gpt-5.6-sol via Codex CLI (read-only), 2026-09-28. Plan: docs/ui-pages-plan.md.

High

- `buildReportData(loaded, stage)` is described as reading “what is on disk.” That conflicts with the repository rule against filesystem access in feature code. Make filesystem/repository dependencies explicit and keep `report-data.ts` pure.
- Falling back to a freshly built plan changes the approved batch. Reports must distinguish “approved plan unavailable” from an inferred current plan; otherwise store order, hashes, costs, and missing reasons can be wrong.
- Historical runs cannot be reconstructed faithfully from saved Markdown alone. Serving old Markdown as HTML also breaks `../../images/...` URLs relative to `/api/report`. Save versioned `ReportData` with each run and render both HTML and Markdown from it.
- The plan assumes `batchDataHash`, order-snapshot dates, stop reasons, spending-limit state, and complete recommendation styling fields already persist. Unless those fields exist in current artifacts, freshness and exact missing-synthesis reasons cannot be derived reliably; define their provenance/schema first.
- “Patterns run with missing images” is unsafe unless `findPatterns()` and `compareOurs()` explicitly support partial inputs and per-position denominators. Adapt their inputs/results rather than merely calling them and adding a missing count.
- The required “ours vs patterns per position with reasons” is mentioned for Markdown but not explicitly included in `ReportData` or the web report content. Make it a first-class required section.
- Rendering stored Markdown as HTML introduces an injection boundary. Validation of `run` prevents traversal, but Markdown/embedded HTML still needs escaping or sanitizing.

Medium

- “Latest report run of the stage” can combine AI output with a different approved batch. Select synthesis by persisted batch hash/run identity, not timestamp, and never attach mismatched recommendations as current.
- Rebuilding historical competitor examples from current entries makes old reports mutate as downloads or ordering change. Persist selected example IDs with the run, or label them as live enrichment.
- “Same content” conflicts with thumbnails appearing only in the page’s comparison matrix. Define one canonical report model and allow presentation differences only, including image references in both outputs.
- A single `/api/report` endpoint returning either JSON or HTML complicates typing and error handling. Prefer `/api/report/current`, `/api/report/runs`, and `/api/report/runs/:id`, returning structured data; render HTML client-side.
- Hiding every deck rather than rendering the active page preserves the current large DOM and image-loading cost. Lazy-render heavy tabs, or at least use `loading="lazy"` and avoid eager image requests.
- The plan does not specify invalid/empty hashes, focus movement after tab changes, or `aria-controls`/tab semantics. Centralize hash parsing and fall back deterministically.
- “Open the approval” must reuse the existing approval calculation and explicitly show what data will be sent. A generic Start-analysis retry may resend already completed screenshots unless the current run logic supports resumable selection.

Low

- “Foldable section headers” risks hiding mandatory report content and weakening hierarchy; default required deterministic sections open.
- Exact red/amber/green verdict colors need contrast checks and non-color labels/icons in both themes.
- A fake-DOM parser test is brittle for navigation. Extract a pure hash-to-page function and add one browser-level accessibility/navigation test.
- `gallery-report-parts.ts` “if needed” and folding `report-sections.ts` are too vague for the 300-line constraint; establish module boundaries around data, Markdown rendering, and browser rendering before implementation.

Verdict: Directionally sound, but not implementation-ready until artifact provenance, partial-analysis semantics, historical snapshots, and the canonical report model are made explicit.
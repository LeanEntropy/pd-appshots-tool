# Code review: layout capture and benchmark (gpt-5.6-sol, 2026-09-29)

Reviewer: gpt-5.6-sol via Codex CLI (read-only, ephemeral), given the requirements and the diff inline (src, test, prompts, scripts/layout-bench).

## Findings

- **Major** — [src/layout/store.ts:88](src/layout/store.ts:88), [src/layout/store.ts:121](src/layout/store.ts:121): An already-saved layout is returned as `current` without revalidating it against `record.final`. If adjudication later changes the reading, `ensureLayout()` also returns this stale file immediately, so the required “missing” state is never reached. Validate saved layouts against the current final reading before returning them; report `missing` on incompatibility and avoid using its measurements.

- **Major** — [src/analysis/call.ts:250](src/analysis/call.ts:250): The add-on’s independent repair is constrained by the core’s `MAX_REPAIRS` loop. If the core first becomes valid on its second repair and the layout is invalid, the function returns immediately without the required one layout-only repair. Track core and layout repair allowances separately, permitting one additional attempt after the core becomes valid.

- **Minor** — [src/layout/measure/rect.ts:50](src/layout/measure/rect.ts:50), [src/layout/measure/index.ts:134](src/layout/measure/index.ts:134): When only one rectangle edge passes the quality threshold, `snapBox()` returns a complete box containing unverified model-derived edges; `isMeasured()` then labels the whole box measured. Preserve measurements per side or only emit a measured box when all required edges pass; otherwise keep the element estimated.

## Outcome

| # | Finding | Outcome |
|---|---|---|
| 1 | A saved layout is reported current without re-checking it against the record's final reading | **Applied:** `layoutStatus` and `ensureLayout` re-check a saved layout against the final reading; one that no longer fits reads as missing (test added) |
| 2 | The layout's own repair is lost when the core first becomes valid on its last repair | **Applied:** the loop allows one more call, for the layout alone, once the core is valid (test added) |
| 3 | A rectangle with only some sides snapped was labelled measured | **Applied:** a snapped box counts as measured only when every side off the image border found its edge; the benchmark was re-scored (free), gate results unchanged |
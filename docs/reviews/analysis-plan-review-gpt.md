# Analysis implementation plan: cross-family review (gpt-5.6-sol)

- Reviewer: `codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral`, plan and requirements inlined on stdin. Date: 2026-09-27.
- Decisions are in `docs/analysis-impl-plan.md`, section "Review outcome".

## Reviewer output (verbatim)

1. **High — Store-order snapshots are written too late.** Writing `orders/...` only “at the end of each run” loses all order data when analysis aborts or is interrupted, violating resumability. **Fix:** persist the fetched deck order before image analysis begins, then enrich entries atomically as analyses complete; mark snapshot completeness explicitly.

2. **High — The plan can publish reports from an incomplete competitor set.** After three repeated failures, synthesis could still run over only the “usable records,” producing misleading patterns and recommendations. **Fix:** define minimum completeness rules, show missing/failed coverage prominently, and block final recommendations unless the user explicitly approves a partial report.

3. **High — Budget enforcement for synthesis is underspecified.** A “provisional cost” in approval does not ensure the existing budget guard covers interpretation, recommendations, review, and revision. **Fix:** reserve a worst-case budget before starting and check remaining budget before every model call, including retries and optional revision.

4. **High — Cache identity is ambiguous and risks stale answers.** “Cached by content” is insufficient because results also depend on prompt, schema, taxonomy, model, and provider settings. **Fix:** key cached calls by image/content hash plus all analysis-input versions and model identity; retain the SHA-256 image record as the stable pointer.

5. **Medium — Order snapshots can silently mix fetch-time and analysis-time state.** Overwriting the same date with “the latest” may replace a complete snapshot with a partial run or reinterpret old positions after taxonomy changes. **Fix:** store immutable raw order and fetch timestamp separately from derived classifications; version derived data and atomically update only complete enrichment.

6. **Medium — “Ours vs patterns” covers too little of the requested comparison.** It compares type, orientation, layer presence, proportion, and length, but omits screenshot colours, marketing colours, text, masks, and extra-element co-occurrences. **Fix:** add deterministic comparisons for every pattern dimension surfaced in B4 and show them beside each applicable image/position.

7. **Medium — The verdict thresholds are arbitrary and can mislabel weak consensus as “following.”** “Most common” may have a very small share, while the ≥25% rule overlaps it unpredictably; neighbouring-position presence also ignores frequency. **Fix:** define confidence/sample-size gates and base verdicts on explicit distance scores or documented thresholds validated against small decks.

8. **Medium — Orientation is not precisely defined.** The asset canvas, embedded gameplay capture, and depicted device can have different orientations. **Fix:** store `assetOrientation` and `captureOrientation` separately, with an `unknown/not_applicable` value where no screenshot exists.

9. **Medium — Percentage fields lack a reproducible measurement contract.** `captureAreaPercent` and `coveragePercent` may overlap, leave unused area, or be interpreted differently by models, making buckets unreliable. **Fix:** define denominator, occlusion/overlap rules, tolerances, and consistency validation; derive one value from segmented regions where possible.

10. **Medium — Adjudication is too narrow for the required detailed data.** Opus settles only four fields, despite recommendations relying on masks, text properties, elements, colours, actions, and atmosphere. **Fix:** have the reviewer emit field-level disagreements for the complete schema and adjudicate all material/high-confidence conflicts, not only four headline fields.

11. **Medium — Command resolution by parsing arbitrary npm `.cmd` shims is brittle.** npm-generated shims vary across npm/package-manager versions and may contain environment logic that cannot safely be reduced to `node <script>`. **Fix:** restrict parsing to recognized shim templates with validation and tests; otherwise resolve the package entry through a configured executable path and fail with actionable setup guidance.

12. **Medium — Job-state concurrency and durability are missing.** A single `pending/analysis-status.json` can be corrupted or overwritten by double-starts, concurrent tabs, or a crash during write. **Fix:** enforce one active job with a lock/job ID, use atomic temp-file replacement, and make polling/report endpoints job-specific.

13. **Low — “All fields required, empty instead of optional” can hide uncertainty.** Empty strings and arrays conflate “absent,” “not applicable,” and “model could not determine.” **Fix:** use explicit enums/status fields such as `absent`, `unknown`, and `not_applicable`, while keeping the schema strict.

14. **Low — The recommendation contract does not explicitly guarantee one recommendation per intended image/slot.** The model could return too few, too many, or duplicate positions. **Fix:** provide the target deck length and require unique contiguous positions with schema and semantic validation.

15. **Low — Accessibility behavior for the analysis popover is incomplete.** Hover/focus and Escape are mentioned, but not activation, focus management, mobile/touch behavior, or ARIA relationships. **Fix:** make `(i)` a real button with click/tap support, `aria-expanded`/`aria-controls`, focus return, and dismiss-on-outside interaction.
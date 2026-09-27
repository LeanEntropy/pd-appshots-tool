# Cross-family review of plan-v1.md (GPT)

- Reviewer: `gpt-6-astra` via `codex exec -s read-only --ephemeral` (Codex CLI 0.153.4), 2026-09-26
- Reviewed: docs/plan-v1.md + docs/product-proposal-v1.md against PILLARS.md, the session log, the research report, FINDINGS.md, ASSETS.md and user requirements (a)-(g), all inlined into the prompt (the Codex Windows sandbox blocked file reads)
- Prompt: scratchpad `review-prompt.md`
- Verbatim output below. Fixes are NOT applied; the orchestrator decides.

---

1. **Critical · wrong-assumption · §1, §6 — Artifact integration.** The supplied evidence does not establish that a fresh Claude Code installation exposes `Artifact`, `ArtifactData`, or `ArtifactComments`. Publishing and feedback import depend on an unverified host capability.
   **Fix:** Make authenticated private publishing, asset upload, db access and comment import an initial feasibility gate; document the required connector/setup and a supported fallback.

2. **High · failure-mode · §6 — Artifact limits.** Approximately 350 thumbnail strips plus 40 other files exceed the **255-file per-publish** limit. The fallback adds approximately 350 display strips, exceeding **511 files per version** if thumbnails remain; publishing in batches does not fix that.
   **Fix:** Define a packing strategy with explicit file/byte budgets for both modes, verify update semantics, and fail preflight if any publish, version or HTML limit is exceeded.

3. **High · wrong-assumption · §3, §10 R3; proposal 27 — Device classification.** The spike establishes that device-specific groups are unavailable; it does not establish that screenshots beyond eight are tablet screenshots. Aspect ratio cannot reliably establish device class, so the proposed filtering could remove valid evidence and corrupt slot statistics.
   **Fix:** Preserve every ordered screenshot, mark device class unknown unless supported by metadata, and keep the configurable recommendation length separate from source-deck length.

4. **High · failure-mode · §3 — Cache invalidation.** The image-based cache key omits taxonomy, contextual hints, preprocessing and upstream inputs. It also cannot adequately identify translation or recommendation inputs; changing an upstream prompt must invalidate dependent results, contrary to “re-runs only its step.”
   **Fix:** Hash each step’s complete normalized inputs, configuration, prompt/schema/taxonomy versions, resolved model and relevant overrides; invalidate downstream stages through explicit dependencies.

5. **High · gap-vs-requirement · §4, §7 — Historical snapshots.** Several mutable outputs lack run or content identifiers, including measurements, translations, own-asset mappings and overrides. Historical decks alone cannot reconstruct the analysis and corrections used for a previous report.
   **Fix:** Save an immutable run manifest referencing exact config, source assets, analysis results, measurements and override revisions; preserve those referenced objects.

6. **High · failure-mode · §3, §10 R4 — Dedup and localization.** The proposed pHash thresholds risk merging screenshots whose only difference is required text. Image equality also establishes “same as baseline,” not necessarily “unlocalized.”
   **Fix:** Use exact identity for reuse without reanalysis; use pHash only to propose variant relationships. Determine localization status from observed text language and target language, with unknown/text-free states.

7. **High · wrong-assumption · §3 L3, §6 — Locale alignment.** Matching by position can compare unrelated screenshots when publishers reorder or replace scenes; variant grouping does not guarantee a valid translation pair.
   **Fix:** Track verified cross-locale correspondence separately from listing order, allow unmatched images, and flag uncertain matches for review before comparing translations.

8. **High · gap-vs-requirement · §4 S8, §6 — Consensus definition.** The central aggregation algorithm is unspecified: denominators, missing slots, unavailable listings, named/chart overlap and PH’s two languages can materially change the result.
   **Fix:** Define the observation unit, pool precedence, weighting, exclusions and coverage. Report sample sizes, raw counts and weighted proportions, with fixtures covering these edge cases.

9. **High · failure-mode · §4, §6, §9 — Feedback semantics.** Feedback IDs omit run/recommendation revision, allowing approvals to attach to changed recommendations. Text corrections enter after review and before counting, but translation invalidation, conflicts and adjudication persistence are undefined.
   **Fix:** Scope feedback to immutable item revisions; store typed, versioned overrides and adjudications; invalidate every affected downstream step and preserve unresolved conflicts.

10. **High · cost · §3, §9; proposal 22 — Budget enforcement.** The table is an estimate, not an enforceable per-run budget. It omits repair/adjudication calls, expanded review sampling and explicit glossary-review costs; subscription throughput and the claimed measured Claude call cost are unsupported by the supplied evidence.
    **Fix:** Add configurable call/token ceilings, a complete preflight estimate and resumable stopping at the limit. Include pilot, retries and escalations; label unsubstantiated measurements as assumptions.

11. **High · wrong-assumption · §2–3, §6 — Marketing-layer measurements.** A palette extractor and row/diagonal scan do not establish accurate geometry for ribbons, speech bubbles, gradients or occluded panels. Exact original opacity and layer colors generally cannot be recovered uniquely from flattened pixels.
    **Fix:** Limit deterministic measurements to validated cases; record method, uncertainty and unknown values. Use reviewed semantic region identification where needed, then measure observable pixels within those regions.

12. **High · gap-vs-requirement · §4 S10, §6 — Own assets and visual completeness.** Own assets enter after the image-analysis stage, without an explicit path through ingestion, optimization, analysis and review. The gallery promises competitor decks, but does not explicitly cover every collected own/local image or failed-analysis item.
    **Fix:** Ingest own raster assets before S5–S7, preserve the documented mappings and unmatched files, and check that every collected image appears beside its analysis or failure status in both report formats.

13. **High · failure-mode · §3, §9 — Failed and disputed analysis.** The run continues after failures, but no rule defines whether those images enter statistics or whether recommendations remain publishable. Zod validation alone does not verify evidence references or factual correctness.
    **Fix:** Add completeness thresholds, unresolved-disagreement states and semantic validation for evidence IDs, positions and locales. Exclude unusable observations explicitly and label or block incomplete recommendations.

14. **Medium · gap-vs-requirement · §3, §5, §9 — Provider-independent cross-family review.** Review is fixed to GPT even though providers are configurable, so switching primary analysis to OpenAI could silently produce same-family review. The tool interface also does not clearly specify image inputs, resolved model identity or provider capabilities.
    **Fix:** Declare provider/model families and capabilities, enforce a different reviewer family, and validate the selected runtime with a small structured vision-call smoke test.

15. **Medium · wrong-assumption · §2; proposal 13 — Reuse rationale and licensing.** MCP does not inherently require LLM-mediated ingest, and a URL array can preserve order without an explicit order field. The table lists licenses but does not state compatibility or obligations for the proposed distribution.
    **Fix:** Base rejection on actual integration/runtime costs; add a compatibility/notice column and distinguish supplied evidence from additional, unsubstantiated verification claims.

16. **Medium · gap-vs-requirement · Product proposal — Approval contract.** The proposal is not demonstrated to fit two pages and bundles multiple decisions into single approval lines. It also promises four AI steps where the plan lists five, and downloading video/feature graphics without corresponding pipeline work.
    **Fix:** Produce a fixed two-page version with atomic approval items; reconcile AI stages and make media scope consistent with the implementation plan.

**Verdict: rework.**
# Second-opinion and region-clamp fix: code review (gpt-5.6-sol)

Reviewer: gpt-5.6-sol via Codex CLI (read-only), 2026-09-28. Scope: commits b5bbf88 (fixture config for tests, lint ignores worktrees) and d72e140 (a failed second opinion keeps the first reading; region clamping).

- **High — nonsensical capture regions still invalidate the entire analysis.**  
  File: `src/analysis/regions.ts`, `clampRegions`  
  `clampRegion()` identifies an invalid capture, but `clampRegions()` restores the original invalid region when the clamped width is zero:
  ```ts
  return { ...c, region: r.w > 0 ? r : c.region };
  ```
  The subsequent semantic check rejects that output, potentially exhausting repairs and discarding an otherwise valid producer reading. This violates the requirement that nonsensical regions be dropped rather than causing the analysis to fail. It affects producer/reviewer responses and cached objects.  
  **Suggested fix:** filter out captures whose regions clamp to the empty sentinel, or represent them in a schema-supported positionless form. Add fresh and legacy-cache tests for a far-outside capture.

- **Medium — the legacy `unreviewed` reuse requirement is not directly tested.**  
  File: `test/analysis-run.test.ts`, `"a failed second opinion keeps the first reading..."`  
  The test creates a new `unreviewed` record during the run. It does not load the previously serialized Rogue Legend #5-style record and prove it is reused with zero producer/reviewer calls. Consequently, incompatibilities involving the historical record shape, schema version, `final` field, or plan filtering could regress unnoticed.  
  **Suggested fix:** seed the records file with an existing current-schema `unreviewed` record containing the producer reading, run analysis, and assert it is usable and no provider is called for that image.

- **Low — the cached-clamping test does not exercise a legacy out-of-range cache entry.**  
  File: `test/regions.test.ts`, `"a model answer with a box slightly out of range..."`  
  The first call clamps the response before writing it, so the second call merely reads an already-clamped cache object. It does not verify the important migration path where an older cache file itself contains an out-of-range region.  
  **Suggested fix:** write a `StoredObject` containing the overshooting output directly at the expected object-cache path, invoke `analyseImages`, and assert clamping occurs without a provider call.

Verdict: **Changes requested—the capture-region path still violates the clamping requirement, while legacy record/cache behavior needs explicit regression coverage.**
## Disposition (Claude, 2026-09-28)

| Finding | Decision |
|---|---|
| High: a nonsensical capture box still fails the whole reading | Fixed. A capture with a nonsensical box keeps the capture but loses its position, like texts, masks and elements do. The capture count stays intact, so the composition checks still hold. No code reads capture positions. New test: a capture far outside the image passes the checks after clamping. |
| Medium: reuse of a saved "unreviewed" record is not tested | Fixed. The test now plans and runs again after the failed second opinion. It asserts 0 new images and no producer call. The real Rogue Legend #5 record was also checked on the workspace: usable, and the next pilot has 0 new images. |
| Low: the cache test does not cover an old out-of-range cache entry | Rejected. `validatedCall` stores the raw model output, not the clamped value, so the second call already reads a cache file with the out-of-range box and clamps it again. The test comment now says so. |

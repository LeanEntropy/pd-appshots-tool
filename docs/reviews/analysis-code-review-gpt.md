# Analysis implementation: cross-family code review (gpt-5.6-sol)

- Reviewer: `codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral`, prompt on stdin with the requirements, the implementation plan, all new and changed source files, the v2 prompts and the new tests inlined.
- Date: 2026-09-27. Reviewed code: before the fixes listed at the end.

## Reviewer output (verbatim)

Correctness bugs

- **High** — `src/util/proc.ts`, `npmShimTarget`: the regex does not recognize standard npm shims using `"%~dp0\..."`. Such shims fall back to `cmd.exe`, potentially recreating the Windows argument-mangling failure. Fix the parser to support `%~dp0` syntax and test against an actual npm-generated `.cmd` shim.

- **High** — `src/analysis/settle.ts`, `applyDecision`: when adjudication changes `marketingLayerPresent` to `true` but both readings marked it absent, the returned layer remains `present:false`; the adjudicator’s decision is silently ignored. Construct a consistent `present:true` layer or reject the decision for repair.

- **High** — `src/analysis/patterns.ts`, `findPatterns`: `Math.min(...lengths, 0)` makes `deckLength.min` always `0`. This corrupts reports and recommendation-length bounds. Use `lengths.length ? Math.min(...lengths) : 0`.

- **Medium** — `src/analysis/settle.ts`, `applyDecision`: changing a layer to absent clears masks/text/elements but retains `mainColours` and `relationToScreen`. Fix by also setting `mainColours: []` and `relationToScreen: "none"`.

- **Medium** — `src/analysis/schema.ts`, `semanticProblems`: absent marketing layers can pass validation with nonzero coverage, colours, a non-`none` relationship, or a headline. Enforce `coveragePercent === 0`, all layer arrays empty, `mainColours` empty, `relationToScreen === "none"`, and an empty headline where appropriate.

- **Medium** — `src/analysis/run.ts`, `runAnalysis`: if `imagesPerCall > 1`, records are written only after the entire chunk—including review/adjudication—finishes. A crash loses completed per-image work. Force chunk size `1` for this workflow or persist each completed image inside `analyseChunk`.

Gaps against requirements

- **Medium** — `src/analysis/job.ts`, `JobState`: persisted status has no explicit `aborted` field, despite the requirement that job state retain it. Add `aborted: boolean` or the specified structured equivalent and persist it separately from generic `error`.

- **Medium** — `src/analysis/ours-vs.ts`, `compareOurs`: overall orientation compares canvas orientation only, not the analysed screenshot/capture orientation. Add comparison using `final.screenshot.orientation`.

- **Low** — `src/analysis/orders.ts`, `compareOrders`: retyping is compared by position, not by image identity. A moved image can be reported as both moved and “type became …” because different images occupied that position. Compare derived types for matching `imageId`, and separately report replacements at a position.

Risky choices

- **Medium** — `src/util/proc.ts`, `run`: unknown `.cmd`/`.bat` files still use `shell:true` with hand-built quoting. Even the restricted character set has fragile Windows quoting cases, especially paths ending in backslashes. Prefer explicit `cmd.exe /d /s /c` construction with tested quoting, or reject unknown batch shims entirely.

- **Low** — `src/analysis/providers.ts`, `codexProvider`: temporary output files are removed only when reading succeeds. Failures can accumulate files in `%TEMP%`. Put cleanup in `finally`.
## Outcome

Fixed:
- `proc.ts` `npmShimTarget`: now accepts both npm templates (`"%dp0%\..."` and older `"%~dp0\..."`); new test for the older one. Unknown `.cmd`/`.bat` also refuses arguments ending in a backslash.
- `patterns.ts`: `deckLength.min` was always 0 (`Math.min(...lengths, 0)`); fixed.
- `settle.ts` `applyDecision`: turning a layer off now also clears its colours and sets the relation to "none". If the adjudicator says there is a layer that neither reading described, the record stays "disputed" with that problem (not usable; retried next run) instead of silently ignoring the decision.
- `schema.ts` `semanticProblems`: with no marketing layer, coverage must be 0, layer colours empty, relation "none" and the headline empty (sent back for repair otherwise).
- `job.ts`: explicit `aborted` flag in the persisted status (also set on a crash).
- `ours-vs.ts`: overall comparison now also compares the in-game capture orientation.
- `orders.ts` `compareOrders`: type changes are compared per image, and a replaced image is reported as "new image (type, was type)", so a move is no longer also reported as a type change.
- `providers.ts` `codexProvider`: the temp output file is removed in `finally`.

Not changed:
- Records written only after a whole chunk when `imagesPerCall > 1`: the default and the project config are now 1 (one image per call, saved immediately). Deck calls stay available only as an explicit cost setting.
- Unknown `.cmd` files through cmd.exe: kept, but only with plain arguments (no quotes, `%`, `^`, `&`, `|`, `<`, `>`, newlines, trailing backslash, max 2,000 characters). Both real CLIs here are resolved without cmd.exe (`claude.exe` directly, `codex.cmd` as `node codex.js`).

# Core pilot, gallery server and comparison grid: cross-family code review (gpt-5.6-sol)

- Reviewer: `codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral`, prompt on stdin with all new source files, prompts, the slash command, config and tests inlined, plus the requirements.
- Date: 2026-09-27. Reviewed code: before the fixes listed at the end.

## Reviewer output (verbatim)

## 1. Correctness bugs

### Critical

1. **`src/analysis/run.ts` — `runAnalysis`: two cost tiers are never executed**

   The function filters only `tier === "full"`. It never processes `layer-diff`, and it does not create or copy records for `identical` items. Approval can therefore promise layer-diff work that never occurs, while the report may misleadingly label missing identical results as “reused.”

   **Fix:** implement separate layer-diff execution using `config.models.layerDiff`; materialize reused records for identical items; include both in progress, reports, and gallery summaries.

2. **`src/analysis/run.ts` — `runAnalysis`: reviewer failures are silently accepted as `ok`**

   If the required blind review fails validation or execution, `reviewed.readings` is empty. The producer result is then recorded as `ok`, despite the configured 100% review coverage.

   **Fix:** retain `reviewed.failed`; mark required-but-failed reviews as `failed` or another explicit incomplete status, and do not count them as successfully cross-checked.

3. **`src/analysis/run.ts` / `src/analysis/call.ts` — budget enforcement can overspend substantially**

   The aggregate budget is checked only before/after a whole chunk. A chunk can perform three deck attempts, per-image fallbacks with three attempts each, a reviewer pass, and adjudication. Every Claude call independently receives `$3`, even when less remains. Codex usage is not costed at all.

   **Fix:** check remaining budget before every attempt; pass `min(perCallLimit, remainingBudget)`; stop retries/fallback/review/adjudication when exhausted. Define and enforce how GPT cost/tokens participate in the cap.

### High

4. **`src/analysis/plan.ts` — `buildAnalysisPlan`: cap total counts unrelated historical records**

   `alreadyInCore` counts every usable record for the market, including games no longer in the selected core. This can falsely block a valid batch. Conversely, it does not clearly represent the approved plan’s resulting unique core set.

   **Fix:** derive the post-run core total from the current fitted games and their unique usable/planned images only.

5. **`src/analysis/plan.ts` / `src/analysis/job.ts` — approval hash does not cover all displayed numbers**

   `planHash` omits the cap, cost-estimate settings, `imagesPerCall`, computed estimate, exclusions, and displayed game metadata. Changing estimate rates or call chunking can change the shown cost/pass counts without changing the hash.

   **Fix:** hash a canonical form of every approval-visible and execution-relevant field, excluding only `createdAt` and the hash itself.

6. **`src/view/gallery-picker.ts` — autosaves can overwrite newer choices**

   Saves are neither serialized nor versioned. An older request can finish after a newer request and become the persisted selection. `loadSaved()` can also overwrite a user edit made while the initial GET is pending.

   **Fix:** serialize saves or attach monotonic revisions rejected server-side; ignore stale responses; do not apply the initial load after local interaction begins.

7. **`src/analysis/plan.ts` / `src/core/targets.ts` — US English is not guaranteed**

   The core market is selected by country alone. The schema permits more than one language for `us`, and nothing requires the pilot market to be `us/en`.

   **Fix:** configure and resolve the core market by `{gl, hl}`, and validate the pilot requirement as `us` plus `en`.

### Medium

8. **`src/analysis/schema.ts` — semantic validation is incomplete**

   It accepts negative or excessive `heightPercent` and `occlusionPercent`, boxes where `x + w` or `y + h` exceed 100, malformed colour hex values, and adjudication results with duplicate/unknown references.

   **Fix:** encode numeric bounds in Zod and add full adjudication reference checks equivalent to `semanticProblems`.

9. **`src/analysis/run.ts` — progress totals are incorrect**

   `total` is only `full.length`. It omits layer-diff work and model passes, and `done` increments only for full images. Once layer diff is implemented, the displayed progress will remain wrong.

   **Fix:** define progress in terms of all planned non-identical images or expose separate per-pass totals.

10. **`src/view/gallery-picker.ts` — live whole-deck count is missing**

    The live panel uses only `analysedLength`. The whole-deck total including excluded device classes appears only later in the server save message.

    **Fix:** include raw/whole deck length in the view model and calculate/display the same live whole-deck count as the server.

11. **`src/analysis/tiers.ts` — “same picture in another locale” is not available for this core-only plan**

    `buildAnalysisPlan` supplies only the core-market deck. With the configured US-English core, new plan items are baseline items, so they cannot enter `layer-diff`; previously analysed localized records are not new plan inputs.

    **Fix:** either plan localized expansion images where the tier applies or remove the unreachable tier from this stage’s approval claims.

---

## 2. Safety of the approval gate

### Exact approval before AI calls

**Not fully sound.**

- The page UI calls `/api/analysis/run` only from “Approve and run,” and the saved/current hash comparison correctly detects changed item lists, models, prompt versions, taxonomy, and review settings.
- However, the hash does not cover all exact numbers shown, especially estimated cost, call counts, cap, and exclusions. A run can therefore start after those numbers changed without renewed approval.
- The HTTP endpoint itself does not prove a button click. Any same-origin script or local process can POST a valid saved hash.
- Saved approvals are reusable. There is no one-time nonce or consumed state, so the same approved plan can be started again after a completed run while it still contains new work.

**Fix:** hash the complete displayed plan, issue a short-lived one-time approval token, bind it to stage/hash, and consume it atomically when the run starts.

### Can another website trigger a run or write files?

**Ordinary cross-origin browser attacks are partly blocked, but the server is not fully hardened.**

- Binding to `127.0.0.1`, checking `Host`, requiring JSON, and the absence of CORS headers prevent common form and `no-cors` JSON attacks.
- There is no `Origin`/`Sec-Fetch-Site` validation or CSRF token.
- Any HTML under `views/` is served as active same-origin content. A malicious or unexpectedly generated HTML file in that directory can call selection and run APIs.
- `gallery-html.ts` interpolates `vm.coreMarket.label` and `vm.runId` into HTML without escaping. A malicious local config or manifest can inject same-origin script and invoke privileged APIs.
- `/api/selection` writes the run config without user confirmation by design; any same-origin script can therefore write it.

**Fix:** serve only the generated gallery HTML rather than arbitrary `views/*.html`; escape all server-rendered text; validate `Origin`; add a per-server random CSRF token to the page and require it for every POST.

### Budget guard

**Unsound.**

It is reactive, checked too coarsely, allows large retry/fallback overshoot, gives every Claude invocation a fresh `$3` allowance, and cannot account for Codex spend. See correctness finding 3.

---

## 3. Spec compliance

### Picker

- Mouse/touch pointer reordering: **compliant**.
- Keyboard reordering: **compliant**.
- Autosave through a Zod-validated POST: **compliant**, subject to stale-write races.
- No JSON download: **compliant**.
- `npm run gallery` starts server and opens browser; reopening the URL later works while the process remains alive: **compliant**.
- `select` fallback: **compliant**.
- Live whole-deck count: **not compliant**; only analyzed-device count is live.

### Comparison grid

- Ours first, selected competitors in priority order: **compliant**.
- Store-position alignment: **compliant**.
- Game/deck length and position headers: **compliant**.
- Consistent thumbnail height and full-size links: **compliant**.
- Tablet marking and greying exclusions: **compliant**.
- Live updates: **compliant**.
- Grid-local horizontal scrolling: **compliant**.

### Approval flow

- “Start analysis” prepares a no-AI plan: **compliant**.
- Cost tiers, passes, estimated cost, games and positions displayed: **mostly compliant**, but the plan does not guarantee those exact displayed numbers in its hash.
- Button starts the server job and status polling: **compliant**.
- No AI without exact approval: **not compliant**, due to incomplete hashing and replayable/direct API execution.
- `/analyze` alternative: **compliant in documented workflow**.
- `npm run pilot` shows approval: **compliant**.

### CORE PILOT

- Ours plus first two picked: **compliant for the supplied config**, but configurable away from two.
- US English: **not enforced**.
- Phone only: **compliant for the supplied config**, but configurable away from phone-only.
- Fable 5.1 full analysis and required Claude flags: **compliant for the supplied config**.
- gpt-5.6-sol blind review and required Codex flags: **compliant for the supplied config**.
- Opus 5.5 adjudication: **compliant for the supplied config**.
- Zod, semantic checks, two repairs, per-image fallback: **partially compliant**; semantic checks are incomplete.
- Content-addressed cache fields: **compliant**.
- Versioned prompts/schemas: **compliant**.
- Cost tiers: **planning exists; execution is not compliant** because layer diff and reuse are missing.
- Markdown report and gallery summaries: **partially compliant**; full-analysis records appear, but unimplemented tiers do not.
- Plan-v2 statuses: **type names exist**, but `corrected` is never produced and review failures can be mislabeled `ok`.
- Different reviewer family: **enforced by config validation**.
- Never gpt-6-astra for reviews: **not compliant**. `imageReviewSpecial` explicitly permits and configures `gpt-6-astra`, contradicting “Never gpt-6-astra for reviews.”

---

## 4. Rule violations

- **TypeScript strict / no `any`:** no explicit `any` found. The large JavaScript template strings receive no TypeScript type checking, which weakens strictness but is not a literal `any` violation.
- **Maximum 300 lines:** no violation; the longest shown file is 274 lines.
- **Biome:** no definite violation can be established from the excerpts. Several generated-script lines are very long, but that is formatter-policy dependent.
- **No emojis:** no violation.
- **Plain-language user-facing text:** violations exist:
  - `gallery-script.ts` displays package IDs and internal tier values such as `same_audience`.
  - `gallery-grid.ts` shows internal labels “pilot” and “not in core.”
  - `gallery-analysis.ts` may expose raw internal exception/error strings.
  - `schema.ts` validation problems use internal references such as `img1`; acceptable for repair prompts, but they should not leak directly to end users.

---

## 5. Minor suggestions

- Disable “Start analysis” while a selection save is pending.
- Set `shownPlan = null` whenever the selection changes.
- Add `rel="noopener"` to full-size image links.
- Validate the gallery port as a finite integer in range.
- Add tests for estimate-only config changes, approval replay, concurrent autosaves, reviewer failure, layer-diff execution, and aggregate retry-budget overshoot.
- Distinguish “not reviewed,” “review failed,” and “review agreed” in reports.
## Resolution (by the implementing agent)

### Fixed
| # | Finding | Fix |
|---|---|---|
| Bug 1 (part) | Layer-diff tier planned but never executed | Approval is refused for any batch with layer-diff images ("arrives with the country expansion step"); unreachable in the US-English pilot/core. Identical images need no new record: records are keyed by image content, so the earlier record is shared; the report now reads all records, so reused images show their analysis |
| Bug 2 | Failed second opinion recorded as `ok` | New status `unreviewed` (not usable in statistics) with the reason in `problems`; test added |
| Bug 3 (Claude side) | Budget checked too coarsely; each call got a fresh $3 | Every attempt checks what is left of the batch limit and gets at most that (`--max-budget-usd min(3, left)`); retries, fallbacks, review and settling all stop at zero; test added |
| Bug 4 | Core total counted records of games no longer in the core | Counts only analysed images of the current fitted core decks, plus the batch |
| Bug 5 / Gate | Fingerprint missed some displayed numbers | The fingerprint is now the hash of the whole plan (all counts, estimate, passes, cap, exclusions, games, models, versions, review, estimates, budget); test added |
| Bug 6 | Autosaves could overwrite newer choices | Saves are serialised in order with a revision number; stale responses ignored; the initial load no longer overrides a pick the user already changed |
| Bug 7 | Core market resolved by country only | Config validation requires `core.market` to match exactly one market (one language) |
| Bug 8 | Semantic checks incomplete | Region boxes must fit inside the image, percentages 0-100, colour hex or "unknown"; adjudication must decide every sent image exactly once and nothing else |
| Spec: live whole-deck count | Only the analysed count was live | Panel shows both, live |
| Gate: other pages | Any `views/*.html` served same-origin | Only the generated gallery page is served as HTML; `.html/.svg/.js` under static folders are refused; test added |
| Gate: CSRF | No token or Origin check | Per-server random token in the page, required as a header on every POST (also forces a CORS preflight); Origin must be this server; tests added |
| Gate: escaping | runId, market label, project unescaped | Escaped |
| Plain language | "pilot", "not in core" tags | "in the pilot", "not in the core check" |
| Minor | Approval panel after a pick change; noopener; port validation | Changing the pick withdraws a shown approval panel; `rel="noopener"`; port validated |

### Declined, with reason
| # | Finding | Reason |
|---|---|---|
| Bug 1 (part) | Implement layer-diff execution now | Belongs to the country expansion milestone; blocked by the approval gate until then |
| Bug 3 (Codex side) | Count GPT spend in the dollar cap | Codex runs on the ChatGPT subscription and reports no dollar cost; the approval screen shows GPT tokens separately |
| Bug 9 | Progress totals omit layer diffs | Layer diffs cannot run yet (see Bug 1) |
| Gate: one-time approval token | Replay of an approved plan | A completed batch changes the plan (its images become "identical"), so the same fingerprint no longer matches; a budget-stopped batch also changes. A replay therefore cannot re-run the same work |
| Spec: never gpt-6-astra | `imageReviewSpecial` is Astra | The user's rule is "never Astra for plan, code or document reviews"; Astra is allowed for special image-review cases (PILLARS). It is not used by the pilot and config validation blocks it in every other role |
| Spec: `corrected` never produced | | Corrections come from imported feedback (final-report milestone) |
| Rules: package ids shown in the gallery | | Kept as secondary metadata next to the plain game name, useful for checking the right app |

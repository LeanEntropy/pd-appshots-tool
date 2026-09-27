# Cross-family review of plan-v2.md + product-proposal-v2.md (GPT)

- Reviewer: `gpt-5.6-sol` via `codex exec -m gpt-5.6-sol -s read-only --ephemeral` (Codex CLI 0.153.4), 2026-09-26. `gpt-6-sol` does not exist on the account; the first attempt with it returned 400.
- Input (inlined): plan-v2.md, product-proposal-v2.md, PILLARS.md, vision-models-bakeoff.md, FINDINGS.md, ASSETS.md, and the user decisions for v2. Prompt: scratchpad `review-v2-prompt.md`.
- Reviewed the version before the coordinator's model-role correction (Sol as default GPT reviewer, no `gpt-6-sol`); that correction was applied afterwards.
- Verbatim output below. Findings are NOT applied; the orchestrator decides.

---

1. **Critical — gap-vs-requirement — §1 Core check / §12 Milestones.** There is no deterministic rule ensuring 5–8 complete competitor decks fit under the hard cap; “process in priority order” could hit 100 midway through a deck or leave fewer than five competitors. **Fix:** during setup, select the largest priority-ordered set of 5–8 whole decks that fits the cap, show it before approval, and refuse to start if even five complete decks plus the canonical own deck cannot fit.

2. **Critical — wrong-assumption — §6 Slot count.** The plan calls eight “the Play phone maximum,” but the feasibility evidence found live decks with 10 and 13 screenshots. This could corrupt deck-length handling or reporting. **Fix:** preserve and analyse complete decks of any observed length; cap only the recommendation at eight, explicitly as a product constraint rather than a Play maximum.

3. **High — gap-vs-requirement — §5 Ingest our local files / §12 Core estimate.** The plan says all 11 local rasters are ingested, while the core estimate counts only seven own images and does not define whether the live deck, local variants, or both are AI-analysed. That ambiguity can silently consume or exceed the 100-image cap. **Fix:** define one canonical own comparison deck, deduplicate it against the live deck, classify the remaining local assets as reference-only, and show their exact contribution to the cap.

4. **High — gap-vs-requirement — §1 Approval gate / §12 Milestones.** Setup downloads and processes hundreds of images before its checkpoint, although the governing rule says the tool shows the image count and obtains approval before every step. **Fix:** add a setup preflight showing download counts, expected disk use, and zero AI images, then require approval before downloading; put the competitor-list checkpoint before core planning.

5. **High — cost — §1 Approval gate / §§12–13 Review coverage.** Approval displays work-list images per tier, but does not separately expose that every core image is also sent to Astra for a second vision pass. “85 images” can therefore conceal roughly 170 model-image exposures. **Fix:** show both unique images counted against the cap and model-image passes by model, including reviews, retries, and estimated tokens/cost.

6. **High — failure-mode — §§1–2 Country expansions.** A localized screenshot can use the cheap diff tier only when that app’s English image has already been analysed. The plan does not account for prerequisites when a user selects a country for a non-core competitor or picks a chart game. **Fix:** expansion planning must add and display any required English baseline analysis, or classify the selected localized image as full analysis; include prerequisites in the same approved increment.

7. **High — wrong-assumption — §§3–4 Models / Proposal 18.** `gpt-6-sol` is named as an option and as the build reviewer, but the bake-off says that slug does not exist; the available model is `gpt-5.6-sol`. **Fix:** replace every `gpt-6-sol` reference with `gpt-5.6-sol`, including proposal choices and validation tests.

8. **High — gap-vs-requirement — §3 Models / §9 Config / Proposal 18 and 40.** Recommendation review is described as pending a second bake-off, yet the executable config already defaults to Terra. The evidence also identifies a systematic Terra classification failure and recommends Sol as the stronger proxy. **Fix:** make the reviewer unset until the bake-off decision, or label `gpt-5.6-sol` as the explicit provisional default; validation must block production recommendations while the choice remains unresolved.

9. **Medium — failure-mode — §2 Same-capture detection.** The capture matcher depends on AI-produced English marketing-region masks, but no acceptance criteria establish that those masks are accurate enough to prevent changed gameplay from being mistaken for a marketing-only difference. **Fix:** validate capture matching during the pilot against labelled positive and negative pairs, publish false-match results and thresholds, and route any uncertainty to full analysis.

10. **Medium — cost — §12 Core estimate.** The estimate assumes per-image Fable and Astra usage even though production sends whole decks per call; the bake-off measured single-image calls only. Retry, fallback, and deck-attention costs are not bounded. **Fix:** label the estimate provisional and calculate the approval estimate from the pilot’s actual deck-call, fallback, retry, and review measurements.

11. **Medium — wrong-assumption — §2 Identical tier / Proposal 10.** Byte-identical screenshots justify calling the screenshots unlocalized, not the whole store page. The listing text or other assets may still be localized. **Fix:** use “screenshot unchanged from English” or “screenshot deck unlocalized,” never “page unlocalized.”

12. **Medium — gap-vs-requirement — §6 Stability.** Stability is computed over `1..N`, but `N` is recalculated from the growing deck pool, so the compared slot set can change between iterations and make the two-deck stability window ill-defined. **Fix:** freeze the evaluated slot range for each stability window or compare only slots present throughout the window, and report coverage per slot.

13. **Medium — other — Product proposal §H.** Several settled requirements are incorrectly presented as open decisions, including the hard cap, whole-deck calls, and review coverage/model policy. This invites reversal of decisions the proposal is supposed to encode. **Fix:** move settled items 37, 39, and the decided portion of 40 to “Already decided”; leave only genuinely open choices, each with one recommended default.

14. **Low — plain-language — §4 Operator commands.** User-facing command names such as `analyze`, `expand`, and `review` are still implementation-oriented and do not clearly communicate the approval checkpoint or scope. **Fix:** in the UI and reports use phrases such as “Plan the core check,” “Choose an expansion,” and “Approve this image batch”; retain CLI names only in technical documentation.

**Verdict: rework.**
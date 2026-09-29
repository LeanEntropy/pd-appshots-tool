# Review: plan-cross-country.md (gpt-5.6-sol)

Date: 2026-09-29. Reviewer: gpt-5.6-sol via `codex exec -s read-only --ephemeral`. The plan, the pillar excerpts, plan-reports 1.1/2.3/3/3B.2/4, the layout plan 0/5/6/8, the R4 code excerpts and the in-flight branch file lists were passed inline. Reviewed version: the first draft of 2026-09-29. What was applied or declined is at the end of the plan.

1. **High — §2.2, “main country is never derived”**  
   **Problem:** This contradicts “a per-country report for each country.” A Full check is not necessarily equivalent to the main-country slice: it may use different competitors, snapshots, or Pilot-only data.  
   **Fix:** Derive a report for every selected country, including the main country, unless an existing report has exactly the same frozen scope and fingerprint. Otherwise link the exact equivalent version rather than assuming the Full check is interchangeable.

2. **High — §2.2/§2.4, narrowed `version.json` and fingerprint**  
   **Problem:** The proposed child report depends on data outside the child country: main-country recommendations, main-country images and analyses used for localisation, terminology concept maps, comparison-wide A/B evidence, and later group findings. Narrowing provenance to only the child country makes staleness checks unsound.  
   **Fix:** Store two scopes: `displayScope` for the country and `dependencyScope` containing every pinned input that influenced its content. Compute staleness from the dependency fingerprint, with separate reasons such as “Japan changed” and “the US baseline changed.”

3. **High — §2.2/§2.3, “slice, never rebuild”**  
   **Problem:** A raw slice is not always semantically valid. Comparison advice and A/B wording may reference other countries, pooled evidence, group conclusions, or comparison-specific framing. This becomes especially certain after C3 adds group evidence to country advice.  
   **Fix:** Define a versioned, deterministic projection schema. Only reuse fields whose structured evidence and target countries remain valid; rewrite headings, setup, controls and summaries by code. Exclude cross-country prose unless it can be projected without changing its meaning. Test that no omitted country or group remains referenced.

4. **High — §2.3/§2.4, optional “Write A/B tests for Japan alone”**  
   **Problem:** The plan does not say how this paid result is saved without modifying the immutable derived version. Adding it to the existing report would violate write-once versions.  
   **Fix:** The button must show approval and then create a new immutable “Built alone” version with a complete approved manifest, AI run ID, prompt/schema versions, dependency fingerprint and provenance. Never patch the sliced version.

5. **High — §3.4 rules 3–7, statistical evidence**  
   **Problem:** “Three games, 60%, net change 3” is not a statistically defensible noise-control method. With as few as five known games, 3/5 passes; across 13 dimensions, several values, positions and up to four overlapping groups, false discoveries are likely. Calling the list “fixed” does not remove multiple-comparison risk.  
   **Fix:** Predefine a small set of primary contrasts, require a materially larger effective n, report effect sizes and uncertainty, and apply a multiplicity procedure such as Benjamini–Hochberg across all tested group/value contrasts. Treat the remaining dimensions as explicitly exploratory.

6. **High — §3.4 rule 4 and §3.6 wording**  
   **Problem:** Failure to find three paired changes is labelled “the same as the main country.” Failure to detect a difference is not evidence of equivalence, particularly at n=5–8.  
   **Fix:** Use three outcomes: “evidence of a difference,” “evidence of practical equivalence” under a predefined equivalence margin and adequate sample, and “not enough evidence either way.” “Not an Asian habit” is too strong unless equivalence is established.

7. **High — §3.4, paired comparison definition**  
   **Problem:** “Toward minus away ≥3” ignores the number of discordant pairs and produces inconsistent strength across sample sizes. Three toward and zero away is treated the same whether based on 3, 8 or 30 usable games.  
   **Fix:** Use an exact paired test appropriate to the dimension—McNemar/exact binomial for binary values—and report discordant counts, paired n, effect size and interval. Define methods for categorical, ordinal and continuous dimensions separately.

8. **High — §3.4 rules 2–3, group aggregation**  
   **Problem:** Taking each game’s modal value across countries, dropping ties, and then also requiring the value to be most common on every page mixes two different estimands. It can hide country heterogeneity and selectively reduce denominators. “Most common on every page” also lacks a per-page minimum/share rule.  
   **Fix:** Choose one explicit estimand. Prefer a hierarchical table retaining `game × independent page`; require the threshold separately in every country/page cluster and report the worst-country effect. Count mixed games transparently rather than silently omitting them.

9. **High — §3.1/§3.4, same-page merging**  
   **Problem:** Page identity is game-specific. Taiwan and Hong Kong might be identical for six games but different for two, so merging the countries globally is invalid. Exact content hashes also miss byte-different copies of the same visual.  
   **Fix:** Form equivalence clusters separately for each game, including order and deck length. Use exact hashes first, then conservative perceptual matching with explicit ambiguity handling. Report the resulting effective page count per finding.

10. **High — §3.4 rule 8, duplicate removal**  
    **Problem:** Removing “repeated screens” before all shares can erase meaningful variants: the same gameplay capture may have a different headline, logo, composition, crop or marketing layer. That biases precisely the dimensions being analysed.  
    **Fix:** Deduplicate per dimension. Exact duplicate assets may be removed globally; screen-level duplicates may be removed only for “different underlying screens.” Preserve distinct marketing overlays for text, logo, layout, localisation and composition measures.

11. **High — §3.7 examples, one-variable A/B rule**  
    **Problem:** “Open with the title art and the logo” changes at least screen/order and logo, violating the authoritative one-variable rule. The plan repeats this combined recommendation and test in several examples.  
    **Fix:** Split it into separate candidates: title-art/order test and logo test. Ensure schematics and generated variants change exactly the declared field and are rejected if another field changes.

12. **High — §3.7, evidence-to-recommendation logic**  
    **Problem:** A habit that is common everywhere but does not differ from the main country is still turned into an “East Asia” recommendation. That evidence supports a per-country competitor gap, not a cross-country group-specific practice.  
    **Fix:** Label evidence types separately: `group-specific shift`, `common across all markets`, and `our-country inconsistency`. Only the first can justify a group-specific conclusion; the others can support a multi-country rollout recommendation with different wording.

13. **High — §3.7, traffic pooling**  
    **Problem:** The plan asserts that a group “pools its countries’ visitors,” but only ordinal per-country traffic settings exist. Several “low” countries do not establish adequate pooled traffic, and language/listing experiments may not produce one interpretable pooled population.  
    **Fix:** Do not infer traffic sufficiency by adding categorical levels. Keep the conservative low/unknown rule unless numeric traffic or experiment-level eligibility is supplied. Explain that Play Console determines sample size and significance.

14. **High — §0, §6 C3, approval and cost completeness**  
    **Problem:** The $1.00–$2.40 estimate adds nominal calls but does not state whether validation retries, revision after cross-family review, provider/model choice, or failure retries are included in the authorised maximum. “About” is insufficient for the rule that every AI step is priced before processing.  
    **Fix:** Calculate the approval from the frozen call plan, listing every writer, reviewer and possible validation retry with model, call/image count and capped maximum. No provider invocation—including a reviewer, retry or layout backfill—may occur before that explicit approval.

15. **Medium — §8 approval tests**  
    **Problem:** Tests cover a “0-image text run” approval display but do not prove the stronger invariant that no AI provider can be called without a matching unspent approval.  
    **Fix:** Add integration tests in which advice, review, retry, country-only A/B, C3 regeneration and layout backfill all fail closed without approval. Verify approved maximum enforcement, cancellation, resume and attempts after the budget is exhausted.

16. **Medium — §2.3, reused A/B tests**  
    **Problem:** Checking that an evidence item includes Japan is insufficient. A comparison test may rely jointly on Japan and Korea, quote a pooled n, describe a multi-country control, or contain a variant unsuitable for Japan alone. Recomputing only Play setup does not repair those semantics.  
    **Fix:** Reuse a test only if its structured evidence contains a valid country-specific estimate and its hypothesis/variant is country-independent. Recompute displayed n, control, setup and evidence wording from structured data; otherwise use the code-written candidate.

17. **Medium — §2.4, regenerate and cache claims**  
    **Problem:** “Free and instant when nothing new is needed (cached AI)” conflicts with the plan’s own observation that single-country inputs differ from comparison inputs and miss the cache. A new normal country build may require fresh advice, terminology or A/B calls.  
    **Fix:** Run the normal planner first and promise “free” only when every exact versioned input hash is a cache hit. Otherwise show all missing AI work and obtain approval.

18. **Medium — §2.2/§2.4, parent lifecycle and consistency**  
    **Problem:** Automatically adding child versions after the parent is Ready creates a partially committed multi-report operation. A crash can leave some countries missing, while deletion/unlinking mutates multiple definitions with no recovery design.  
    **Fix:** Use an idempotent derivation manifest recording expected children and completion state. Recover safely on reopen, and test failures after each write. Never expose a Ready parent as having complete derivatives until reconciliation finishes.

19. **Medium — §2.4, deletion and `derivedOff`**  
    **Problem:** Recording a deleted child in the parent’s `derivedOff` couples independent report lifecycle state and becomes ambiguous after the parent is deleted, restored or versioned. Archive behavior is said to follow “the same pattern” without defining whether future versions resume.  
    **Fix:** Store derivation preferences in a stable project-level relationship record, with explicit states such as active, suppressed and detached. Define restore and new-parent-version behavior and test each transition.

20. **Medium — §9, branch conflicts**  
    **Problem:** The conflict table understates storage overlap. C1 explicitly changes report types/store and version writing while `feat/layout-capture` and `perf/project-open` both modify `storage/types.ts` or storage behavior. It also assumes an API from `feat/deck-duplicate-check` before that branch has code.  
    **Fix:** Freeze and merge shared interfaces first: report save hook, storage schema, layout record references and `distinctSlots` semantics. Rebase after both storage branches, then run schema compatibility, project-open performance and write-once integration tests. Do not implement against a hypothetical function contract.

21. **Medium — §8, missing statistical tests**  
    **Problem:** Fixture tests check threshold examples but not denominator sensitivity, missingness bias, overlapping groups, categorical ties, equivalence claims, multiple-comparison correction or unstable results caused by one game.  
    **Fix:** Add property-based and adversarial tests covering missing-not-at-random positions, page-cluster changes, one-game leave-out sensitivity, overlapping groups, exact paired tests, adjusted significance and deterministic ranking.

22. **Medium — §4, category explanations**  
    **Problem:** C0 addresses only “new labels,” while the requirement applies to every image category used in every report. A thumbnail alone also cannot explain “same pages” or a paired change; those require side-by-side examples.  
    **Fix:** Audit every rendered report label, including existing screen types and composition categories. Centralise definitions with plain distinction text and appropriate visual examples—single thumbnail for a category, paired thumbnails for localisation/change concepts.

23. **Low — §4/§5, flags and UI examples**  
    **Problem:** The mock-up uses `[JP]`/`[KR]`, which could be mistaken for text tokens, while the requirement mandates real flag images and forbids internal codes in user-facing text. It also does not explicitly verify PDF/export rendering.  
    **Fix:** Specify accessible flag-image components only in headings/card titles, with country-name alt text. Test HTML, markdown and PDF outputs; treat bracketed country codes and flag emoji as failures everywhere.

24. **Low — §2 and §6, over-engineering**  
    **Problem:** Materialising roughly identical report files, mixed “from comparison”/“built alone” histories, cascade prompts, `derivedOff`, backfill and bidirectional links creates substantial lifecycle complexity for what is fundamentally a filtered projection.  
    **Fix:** Consider immutable projection records that reference the parent version plus a small saved country-specific overlay, while still presenting independent country cards and exports. Materialise a complete standalone snapshot only when exported, detached or rebuilt independently. If full copies are retained, justify them with measured performance and offline/export requirements.

**Verdict:** The plan has strong product instincts—country cards, explicit provenance, bottom-line-first wording, deterministic evidence and honest handling of the current dataset—but it is not ready for approval. The two central claims are currently unsound: a narrowed slice does not capture all inputs that influenced the derived report, and the group thresholds do not justify claims of difference or sameness under small n and multiple comparisons. Resolve dependency provenance, immutable paid updates, exact country inclusion, dimension-specific deduplication, paired statistical inference and one-variable A/B enforcement first. The lifecycle machinery for copied reports is also over-engineered and should be simplified or made transactionally robust before implementation.
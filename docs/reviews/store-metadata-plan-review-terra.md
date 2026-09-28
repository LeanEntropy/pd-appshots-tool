# Review of plan-store-metadata.md (gpt-5.6-terra, 2026-09-28)

Applied and declined findings are listed in the plan, section 7.

1. **High — `categories` are treated as stable tags.** The sample is too small; Play chips can vary by listing, locale, or scraper output. Fix: store raw scraper fields plus normalized `{id?, name}`; do not claim tags are country-invariant.

2. **High — “not sold” is discarded, causing endless backfill retries.** A missing page remains eligible forever and is indistinguishable from never attempted. Fix: persist a small status record per app/country-language for `not-found` and retryable/non-retryable errors, with timestamps and retry policy.

3. **High — one snapshot per calendar date loses meaningful changes.** Preview and download can overwrite different page states on the same day, while `fetchedAt` suggests precision that storage does not retain. Fix: either make snapshots append-only using a timestamp/content hash, or explicitly preserve the first/latest snapshot plus a documented overwrite audit.

4. **High — the download snapshot is misleading.** It writes preview data under the download date even though it was fetched earlier; it is not a download-time read. Fix: retain the original `fetchedAt` and label it as preview-fetched, or avoid creating a second snapshot unless the text was actually read again.

5. **High — “nowhere in our text” is not a fair competitor comparison.** Derived top keywords are filtered/scored, whereas “nowhere” needs normalized matching against the complete source text. It also misses inflections, segmentation variants, and translated terms. Fix: compare normalized candidate phrases against all of our normalized fields, and describe results as “competitor phrases not found verbatim in our store text.”

6. **Medium — category choice is ambiguous.** The model stores `official.category` as the first chip despite documenting that `genreId` is the official category field and that they can disagree. Fix: store and display both explicitly, e.g. `genreCategory` and `primaryChip`, and use one consistently in reports.

7. **Medium — `Intl.Segmenter` is not sufficient proof of usable phrase boundaries.** Word segmentation quality varies with Node’s ICU build/version, especially Thai, Chinese, Japanese, and mixed scripts. Segments may also include script-specific particles or non-semantic units. Fix: pin/test the Node ICU behavior in CI, record derivation runtime/version, and use language-specific normalization/filter rules where tests show poor output.

8. **Medium — the proposed phrase joining rule is underspecified and likely wrong.** “No space between Han/Kana/Thai characters” can merge separately segmented Thai words and produce inconsistent Japanese/Chinese phrases. Fix: preserve a structured token sequence and use a documented locale-specific renderer only for display; use canonical token-array keys for counting/comparison.

9. **Medium — the stopword assumption is unsafe.** `stopwords-iso` coverage, language-code mapping, token form expectations, and quality for CJK/Thai/Korean need verification; stopword removal can also create unnatural adjacent phrases. Fix: verify package licenses/data and map `hl` carefully (`zh-TW`, `pt-BR`, etc.); apply stopwords before n-gram generation without bridging removed tokens.

10. **Medium — title/tag weighting can dominate genuine text concepts.** Repeated/near-duplicate tag chips, generic tags such as “Single player,” and title branding can crowd out useful terms. Fix: deduplicate normalized source terms, maintain a configurable generic-game-term exclusion list, and expose field contributions in the result.

11. **Medium — “a longer phrase replaces its parts” is not a scoring rule.** “As frequent as” is ambiguous across weighted fields; it can remove useful single concepts merely because a bigram appears once. Fix: define exact dominance criteria using weighted counts, minimum occurrences, and deterministic tie-breaking; retain component terms when independently strong.

12. **Medium — missing text fields and language fallbacks are unaddressed.** Scraper answers can omit descriptions/tags or fall back to another locale. Fix: make every field nullable, record the requested and returned locale if available, and show “not available” rather than implying country-specific text.

13. **Medium — date-only snapshot lookup cannot support the UI/report reliably.** “Same as United States” needs a chosen comparable snapshot, but different games/countries may have different latest dates. Fix: select latest successful snapshot per exact `appId/gl/hl`, show each fetch date, and only fold identical normalized `textHash` values.

14. **Low — the preview side effect changes a command that users may expect to be read-only.** Saving shared-library data during preview can be surprising and makes preview failures partially persistent. Fix: document this behavior, make writes best-effort with visible status, and ensure a storage failure does not invalidate preview results.

15. **Low — progress/ETA claims need failure and cancellation behavior.** A fixed “time it will take” is inaccurate under retries/throttling, and Ctrl-C behavior is unspecified. Fix: show an estimate/rate, handle interrupts cleanly, persist completed/status records atomically through `Storage`, and summarize succeeded/skipped/not-found/failed counts.

# Device classes, composite images (schema v3), free store overview: cross-family review (gpt-5.6-sol)

- Reviewer: `codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral` (15-minute timeout), with the user's requests and all changed files inlined. Date: 2026-09-27.

## Reviewer output (verbatim)

- **High** — `src/play/screenshots.ts` · `deckDeviceClasses` — A landscape marketing image with a tablet-like ratio (for example 1200×800) after portrait phone images is classified as `tablet`, violating the requirement that landscape marketing images are never removed by phone-only filtering. Add explicit deck-boundary detection that distinguishes appended tablet sets; do not classify an isolated/leading-deck landscape image as tablet solely from its shape. Add this exact regression test.

- **Medium** — `src/analysis/settle.ts` · `applyDecision` / `buildRecord` — Adjudication can produce an invalid composite result: if neither reading has the chosen composition, the base captures remain unchanged, so `pure_art` may retain captures or `multiple_captures` may contain one. Screen type/subtype can also disagree with the retained primary capture. Re-run `semanticProblems` on the merged result and keep it disputed, or make adjudication return the complete corrected capture structure.

- **Medium** — `src/analysis/settle.ts` · `applyDecision` — An adjudicator can set `marketingLayerPresent: false` while returning a non-empty headline; the layer is cleared but the headline is retained, violating schema semantics. Clear the headline when marketing is absent, or validate the merged result before marking it adjudicated.
## Outcome (all three fixed)
- `deckDeviceClasses`: after the phone set, a tablet-shaped image is tablet only if it clearly belongs to an appended tablet set: a known tablet/iPad store size, or a run of at least 3 images of the same size. A single landscape marketing image (e.g. 1200x800) after portrait phone images stays phone. The regression test uses that exact case.
- `settle.ts` `buildRecord`: the merged, adjudicated reading is validated again (composition vs captures, subtypes, areas). If it fails, the record stays "disputed" with "after settling: …" problems. It is not usable and is retried in the next run. Tested.
- `settle.ts` `applyDecision`: when the adjudicator says there is no marketing layer, the headline is cleared too. Tested.

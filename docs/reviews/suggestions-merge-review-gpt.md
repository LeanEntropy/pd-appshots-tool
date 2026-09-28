# Review: suggestions UI merge and follow-ups (GPT, 2026-09-29)

Reviewer: `codex exec -m gpt-5.6-sol -s read-only` over the diff against origin/master
(merge of feat/suggestions-ui, titles-only flags, slim suggestion and What next cards, country
names in report card descriptions, kept-but-changed key recommendations, full-screen art counted
as art in the composition statistics). No major finding outside the one below.

## Findings

- **Major**: `src/reports/summary.ts`: `changeOf()` reports a moved kept image even without our
  analyses, unlike the earlier behaviour. Suggested: check `ours` first.
- **Minor**: `src/view/country-add.ts`: `countryLabel()` puts flags in the picker's sentences
  ("In the project now...", the approval list). Suggested: plain names there.
- **Minor**: `src/view/gallery-expand.ts`: the What next chips read "Recommended" and "Cost shown
  first" rather than a price.
- **Minor**: `test/flags.test.ts`: tests `flagText()` on a sentence, which conflicts with the
  titles-only rule.
- **Nit**: `src/view/flags.ts`: the doc comment still describes `flagText()` for sentences.

## Decisions

- Summary move: kept as is, on purpose. A kept screenshot moved to another position is a real
  change, and the move needs no analysis to detect. The test and summary now say so
  (`test/summary-kept-change.test.ts`).
- Picker sentences: not changed. The user approved the country picker exactly as shown
  (desktop-7-picker-ticked.png), flags included.
- What next chips: kept. Those options have no price until the builder has the choices (it shows
  the exact cost before anything runs), so a made-up amount would mislead.
- `flagText()` test: kept. The helper is still used, on titles only; the test checks its
  mechanics (escaping, whole words). The call sites are covered by the new card tests
  (`test/report-builder-view.test.ts`, `test/report-list-view.test.ts`), which assert one flag
  in the title and none in the running text.
- Doc comment: fixed. `flagText()` is now documented as titles and headings only.

## Follow-up from the Rogue Legend Full check data

On the real data, "(keep our current position 5: moved from position 5)" repeated itself, and
moved images could crowd new pictures out of the top 5. The fix: the note now reads "moved
here" (plus "new text" or a logo change where they apply), and new pictures and text changes rank
before images that only move. The 5 shown stay in position order. A second gpt-5.6-sol review
of this change found nothing major.

# Orientation fix, image facts, pending marker, popover placement: cross-family review (gpt-5.6-sol)

- Reviewer: `codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral` (10-minute timeout), with the user's requests and all changed files inlined. Date: 2026-09-27.

## Reviewer output (verbatim)

- **Medium** — `src/analysis/info-text.ts` · `pendingMessage`: failed records only include “(a tool bug, since fixed)” when the stored error matches one regex, so the required fixed message is not consistently shown. **Fix:** return the exact prescribed sentence for every `failed` record; leave the actual cause exclusively in technical details.

- **Medium** — `src/analysis/entries.ts` · `batchDataHash`: deterministic backfills preserve `updatedAt`, so adding/changing orientation, ratios, or measured colours does not invalidate cached patterns/recommendations. **Fix:** include `identity.image.version` and the consumed deterministic facts in the hash.

- **Low** — `src/view/gallery-info.ts` · `placeInfo`: `Math.max(160, vh - 16)` forces a 160px maximum height even on shorter viewports, allowing the popover to remain clipped; very narrow viewports can also produce a negative width. **Fix:** clamp width/height to non-negative viewport space without a minimum exceeding the viewport.

- **Low** — `src/view/gallery-info.ts` · focus handlers: moving keyboard focus from the info button into interactive popover content schedules it to close because `focusin` only cancels/shows for info buttons. **Fix:** cancel the hide timer when focus enters `#infoPop`, and hide only when focus leaves both the button and popover.
## Outcome
- Fixed: `entries.ts` `batchDataHash` now also covers the screen type, the mapping version and the image-facts version. A deterministic refresh therefore marks the patterns and recommendations as out of date. Tested.
- Fixed: `gallery-info.ts` `placeInfo`: width and height are clamped to the viewport with no forced 160 px minimum.
- Fixed: `gallery-info.ts` focus handling: focus moving from the (i) button into the popover (e.g. the links or the details toggle) no longer closes it. It closes only when focus leaves both.
- Not applied as suggested, `pendingMessage`: the user's sentence names "a tool bug, since fixed". That is true for the cmd.exe JSON-schema failure, which is what all 17 current failed records have, so they show exactly that sentence. A future failure with a different cause gets "Not analysed yet. An earlier attempt failed. It will be analysed in the next run.", because blaming a fixed tool bug would be wrong there. The error text stays behind "Technical details".

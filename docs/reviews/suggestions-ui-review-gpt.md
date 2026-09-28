# Suggestions UI review (GPT, gpt-5.6-terra via Codex CLI)

Branch feat/suggestions-ui, commit c3e7459 against 13df7b8. Diff passed inline.

## Findings

- **Medium** â€” `src/steps/add-countries.ts:153`  
  The target filter allows any previously unseen chart target outside the newly selected countries: `t.group === "chart" && !known.has(...)`. A country-add flow can therefore check and later download screenshots for existing countries, while the approvalâ€™s per-country breakdown only lists `plan.gls`. Restrict targets to `want.has(t.gl)` (or explicitly include and display/approve every extra country).

- **Low** â€” `src/view/gallery-script.ts:52`  
  The â€œNot on Google Play in â€¦â€ home/gallery card text still renders `DATA.coreMarket.label` with `esc()` rather than `countryLabel`/`withFlag`. This is a visible country name without a flag, so the â€œflag next to every country nameâ€ requirement is not met. Replace it with `countryLabel(DATA.coreMarket.gl, DATA.coreMarket.label)` (or `withFlag(DATA.coreMarket.label)`).
## Resolution

- Medium (chart games of the new countries also read in the main country): kept, because a project download does the same (chart games are shown in the main country too), but the approval now lists them on their own line with pages and screenshots, so every download is shown before approval.
- Low (flag missing in the Not on Google Play note): fixed; the note and its country list now show flags.

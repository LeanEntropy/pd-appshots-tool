# Cross-family review: full-screen art fix (GPT)

- Reviewer: gpt-5.6-sol via `codex exec -s read-only --ephemeral` (diff passed inline; the sandbox could not read files).
- Date: 2026-09-29. Branch `fix/full-screen-art`.

## Findings and decisions

| # | Severity | Finding | Decision |
|---|---|---|---|
| 1 | major | `categoryOf` could send title, key or loading art with a listed capture to that capture's type or to promo. | Fixed: title, key and loading art are always Title screen / full-screen art; only feature and promo art look at the capture. Test added. |
| 2 | major | Character art with a name label was classed as "headline or benefit". | Fixed: heroes with only label/badge texts (no headline or subheadline role) are a showcase. Test added. |
| 3 | major | "How we sort images" only listed the logo tag when some image showed a logo, but a "no logo" finding also uses it. | Fixed: the logo tag is listed whenever images are analysed (example from an image with the logo when there is one). |
| 4 | minor | Mojibake separators ("â€“", "ï¼š") not handled in store titles. | Declined: store titles are read as proper UTF-8; the garbling only appeared in a mis-decoded copy of the brief. |
| 5 | minor | `namesBrand` substring match ("Hero" in "Heroes"); short CJK brands never match. | Declined for now: logo texts carry the full game name in every audited deck; spaced-out logos ("S W O R D X S T A F F") need the compact match. Short-brand support noted as a follow-up. |
| 6 | minor | Reports saved before the fit points still showed a percentage score. | Fixed: the points are derived from the saved patterns (markdown and page). |
| 7 | minor | Event/offer heuristic too broad (summon, gems, bonus, update, reward). | Fixed: only time-limited phrasing (anniversary, N years, gift code, Day n, limited-time, event, new-player/login/daily rewards, counted freebies such as "3,000 Summons"). Test added. |
| 8 | minor | Every title image is assumed to show the logo. | Declined: a title image is by definition the game's title (taxonomy); mapped ones only become title images on logo evidence. Documented in `image-tags.ts`. |

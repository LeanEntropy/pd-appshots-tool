# Plan: store category, tags, store text and derived keywords

Status: draft, 2026-09-28. Author: Claude (Opus). Review: gpt-5.6-terra.

## 1. What Google Play gives us (checked live, 2026-09-28)

32 throttled reads with google-play-scraper 10.1.3: Rogue Legend, Capybara Go and Survivor.io in
US-en, PH-en, JP-ja, JP-en, KR-ko, TW-zh-TW, HK-zh-TW, TH-th, VN-vi and ID-id, plus Legend of
Slime in US and PH. The existing cache of the Rogue Legend project (280 store pages) was compared
read-only.

| Field | What it is | Differs by |
|---|---|---|
| `genreId` | Official category id, e.g. `GAME_ROLE_PLAYING` | Nothing seen (same everywhere) |
| `genre` | Category name, localised ("ロールプレイング", "สวมบทบาท") | Language |
| `categories` | The tag chips on the page. First chip = a category with an id; the rest ("Roguelike", "Idle RPG", "Single player", "Zombie") have **no id**, only a localised name | Language (names); the set is the same per game |
| `title`, `summary` (short description), `description`, `recentChanges` | Store text | Language, and sometimes country |
| `contentRating` | "Everyone 10+" (US) vs "Rated for 7+" (PH, JP-en) | Country |

Findings:
- Text follows the **language**: US-en, PH-en and JP-en were identical; TW and HK (both zh-TW)
  were identical.
- But Play has **custom listings per country**: Legend of Slime shows a different title and short
  description in the US than in PH (same language). In the cache, 1 of 25 games differed US vs PH,
  0 of 21 TW vs HK. So we store per country-language, not per language.
- The category chip can disagree with the genre: Survivor.io has genre Adventure, but its first
  chip is Role Playing. We keep both.
- Vietnam: all three games answered "not found" (not sold there); the cache agrees.
- The short description comes with HTML entities (`&amp;`); `recentChanges` contains `<br>`.
- Google Play has **no public keyword field**. Anything we call keywords is derived by us.

## 2. What we store

One snapshot per game, per country-language, per date, in the shared library (shared across
projects, like images), through the Storage interface only:

`library/store-text/<app>/<gl>-<hl>/<YYYY-MM-DD>.json`

```
{ appId, gl, hl, date, fetchedAt,
  official: { title, shortDescription, description, recentChanges,   // each may be null
              genre: { id, name },                 // the official category
              chips: [{ id|null, name }],          // tag chips as Play returns them (first may be a category)
              contentRating },
  textHash,                       // over the official text, to spot changes cheaply
  derived: { version, keywords: [{ key, term, score, fields: ["title","tags",...] }] } }
```

- The date is the day the page was READ (`fetchedAt`), never the day it was saved.
- Same date written again: overwritten (the newest read of that day wins), the same rule as the
  store orders. Declined review finding: append-only timestamps (not needed for a daily history).
- A later date is a new file, so the future store history and change log can compare snapshots.
- "Not sold in this country" and read errors are not stored (there is no page).

## 3. Derived keywords (deterministic, no AI)

Label everywhere: **"keywords derived from the store text"** (never "official keywords").

1. Clean: decode HTML entities (`he`), turn `<br>` into line breaks, drop URLs and e-mail
   addresses.
2. Tokenise with `Intl.Segmenter(hl, { granularity: "word" })` (built into Node; ICU dictionaries
   handle Japanese, Chinese and Thai, which have no spaces). Keep word-like segments; punctuation
   and line breaks end a phrase.
3. Lower-case (locale-aware), drop stopwords (`stopwords-iso`, MIT, covers en/ja/ko/zh/th/vi/id),
   numbers and one-letter Latin tokens.
4. Count 1-, 2- and 3-word phrases over consecutive kept words; a stopword, punctuation or a
   line break ends the run (no phrase bridges a removed word). Stopword language from `hl`
   (`zh-TW` -> `zh`). Counting uses a canonical key (words joined by a space); the displayed form
   joins Han/Kana/Thai words without a space.
5. Score = weighted count: title 3, tags 3, short description 2, full description 1; repeated
   tag names count once. A shorter term is dropped only when a longer term containing it has the
   same weighted score (every use of it is inside the longer one). Ties: score, then longer, then
   alphabetical. Keep the top 15, each with the fields it came from.
6. Known limit, stated in the UI: Korean words keep their particles (보스를 vs 보스), so Korean
   counts are rougher.

A `version` on the derived part lets a better method recompute from the stored text without
reading Play again.

## 4. Collection

- **Preview** (`npm run preview`): it already reads every store page per game and country. The
  same read now also keeps the fields above, and each "ok" page is saved to the library at once.
  Saving is best-effort: a storage problem is shown as a warning and never fails the preview.
  Cached pages from before this change have no store text and are read again (once).
- **Download** (`npm run download`): saves the store text carried in the approved preview (no
  new reads), under the preview's read date, so every downloaded deck has a snapshot.
- **Backfill** (`npm run store-text`): for the data already downloaded. It lists the store pages
  of the latest download that have no snapshot yet, prints the count and the time it will take,
  and reads nothing. With `-- --yes` it reads them through the same polite queue (one at a time,
  paced), prints "Reading store page 5 of 240", saves each page at once, and can be stopped and
  run again (it skips pages already saved). The estimate is shown as "about". Only pages that had
  screenshots in the download are candidates ("not sold here" pages never are). At the end:
  saved, already saved, not sold there now, could not be read. Free: no AI.

## 5. What the user sees

- **Screenshots grid**: next to each game's name, a "Store" (i) button. Its popover shows, per
  country: category, tags, the top derived keywords, the short description, and the date read.
  Each country uses its own latest snapshot and shows its read date; countries whose text hash
  equals another's are folded ("same text as United States").
- **Report**: new section 5 "Store text and keywords" (Detailed statistics moves to 6). Per
  country: a table with our game and each competitor in the batch (category, tags, top
  keywords), then "Competitor keywords not found in our store text": terms in the top 30 of at
  least 2 competitors whose canonical key does not occur anywhere in our normalised text in that
  country (all fields, not only our top list). Exact matching only: other word forms and
  translations are not matched, and the page says so. When nothing is
  saved yet, the section says how to get it (`npm run store-text`).
- All wording plain; the derived label is always shown.

## 6. Code (300 lines per file, TypeScript strict, Biome)

- `src/play/store-text.ts`: the official fields from a scraper answer (Zod-checked).
- `src/library/store-text.ts`: save and read snapshots via Storage.
- `src/analysis/keywords.ts`: the derivation (pure).
- `src/analysis/store-compare.ts`: per-country comparison for the report and grid (pure).
- `src/steps/store-text.ts`: the backfill command.
- Hooks in `play/client.ts`, `steps/preview.ts`, `steps/download.ts`; view model, grid, (i),
  report data, markdown and page.
- Tests: extraction, keywords (en, ja, zh, th, ko), storage round trip, comparison, backfill
  count/skip with a fake client, report section.

## 7. Review (gpt-5.6-terra, 15 findings)

Applied: 1 (chips kept raw, not claimed stable), 4 (read date kept), 5 (match against all our
text, exact-match wording), 6 (genre and chips stored separately), 7 (ICU behaviour pinned in
tests), 8 (canonical keys), 9 (stopword language mapping, no bridging), 10 (tags deduplicated,
field contributions kept), 11 (exact drop rule and tie-break), 12 (nullable fields), 13 (latest
snapshot per page, hash folding), 14 (best-effort preview writes), 15 (outcome counts, "about").
Declined: 2 (backfill only targets pages with screenshots; "not sold" pages are never retried),
3 (daily snapshots match the store-order model).

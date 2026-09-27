# Google Play Competitor Screenshot Analyzer — Feasibility Spike

Environment: Windows, Node v22.22.0, npm 10.9.4. Package used: `google-play-scraper` (facundoolano)
v10.1.3, ESM-only. All work done in this scratch dir; nothing committed, nothing touched under
`C:\projects\ai\pd-appstore-tool`.

Scripts (kept in this folder): `task1-our-game.js`, `task2-search.js`, `task2-verify.js`,
`task3-locales.js`, `task3-html-compare.js`, `task3-resolution.js`, `task4-charts.js`.
Raw outputs: `task2-search-output.txt`, `task2-verify-output.txt`, `task3-locales-output.json`,
`task3-html-compare-report.json`, `task4-charts-output.txt`, `raw-*.html` (fetched pages).

## 1. Our game — Rogue Legend

| Field | Value |
|---|---|
| Title | Rogue Legend - Roguelike RPG |
| App ID | com.pockethaven.roguelegend |
| Developer | PocketHaven |
| Genre / genreId | Role Playing / `GAME_ROLE_PLAYING` |
| Extra category tags | Roguelike, Single player, Stylized, Monster, Immersive (no genreId, display tags only) |
| Installs | 1,000,000+ (exact minInstalls=1,000,000 / maxInstalls~1,253,826) |
| Screenshot count (raw scraper array) | 21 |
| **Screenshot count (true, deduped)** | **7** |

**Important caveat found here and confirmed everywhere else in this spike:** the scraper's
`screenshots` array frequently contains each real screenshot repeated multiple times (verified
against the underlying data path `ds:5[1][2][78][0]` in `lib/app.js` — it's a quirk in Google's
own payload for this field, not a network/DOM scraping artifact). For Rogue Legend, 21 raw entries
= 7 unique images x 3. Confirmed against the raw HTML page (88 unique `play-lh.googleusercontent.com`
image ids on the page, of which the first 7 in gallery order exactly match the 7 deduped scraper
URLs). **Any screenshot-count or gallery-order logic must dedupe by stripping the `=...` size
suffix and comparing base URLs before trusting the array.**

## 2. Package ID resolution

Resolved via `gplay.search()` then verified with `gplay.app()`. All verified apps returned
`[OK]` details (no failures except the intentionally-ambiguous "Survivor").

| Requested name | Resolved App ID | Title | Developer | Installs | Genre | Status |
|---|---|---|---|---|---|---|
| Capybara Go | `com.habby.capybara` | Capybara Go! | Habby | 10,000,000+ | Role Playing | OK, exact match |
| Mini Tales | `com.loadcomplete.minitales` | Mini Tales | LoadComplete | 100,000+ | Role Playing | OK, exact match |
| Heroll | `com.percent.aos.rollinghero` | Heroll : Dice Roguelike | 111% | 1,000,000+ | Casual | OK, exact match |
| Archero 2 | `com.xq.archeroii` | Archero 2 | Habby | 5,000,000+ | Action | OK, exact match |
| Dicero | `com.bailing.lark.roll.dev` | Dicero | Habby | 1,000,000+ | Casual | OK, exact match |
| Badmaster Isekai | `com.DoorTeam.BagMaster` | BagMaster Isekai - Bag Battle | SayGames Ltd | 1,000,000+ | Strategy | Flagged - no app literally named "Badmaster"; closest is "BagMaster Isekai" (likely typo in request) |
| Overgeared Hero | `com.fiveminlab.overgeared.hero.backpack.merge` | Overgeared Hero: Merge RPG | 5minlab Corp. | 1,000,000+ | Strategy | OK, exact match |
| Legend of Mushroom | `com.mxdzzus.google` | Legend of Mushroom | Joy Nice Games | 5,000,000+ | Role Playing | OK, exact match |
| Legend of Slime | `com.loadcomplete.slimeidle` | Legend of Slime: Idle RPG War | LoadComplete | 10,000,000+ | Adventure | OK, exact match |
| Clash of Critters | `com.farlightgames.pgame.gp` | Clash of Critters | FARLIGHT | 5,000,000+ | Casual | OK, exact match |
| Sword x Staff | `com.zjcs.android.us` | Sword x Staff | BOLTRAY GAMES | 1,000,000+ | Role Playing | OK, exact match |
| Whoa Adventure | `com.yzlmus.google` | Whoa Adventure | Joy Nice Games | 500,000+ | Role Playing | OK, exact match |
| Path of Kings | `com.TornadoBear.WayofKings` | Path of Kings | VOODOO | 1,000,000+ | Role Playing | OK, exact title match (package name differs - internal codename "WayofKings") |

### "Survivor" - ambiguous, candidates found

No single app is titled exactly "Survivor". Most plausible roguelike/survivor-genre candidate,
and 3 runner-ups:

| App ID | Title | Developer | Installs | Genre | Notes |
|---|---|---|---|---|---|
| `com.dxx.firenow` (MOST PLAUSIBLE) | Survivor.io | Habby | 50,000,000+ | Adventure (bullet-heaven/roguelike-survivor) | Huge install base, same publisher (Habby) as Archero 2 and Dicero already in this list, genre matches "survivor-genre roguelike" intent |
| `com.gamee.kingdoms.survivor.io` | Survivor Kingdoms: Roguelike | Gamee Global | 1,000,000+ | Action | Explicitly tagged "Roguelike" in title |
| `com.twinworld.survivor.games.paid.gp` | Twinworld Survivor | Playbest Limited | 50,000+ | Action | Much smaller install base |
| `com.star.survivor.games.paid.gp` | Star Survivor:Premium | Erabit Studios | 100,000+ | Action | Much smaller install base |

Recommend confirming with the requester whether "Survivor" means **Survivor.io** specifically.

## 3. Locale testing (google-play-scraper `app({appId, lang, country})`)

Tested locales: en/us, ja/jp, ko/kr, zh-TW/tw, th/th, vi/vn, id/id, on Capybara Go
(`com.habby.capybara`), Legend of Mushroom (`com.mxdzzus.google`), Archero 2 (`com.xq.archeroii`).

### 3a. Scraper order vs raw HTML page order - MATCH

Fetched `https://play.google.com/store/apps/details?id=X&hl=en&gl=us` directly and extracted
`play-lh.googleusercontent.com` image URLs in document order, then compared against the
**deduped** scraper screenshot list.

| Game | Scraper unique screenshots | Found in raw HTML | Order matches raw HTML |
|---|---|---|---|
| Capybara Go | 10 (of 15 raw) | Yes, all 10 | Yes |
| Legend of Mushroom | 7 (of 21 raw) | Yes, all 7 | Yes |
| Archero 2 | 13 (of 18 raw) | Yes, all 13 | Yes |

(The naive un-deduped comparison script reports "false" for order because the same
duplicate-triplication quirk from section 1 exists in the raw page's underlying JSON too - once
you dedupe both sides, order is identical. This confirms the scraper is a faithful reflection of
the live page, just with the duplication quirk baked in.)

### 3b. Localized screenshot sets - varies by game

Compared each locale's deduped screenshot URL set to the en/us set.

| Game | Locales with distinct (localized) screenshots | Locales identical to en/us |
|---|---|---|
| Capybara Go | ja/jp, ko/kr, zh-TW/tw, id/id all differ from en/us | th/th matched en/us |
| Legend of Mushroom | none - all 7 locales returned byte-identical screenshot URL sets | en/us, ja/jp, ko/kr, zh-TW/tw, th/th, vi/vn, id/id all identical |
| Archero 2 | ja/jp, ko/kr, zh-TW/tw differ from en/us | th/th, id/id matched en/us |
| vi/vn (Capybara Go and Archero 2 only) | App genuinely returns HTTP 404 for this country - not available in Vietnam Play Store, confirmed with a raw `fetch()` (no scraper involved) returning the same 404. Legend of Mushroom IS available in vi/vn. | - |

Conclusion: localization of screenshots is real but game-specific - some publishers (Habby)
localize screenshots for CJK markets, others (LoadComplete's Legend of Mushroom) ship one
universal set worldwide. Don't assume all locales differ; always dedupe+diff per game.

### 3c. Resolution / full-size images - appending `=s0` gives full native resolution

Tested on a Capybara Go screenshot and its header/feature-graphic image:

| URL variant | Result (screenshot) | Result (header/feature image) |
|---|---|---|
| Raw scraper URL (no size suffix) | 288x512 (thumbnail, ~69 KB) | 512x250 (~173 KB) |
| `=s0` (Google's "original size" token) | 1242x2208 (~979 KB) - full native res | 1024x500 (~493 KB) - full native res |
| `=w2560` | 1242x2208 (identical to `=s0` - Google caps at native size, does not upscale) | not tested |
| `=h2000` | 1125x2000 (downscaled proportionally, not full res) | not tested |
| `=w400` | 400x711 (resized as requested) | not tested |
| `=w100-h100` | 56x100 (resized) | not tested |
| Icon | 512x512 at every variant tested (icon's native size already <= requested sizes) | n/a |

Answer: YES - replace/strip the size suffix and append `=s0` to get full native resolution.
`=wN` also works and is capped sensibly at native size; `=hN` resizes to that height (not
guaranteed full-res unless it happens to equal native height).

### 3d. Tablet screenshots / video / feature graphic

- Feature graphic: available as `app.headerImage` (confirmed present for all 3 test games).
- Video: available as `app.video` (YouTube embed URL) + `app.videoImage` (thumbnail) when the
  listing has one. Present for Capybara Go and Archero 2; absent (null) for Legend of Mushroom.
- Tablet-specific screenshots: NOT exposed. Inspected `node_modules/google-play-scraper/lib/app.js`
  - the field map has no `tablet`/`sevenInch`/`tenInch` key at all; only one `screenshots` path
  (`ds:5[1][2][78][0]`). If Google Play stores separate tablet screenshot sets, this scraper
  version does not surface them.

## 4. Top charts (`gplay.list()`)

Tested `TOP_FREE` and `GROSSING` collections, `GAME_ROLE_PLAYING` category, for jp, kr, tw, th, vn, id.

Result: WORKS, no failures. All 12 (country x collection) combinations returned 5 ranked
results each with title + appId (see `task4-charts-output.txt` for full output). No fallback to
scraping category/chart HTML pages was needed.

Caveat: `list()` builds a hardcoded `batchexecute` request body reverse-engineered from Google's
internal API (see `lib/list.js`); it is inherently fragile to Google changing that internal
payload format, but it worked correctly at the time of this spike (2026-09-26).

## 5. Rate limiting / blocking

None observed. Over the course of this spike (~150+ requests total: 14 searches, 17 app-detail
verifications, 21 locale fetches, 3 raw HTML page fetches, ~9 image downloads, 12 chart list
calls, plus a burst test) there were zero 429s, zero CAPTCHAs, and zero blocked/malformed
responses. A dedicated burst test firing 25 concurrent `app()` requests for the same app ID
completed in ~1.2s with 25/25 successes. The only non-200 responses encountered were genuine
404s for apps not published in a given country (vi/vn), independently confirmed via a plain
`fetch()` outside the scraper.

Caveat: this is anecdotal for a single short session from one IP; it does not rule out rate
limiting under sustained/production-scale usage, and Google Play scraping is against Google's
ToS (undocumented internal API) - worth flagging for the eventual production build (add
throttling/caching regardless, and treat this as a risk to monitor rather than a solved problem).

## Package fallback (MrAdex77 rewrite)

Not needed - `google-play-scraper` (facundoolano) v10.1.3 worked without any failures across all
five task areas, so the fallback fork was not evaluated.

## Bottom line for feasibility

- Package ID resolution: feasible, `search()` + `app()` verification works well; only genuine
  ambiguity is "Survivor" (needs product decision on which competitor is meant).
- Screenshot extraction: feasible but must dedupe raw arrays by base URL - the naive
  `.length` is up to 3x inflated.
- Localization comparison: feasible, real signal exists but varies per publisher - don't
  assume uniformly.
- Full-resolution downloads: feasible, `=s0` suffix reliably yields native resolution.
- Tablet/video/feature-graphic: video and feature graphic available; tablet-specific screenshots
  are not exposed by this scraper.
- Top charts: feasible, `list()` works for all 6 target countries without needing an HTML
  fallback.
- Blocking risk: low observed risk in this session, but unverified at scale - build in
  caching/throttling as a precaution.

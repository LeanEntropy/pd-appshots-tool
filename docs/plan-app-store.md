# Plan: Apple App Store pages next to Google Play

Date: 2026-09-29. Status: **draft for user approval**. It was reviewed once by gpt-5.6-sol on the finished draft; the full text is in `docs/reviews/plan-app-store-review-gpt.md`, and section 14 records what was applied or declined. No code yet.
Authority: `memory/PILLARS.md`. Builds on `docs/plan-v2.md` (cost tiers), `docs/plan-project-setup.md` (shared library, share/import), `docs/plan-reports.md` (report types, A/B tests), `docs/plan-cross-country.md` (groups, findings), `docs/plan-analysis-speed.md` (text comparison with crops, pixel check) and `docs/plan-knowledge-base.md` (store facts and rules).

## 0. Bottom line

- **What:** the tool can also read a game's Apple App Store page. Google Play stays the default. The App Store is only fetched when you add it explicitly: for the project, for one game, or for one country. Reading pages is free. Analysis is paid, and its cost is shown first, as today.
- **New outputs:**
  - a "Google Play vs App Store" report: how the same game's two pages differ, for us and for each competitor, per country;
  - patterns across competitors (for example "most competitors lead with a video on Apple");
  - recommendations and A/B tests per platform. On Apple, A/B tests are mapped to Product Page Optimization.
  - Every existing report type (Full check, country, compare countries) can also run on App Store data, so countries can be compared on Apple too.
- **How the data is read (probed live, free):**
  - the public App Store web page, which shows exactly what a visitor sees: the iPhone screenshots in store order, the preview video and in-app events;
  - Apple's free iTunes Lookup API, used for the store text, for matching games and as a fallback.
  - Both are needed. For Survivor.io the API returned a different, older screenshot set (5 images) than the page shows (6 images plus a video), and the API never lists videos.
- **Images already held are not paid again.** Among Rogue Legend plus the 8 core competitors in the 9 project countries there are 365 Apple iPhone screenshot positions:
  - **118 cost nothing:** the same Apple file is used in another country, or the image is the same picture as a Google Play image: same size, only file-compression noise (all 6 of Sword x Staff's);
  - **about 234** show a screen we already analysed from Google Play, in a new shape or with new text, and get the cheap text comparison;
  - **only about 13 to 35** are new pictures that need the full analysis.
- **Cost estimate** for everything, a provisional scenario using the numbers in section 6:
  - **about $12 to $25**;
  - an App Store Full check for the US alone is **about $4.50 to $6**;
  - the worst case, if every doubtful image needs the full analysis, is about $12 for the US and $59 for everything. The tool's own quote before approval is what counts.
  - The text comparison has never run, so its price is the uncertain part. A small paid benchmark (cap $1.50, needs your approval) settles it first.
- **Main risks:**
  - matching the wrong app, because some games have different apps per region on Apple;
  - the App Store web page rate limit (it answered "too many requests" after 4 quick requests);
  - Apple changing the page format.
- **Decisions for you:** section 13.

## 1. How App Store data is obtained

### 1.1 Two free sources, each with a role

| Source | What it gives | Limits (measured or documented) |
|---|---|---|
| **iTunes Search / Lookup API**: `itunes.apple.com/search`, `itunes.apple.com/lookup` ([docs](https://performance-partners.apple.com/search-api)) | trackId, bundleId, trackName, sellerName, genres, version, full description, `screenshotUrls` (iPhone), `ipadScreenshotUrls`, `artworkUrl512`, languages. `country=` picks the storefront, `lang=` the language. Lookup accepts many ids in one request (9 games in one request in the probe). | Documented at "approximately 20 calls per minute". The documented terms are about promotional use of preview content: attribution and badges near the content, and streaming rather than caching. **No video, no in-app events, no subtitle, no promotional text.** It **may return a different device set** from the one the page shows (Survivor.io, below). |
| **Public App Store page**: `apps.apple.com/<cc>/app/id<trackId>` | A `serialized-server-data` JSON block holding, in store order: `product_media_phone_` items (screenshots with exact pixel size, and **videos with their poster image**), `product_media_pad_`, `appEvents` (in-app events with artwork), the media type (`iphone_6_5` in all probes), description, ratings and version history. | **HTTP 429 after 4 requests about 2.5 s apart**, and `retry-after: 15`. At one request every 9 s, 8 in a row worked. `robots.txt` does not disallow `/<cc>/app/` pages; it disallows `/api/`, `/v1/`, `/WebObjects/` and search ([robots.txt](https://apps.apple.com/robots.txt)). I did not find Apple's web terms on automated reading, so this is an open point for you (decision 13.6). |

**Rule:** the page is the source for the deck: its order, its images, video presence and events. The API is the source for store text and matching, and the fallback when the page cannot be read. When they disagree, the page wins, and the deck record keeps a flag saying the API showed another set.

### 1.2 What the probes showed (2026-09-29, 9 games, 9 storefronts, about 40 requests in total)

- **Order:** the page's screenshot order matched the API order for 8 of 9 US games.
  - **Survivor.io** was the exception. The page shows a video followed by 6 screenshots at 1242×2688. The API lists 5 different files: an older set whose file names say 1242×2208.
  - So the API does not always return what users see.
- **Count:** 5 to 8 screenshots per game (Apple allows up to 10).
  - Rogue Legend has 6 on Apple, against 7 on Google Play US and 12 in JP/KR/TW/HK.
- **Video first:** 3 of 9 games open with an app preview video in the US: Archero 2, Survivor.io and Path of Kings.
  - The API never reports the video.
  - The poster image (886×1920) is on the page.
- **In-app events:** 7 of 9 US pages show 1 or 2 events, Rogue Legend included (1).
  - Each event has a title and 16:9 artwork.
- **Orientation:** Legend of Mushroom and Sword x Staff use landscape screenshots (2688×1242) on Apple.
  - Both are landscape on Google Play too.
- **Sizes:** every set had one of three sizes: 1242×2688, 1284×2778 or 1290×2796 (the 6.5"/6.9" iPhone class).
  - Requesting the asset URL with its own size, for example `/{w}x{h}bb.png`, returns the full-resolution original.
  - Larger requests are capped at the original ([Apple specs](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications); the URL behaviour is from our own test, with no official source).
- **Localisation:** the storefront's default language is not always the local one.
  - **Thailand and Indonesia default to English.** With `lang=th_th` / `id_id` (API) or `?l=th` (page), most competitors show a completely different, localised screenshot set. In Thailand 6 of 7 games changed all their screenshots; in Indonesia 5 of 7 did.
  - So each country needs an explicit language, exactly like Google Play's `hl`: TH→th, ID→id, PH→en.
  - HK gives Traditional Chinese by default. Its sets were file-identical to TW for all 7 games available there.
- **Availability differs by region:**
  - Sword x Staff (`com.zjcs.ios.us`) and Legend of Mushroom (`com.us.mxdzz.ios`) exist only in the US storefront among our countries. A separate "Legend of Mushroom: Rush - SEA" app from another seller exists in Vietnam.
  - The **Vietnam** storefront had only 1 of the 9 games (Path of Kings).
  - Google Play serves all of these pages in every country, so on Apple "not available here" is a normal result, not an error.
- **iPad:** the page and the API also carry iPad sets (`ipadPro_2018`). They are ignored, like Play tablet images.

### 1.3 Matching a Google Play game to its App Store app

Probe on the 9 games, searching in the US by name:

| Result | Games |
|---|---|
| Same bundle id | Rogue Legend, Archero 2, Capybara Go, Overgeared Hero, Survivor.io |
| Same id apart from letter case | Path of Kings (`WayofKings` vs `WayOfKings`) |
| Different bundle id, found by name and developer | Sword x Staff (`com.zjcs.ios.us`), Legend of Mushroom (`com.us.mxdzz.ios`), Clash of Critters (`com.farlightgames.pgame.ios`) |

Matching steps, per game and per storefront:
1. **Try the Play package as a bundle id.** Look up `bundleId=<package>` in the storefront.
   - An exact match whose seller normalises to the Play developer counts as **high** confidence. Normalising means lower case, with legal suffixes (Ltd, Pte, Inc, Co, Corporation) and punctuation removed; one name must then contain the other.
   - The lookup ignores letter case: probed, `com.TornadoBear.WayofKings` finds Path of Kings, whose bundle id is `…WayOfKings`. So a bundle id that matches only when case is ignored counts as **high** confidence only when the seller matches too. Otherwise it is **medium**.
2. **Otherwise search by name** in that storefront, using the first part of the store title only (the two-part-title rule).
   - Score the results on three signals: the name after normalisation, the seller name against the Play developer name (for example "HABBY PTE. LTD." against Habby), and the icon's perceptual hash against the Play icon.
   - A strong match on name and seller or icon counts as **medium** confidence. Anything weaker is **low**.
3. **You confirm every medium or low match once per game.**
   - The confirm card shows both icons and both first screenshots side by side, with a list of the other candidates. It is one click.
   - The confirmed trackId is saved per storefront, because regional apps differ.
   - **Not on the App Store** is a valid answer, and it is saved as `confirmed_none`.
   - "No candidate found" is saved as `not_found` and checked again at the next store refresh. A network or API failure is `fetch_failed` and is never stored as "none".
   - Each match keeps its evidence: the signals that matched, the candidates, the source and the date.
4. **Our own game goes through the same check.** Rogue Legend's trackId (6754965520, found in the probe) is prefilled. The bundle id, seller, icon, title and storefront availability are still verified and shown for a one-click confirm.
5. **After every fetch, an exact identity check runs.** It compares the page's trackId and bundle id with the saved match. If either changed, the deck is not used, and the game shows "please re-confirm".

### 1.4 Libraries

`app-store-scraper` (npm, ISC licence; [registry](https://registry.npmjs.org/app-store-scraper), [repo](https://github.com/facundoolano/app-store-scraper)) is not used as the main source:
- its last release is 0.18.0 from 2023-11-21;
- its screenshots come from the same Lookup API, so it has the same gaps (no video, possibly the wrong set).

We write a small client under `src/appstore/`, mirroring `src/play/`. It has three parts:
- lookup and search over plain `fetch`;
- a page parser for the `serialized-server-data` block, tested against saved probe pages;
- a request queue: one page request every 9 s, API requests at most 15 per minute, with backoff when a 429 or `retry-after` arrives.

This is glue code, consistent with the "don't reinvent" rule, because no maintained library gives page order plus video.

## 2. Apple facts that change the analysis

Official sources are trusted, following the platform-rules pillar. Each entry carries one of four labels:
- **hard rule**: stated as a requirement, so breaking it means rejection and the tool never recommends against it;
- **review risk**: wording that App Review applies case by case; the tool avoids it and says why;
- **official guidance**: can be overridden when evidence says it helps, and the report says so plainly;
- **our heuristic**: the tool's own method, never presented as Apple's rule.

The labels in the table below are the draft classification; `apple-rules.ts` stores the exact quote and scope for each entry.

| Topic | Apple | Google Play | Sources |
|---|---|---|---|
| Screenshots | 1 to 10 per localisation per device class | 2 to 8 per device type | [Apple specs](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications), [Play](https://support.google.com/googleplay/android-developer/answer/9866151) |
| Shape | iPhone 6.9" 1260/1290/1320 × 2736/2796/2868, or 6.5" 1242×2688 / 1284×2778; portrait or landscape; smaller devices scale down | long side at most 2× the short side; 9:16 common | as above |
| Video | up to 3 app previews, 15 to 30 s, **autoplay muted** on the page and in search | one YouTube video; only the first 30 s autoplay | [Apple product page](https://developer.apple.com/app-store/product-page/), [Apple previews](https://developer.apple.com/help/app-store-connect/reference/app-information/app-preview-specifications), [Play](https://support.google.com/googleplay/android-developer/answer/9866151) |
| Search results | "First 1–3 [screenshots] appear in search results" | Search layout varies; there is no fixed 3-image rule | [Apple product page](https://developer.apple.com/app-store/product-page/) |
| Feature graphic | none | 1024×500 | [Play](https://support.google.com/googleplay/android-developer/answer/9866151) |
| **Hard rule: app in use** | Guideline 2.3.3: screenshots "should show the app in use, and not merely the title art, login page, or splash screen" | not the same rule | [Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) |
| **Hard rule: previews** | 2.3.4: previews may only use video screen captures of the app | — | as above |
| **Review risk: metadata** | 2.3.7: app names, subtitles, screenshots and previews "should not include prices, terms, or descriptions that are not specific to the metadata type"; it also covers metadata stuffing with trademarked terms and popular app names. 2.3.10: no names, icons or imagery of other mobile platforms or marketplaces. 2.3.2: say when featured items need in-app purchase. The exact wording and scope are stored per rule; the tool quotes it and does not paraphrase it into a stricter ban. | Play's own metadata policy | as above |
| In-app events | event cards on the page and in search; 2.3.13 requires accurate event metadata | Play has promotional content (LiveOps), a separate concept | as above |
| A/B tests | **Product Page Optimization:** up to 3 treatments, at most 90 days, one test at a time; icon, screenshots and previews; per localisation; reviewed before start; cannot be edited once running | Store listing experiments | [PPO](https://developer.apple.com/app-store/product-page-optimization/) |
| Custom product pages | up to 70 extra versions with their own screenshots, previews and promotional text; shown through their own URLs, ads, and **organic search for assigned keywords** | Custom store listings (by country, pre-registration, URL) | [CPP](https://developer.apple.com/app-store/custom-product-pages/) |

What this means for the tool:
- **Title art on Apple (hard rule 2.3.3).**
  - Apple recommendations never propose a gallery that is only title art or full-screen art.
  - They also never propose leading images that are "merely the title art" without the game visible. The title-art category still exists; on Apple, a recommended title-art image must show the game in use. For example, it can carry the logo over a real gameplay capture.
  - Where a competitor's Apple deck differs from its Play deck on this point, the cross-platform report says so. Example from the probe: Capybara Go's Apple deck is 6 gameplay "Day N" screens, not its Play set.
  - Store checks flag any of our Apple images that are only title art.
- **Positions 1 to 3 get extra weight** (our heuristic, adjustable in Settings). This is based on Apple's statement that "first 1–3 appear in search results". How many actually show depends on the device and the orientation, so the report says "can appear in search results", never "always shown".
  - If a video is first, the search result shows the video instead of screenshot 1.
  - The report records "video first" as a deck attribute.
- **Previews are recorded, not analysed, by default.** Apple allows up to 3. For each, we store its position, poster, locale and length when the page gives it. Analysing the poster image is an option you pick, and it is counted in the approval.
- **Custom product pages cannot be seen from outside.** The public page shows only the default page, and custom pages are reachable only by their own URLs. The report says this plainly. The tool can recommend custom product pages; it cannot analyse competitors' ones.
- **Keywords:** Apple has a private keyword field. Visible text is the name, subtitle, promotional text and description. The subtitle and promotional text come from the page, not the API. Derived keywords are labelled as derived, as on Google Play.

This plan does not set the rule tables above in stone. They live in one module, `src/appstore/apple-rules.ts`, with an `APPLE_SOURCE` block (URLs plus the date checked), mirroring `src/analysis/play-experiments.ts`. Once the knowledge base ships, they become KB store-fact entries (section 10).

## 3. Data model: a platform dimension

A game stays one game. Its identity is the Google Play package, as today. A platform is a second dimension on the game's decks, store text and image sources.

| Where | Today | Change |
|---|---|---|
| `project.json`, games | `ourApp.id`, `competitors[].id` (Play package) | Add optional `appStore: { byCountry: { [gl]: Match } }` per game. `Match` holds `status`, `trackId?`, `bundleId?`, `sellerName?`, `confidence`, `evidence` (which signals matched), `candidates[]`, `checkedAt` and `confirmedAt?`. `status` is one of `matched`, `confirmed_none` (you said it is not on the App Store), `not_found` (no candidate in that storefront; checked again at the next store refresh) or `fetch_failed` (never saved as "none"; retried). Add `platforms.appStore: { enabled, pairs: [{ game, gl }] }` at project level (section 5 has the selection rule). **Missing means Google Play only.** |
| Markets | `{ gl, hl, label }` | Add optional `appleLang` (for example `th_th`), defaulting from `hl` by a fixed table. Probed: `ja_jp`, `ko_kr`, `zh_tw` (TW and HK), `th_th`, `id_id`, `en_us`. |
| Decks | `decks/<appId>/<gl>-<hl>.json` | App Store decks go in `decks-appstore/<appId>/<gl>-<appleLang>.json`, keyed by the Play id of the same game plus the Apple locale, so two Apple languages in one storefront never collide. The file has its own `schemaVersion` and parser, with `trackId` inside. Play paths are unchanged, so no migration of existing data is needed. The deck holds an ordered `media[]` list, each item with a `kind`: `screenshot` (with `imageId`, `appleAsset`, the size and `mediaType`) or `preview` (with a poster `imageId`, the video URL, the duration when given, and the locale it came from). Apple allows up to 3 previews. `events[]` are separate entities (id, title, badge, artwork `imageId`, dates when given), recorded but never counted as images to analyse unless you pick them. The deck also carries `source: "page"\|"api"` and `apiMismatch?`. |
| Order history | `orders/…` | Same split: `orders-appstore/…`. |
| Image sources (`refs.json`) | `{ appId, gl, hl, position }` | Add `platform?: "appstore"`. Missing is read as `"play"` by one shared parser, never by ad-hoc checks, so old files stay valid. The dedup key in `addSource` includes the platform. The platform is provenance only: it is never part of an image's identity or of an analysis key. |
| Library | images stored by byte sha (`images/orig/<sha>`, facts, analyses) | **Unchanged.** Every Apple download goes through the same `ingest()` and becomes a sha-addressed library image, like Play images. |
| Library alias index | `library/google/<hash>.json` (Play image id → the hashes seen under it) | Add `library/apple/<hash of asset path>.json`, the same append-only alias format: it only points to shas. If Apple ever serves new bytes under an old path, a new sha is appended, as for Google ids. Its purpose is to skip re-downloading a known path; the sha remains the identity. |
| Store text | `library/store-text/<app>/<gl>-<hl>/<date>.json` | `library/store-text-appstore/<trackId>/<gl>-<appleLang>/<date>.json`, adding `subtitle`, `promotionalText` and `events`. |
| Icons | `library/icons/apps/<app>.json` | Apple icons are stored alongside, keyed by `apple-<trackId>`. The icon check helps matching. |
| Analysis records | keyed by image sha plus analysis key | **Unchanged.** An analysis belongs to the picture, whatever store it came from. |
| Share/import | format of milestone 3b | A new optional folder in the zip. A1 tests the real current import code against a zip that has the folder. If the current import ignores it safely, the format gains a minor version. If not, zips that contain Apple data get a new major version, and older tools refuse them with a clear message. Zips without Apple data stay at the old version. |

**Which set is "the deck":** the iPhone set the page shows (`product_media_phone_`, media type `iphone_6_5` or `iphone_6_9`). If the page is unreadable, we fall back to the API's `screenshotUrls`, flagged "set not verified". iPad is ignored, like Play tablets: it is not downloaded, and only its count is kept. Preview items keep their position in the order but are not counted as images to analyse, unless you choose poster analysis. If the page cannot be read, the tool never switches to the API silently: the deck header says "from the API, set not verified", and the run summary lists every such deck.

## 4. The shared library across platforms: what gets paid

Checks run cheapest first. The first two are free and done by code:

1. **Same Apple file:** the same asset path was already fetched, for example HK = TW, or PH = US. Reuse it. Free.
2. **The same picture apart from file compression:** checked against a Play or Apple image already in the library. Reuse that image's analysis. Free. Strict conditions:
   - the **same pixel dimensions**, with no scaling (a scaled or reshaped image never qualifies);
   - a per-channel difference within compression noise (at most 24 of 255 levels) on at least 99.99% of pixels;
   - **no cluster of changed pixels** anywhere: the existing `pixel-diff` areas are empty, so a changed word or icon always fails.
   - Anything else goes to step 3. The probe found all 6 Sword x Staff images pass: mean difference 0.1 of 255, 0.00% of pixels over 24 levels. Apple saves them as PNG and Play as JPEG, so a byte (sha) match can never find these.
   - Library facts store the link, `sameAs: <sha>`, so the analysis is reused with no copying. Thresholds are Settings values. A4 tests them against known "one word changed" pairs, and the target is zero false reuse.
3. **Same capture, new text or new shape:** the same screen appears with changed marketing text, or reshaped to Apple's taller format. This gets the **text comparison** against an anchor.
   - The perceptual hash only finds candidates, never decides. A candidate becomes "same screen" only when one of these holds:
     - the pixel check (analysis-speed item 8) shows every changed pixel inside text or band areas; for reshaped images, it compares after aligning the shared capture region;
     - or you confirm it in the bulk confirm step.
   - Unconfirmed or doubtful candidates are costed and run as **full analysis**, never as a text comparison.
   - The anchor is chosen in this order:
     1. the same game's image in the same language (Play or Apple);
     2. otherwise the English Apple image;
     3. otherwise the English Play image.
   - The pixel check from the analysis-speed plan (item 8) answers "same screen?" where it can. You confirm the doubtful ones in bulk, as today.
   - **New case: reshaped images.** 50 of the 56 US Apple images have a different aspect ratio from their Play counterparts (about 9:19.5 against 9:16), so the anchor's text boxes cannot be reused as crop coordinates. For these the text comparison gets the whole Apple image at about 768 px and a band crop found on the Apple image itself (layout step, or pixel-diff areas), plus the anchor's analysis JSON. The benchmark in milestone A4 checks that this is accurate.
4. **New picture:** full analysis plus layout, as today.

The approval screen shows the counts per step, per platform and per game, before any paid step, as the pillars require.

## 5. User interface: explicit opt-in

- **One selection rule.** The project holds one list of App Store (game, country) pairs, and it is empty by default. Every control below edits or previews that same list. Only pairs on the list are ever fetched. Our own game is always included when any pair exists for a country.
- **Settings, "App Store" section:** holds the request pace and whether video posters are analysed (default off). It shows the current list, and can clear it.
- **Where you add pairs**, and each choice is saved automatically:
  - **Competitors page:** "Add App Store" per game adds that game in every country already on the list, or in the main country if the list is empty. This starts matching; any doubtful matches show as confirm cards.
  - **Countries page:** a per-country "App Store" tick adds that country for every game already on the list, or for all core games if the list is empty.
  - **Report builder:** it never adds pairs silently. It narrows the report to pairs on the list. An "Add App Store" chip opens a small picker that shows the exact pairs it will add before saving them. Below it: "Reading pages: free, about N minutes. Analysis: X images need full analysis, Y text comparison, Z free. About $A."
- **Costs first:** fetching is free but slow (9 s per page), so the time is shown. Paid steps go through the normal approval, with per-platform counts.
- **Platform marks:** a small store icon next to the title, like country flags: in headings, report cards and deck headers, never in running text.
  - Generic icons are used: a play triangle and a stylised "A". Each carries a text tooltip, "Google Play" or "App Store".
  - Official store logos are avoided.
- **Screenshots tab:** a platform switch above each game's decks (Google Play | App Store). A position-matched view shows the two decks side by side, with each Apple image marked "same file", "same picture", "same screen, new text", "doubtful: please confirm" or "new".
- **Home project card:** unchanged, with only the Open button, following the user rule.

## 6. Cost estimate on real data (free probes)

Scope: Rogue Legend plus the 8 core competitors (Archero 2, Capybara Go, Overgeared Hero, Sword x Staff, Legend of Mushroom, Survivor.io, Clash of Critters, Path of Kings), in US, JP, KR, TW, HK, TH (Thai), ID (Indonesian), PH and VN.

**Method:**
- Every Apple iPhone screenshot was downloaded at 800 px (free), then:
  - perceptual-hashed (the same `sharp-phash` the tool uses);
  - compared against every Play phone image of the same game already in the library (all countries);
  - compared against the Apple images already counted.
- **Threshold:** a hash distance of 20 bits or less counts as "same capture".
  - This was calibrated by eye on 24 pairs from 3 contact sheets. All pairs at 7 to 20 bits were the same capture with new text or a new shape.
  - Above 20 bits, 7 of 8 pairs were different screens (for example Capybara Go). One pair (Overgeared Hero, 22 bits) was the same capture.
  - The stricter 12-bit result is shown as the pessimistic case.
- Pixel identity was then checked for every same-shape US pair: 6 of 6 were identical.

| Country | Apple image positions | Free (same file or identical pixels) | Text comparison | Full analysis |
|---|---|---|---|---|
| US | 56 | 6 | 38 | 12 |
| Japan | 44 | 0 | 44 | 0 |
| South Korea | 43 | 0 | 43 | 0 |
| Taiwan | 44 | 0 | 43 | 1 |
| Hong Kong | 44 | 44 (= Taiwan) | 0 | 0 |
| Thailand (Thai) | 43 | 11 | 32 | 0 |
| Indonesia (Indonesian) | 43 | 14 | 29 | 0 |
| Philippines | 43 | 38 (= US) | 5 | 0 |
| Vietnam | 5 (1 game available) | 5 | 0 | 0 |
| **Total** | **365** | **118** | **234** (212 at 12 bits) | **13** (35 at 12 bits) |

**Prices:**
- **Full analysis plus layout:** $0.13 + $0.11 = **$0.24 per image** (`docs/analysis-speed-measurements.md`: $0.10 to $0.15 after the speed-up, plus layout at $0.114).
- **Text comparison:** **$0.04 to $0.08 per image, estimated, not measured.** It has never run. The estimate uses Opus 5.5 with a 1024 px crop, the anchor JSON and about 600 to 900 output tokens. Reshaped images add a 768 px whole image.

| Scope | Estimate |
|---|---|
| App Store Full check, US only (9 games) | 12 × $0.24 + 38 × $0.04–0.08 = **about $4.50 to $6** |
| Everything above | 13 × $0.24 + 234 × $0.04–0.08 = **about $12 to $22**. Pessimistic (12 bits): 35 × $0.24 + 212 × $0.04–0.08 = **about $17 to $25** |
| **Worst case**: every image that is not free goes to full analysis | US: 50 × $0.24 = **about $12**. Everything: 247 × $0.24 = **about $59** |
| Optional: video posters | 3 games × up to 8 countries; most posters will be the same file across countries, so **about $1 to $3** |
| Report steps (patterns, recommendations, A/B tests) | as today per report, about $1 to $2, plus the new cross-platform comparison step (about $0.15 to $0.35, similar to pattern interpretation) |

**This is a provisional scenario, not a quote.** The step classifier and the reshaped text comparison do not exist yet. The real price is always calculated by the tool's dry-run plan right before approval:
- itemised per image and step;
- showing the model, the price per million tokens and the image size used;
- with the worst-case line, as for every paid step today.

Matching, fetching, pixel checks and alias lookups are free: they use no model and cost only time and disk (about 1 to 3 MB per full-size image). Retries are covered by the existing spending reservation.

**Probe caveats:**
- Survivor.io outside US/JP used the API set, which is the wrong device set.
- JP, KR and TW text comparisons are mostly against same-language Play images, so many will return "same text, new shape". That is cheap, but not free.
- Rogue Legend's own Apple images match its Play images: all 6 are within 12 bits.

## 7. Analysis and reports

### 7.1 A platform dimension in existing reports
Full check, country and compare-countries reports get a platform field, `play | appstore`, defaulting to play. The report card title shows the platform icon. The same deterministic content, patterns and position tables are built from the chosen platform's decks. This gives **cross-country comparison on Apple** for free: it is the existing compare report with `platform=appstore`.

Differences inside the pipeline on Apple:
- positions 1 to 3 are marked "shown in search";
- a video in first position is a deck attribute;
- the rules table in section 2 feeds the recommendation and review prompts (hard rules as constraints; review risks avoided with a reason);
- A/B tests are written as PPO tests (7.3).

### 7.2 New report type: "Google Play vs App Store"
You pick the countries and games. Most of it is deterministic.
- **Per game and country:** count Play vs Apple, order, and a position table (row N = Play #N | Apple #N). Each Apple image is marked same file / same picture / same screen, new text / new picture. The report also covers orientation, video presence and position, events, and the store text (title vs name + subtitle; description length).
- **Marketing-layer differences:** from the text comparisons, covering text changed, text added or removed, and band style.
- **Cross-platform patterns across competitors,** with n and the counting rule shown. Examples: "5 of 8 use the same pictures on both stores", "3 of 8 lead with a video only on Apple", "competitors carry more text blocks on Apple positions 1–3 than on Play". The last is measured by counting text blocks from the analyses, not words.
- **Ours vs the patterns,** per platform.
- **Recommendations per platform:** the Apple ones never break a hard rule and avoid review risks. Every recommendation also says whether it can share the Play asset (a reshape only) or needs a new image.
- **A/B tests:** Play experiments for Play, PPO for Apple.
- It follows the report rules: bottom line first, the CMO voice, a clean default view with details folded, and every classification explained. "Same screen, new text" gets a one-line definition and an example thumbnail pair.
- **New AI step:** the cross-platform interpretation turns the computed differences into findings. It is one call per report, on Opus 5.5, with its own versioned prompt and a Zod schema (`platform-compare.v1`). Everything else is code.
- **Needs:** Play data for the same games and countries. If it is missing, the builder offers to fetch it (free).

### 7.3 A/B tests mapped to Product Page Optimization
Each Apple A/B card holds:
- the hypothesis;
- the evidence;
- **up to 3 treatments**, where the Play experiment card has variants;
- the **localisation(s)** it applies to;
- the element tested (screenshots, previews or icon);
- a note that the test **needs App Review before it starts** and **cannot be edited once running**;
- the **maximum run of 90 days**;
- the note that **one test runs at a time**, so priorities matter more than on Play.

The metric names, traffic-share options and localisation rules shown are checked against Apple's PPO page when this is built. They are stored in `APPLE_SOURCE`, not written from memory.

**Feasibility checks by code, before a card is shown as a runnable test:**
- the change touches only what PPO can test;
- an icon test says "the alternate icon must already be in the app build", a dependency on the next app update;
- at most 3 treatments plus the original, with the control named;
- the test's languages are ones the page has;
- the traffic share and the likely duration are shown as ranges, with the assumption stated.

A Play variant is never copied as an Apple treatment automatically. The Apple card is written for Apple.

Ideas that fail a check become **creative recommendations**, not tests.

Where a hypothesis is about a keyword audience rather than everyone, the card may suggest a **custom product page**. The card notes that keywords can be assigned only from the app's own approved keywords, so it proposes the audience and the page content, not the keyword list.

## 8. Milestones

Each milestone is merged separately with tests passing and is then committed and pushed, following the repo rule.

| # | What | Paid? |
|---|---|---|
| **A0** | **Gate first:** a short written check of Apple's terms for the Search API and apps.apple.com. It covers what may be cached, for how long, and what may be shown in reports and the Artifact. You decide (decision 6) before any page reading ships. Then the `src/appstore/` client: lookup, search, page parser (behind the decision), request queue with pacing and backoff, a per-country language table, and `apple-rules.ts` with `APPLE_SOURCE` holding the exact quotes and the four labels. Fixtures: the saved probe pages and API answers. | free |
| **A1** | Data model: `platform` on sources through one parser, the Apple decks (with `media[]` and events), orders and store-text folders, the `library/apple` alias index, project fields with the pair list and the match statuses, and share/import support tested against the real current import code. Old projects read unchanged. | free |
| **A2** | Matching and confirm cards (Competitors page), with the four statuses and per-storefront results. Our own game goes through the same verified confirm. | free |
| **A3a** | Ingest and free dedup, with no UI: fetching the pair list, the identity check after each fetch, same-file reuse, and "same picture" reuse (strict rule) with the `sameAs` link. | free |
| **A3b** | UI: Settings section, Competitors and Countries controls on the one pair list, the builder picker, and the Screenshots tab platform switch with the side-by-side view. | free |
| **A4** | Cost tiers across platforms: anchor choice, the reshaped text comparison, and the approval counts per platform. **Benchmark:** 10 Apple images (4 reshaped same-language, 4 reshaped translated, 2 "one word changed" traps), comparing text comparison against full analysis. **Cap $1.50, needs your approval.** Gates: text accuracy as judged by you; zero false "same picture" reuse on the traps; every doubtful candidate goes to confirm or to full analysis; and the measured cost per image, which replaces the estimate. | benchmark only |
| **A5** | Reports: the platform dimension in Full check, country and compare-countries reports, then the new "Google Play vs App Store" report, the Apple rules in prompts, and PPO / custom-product-page A/B cards. Cross-family review of prompts and schemas. | report runs only on approval |
| **A6** | First real run for Rogue Legend: US Apple Full check, then the Google Play vs App Store report for the US. Shown as a cost approval (about $5 to $8 including report steps). | on approval |

A6 comes after the current queue (layout backfill, the knowledge base and the text-comparison speed work) unless you move it forward.

**Dependencies:**
- A4 needs the analysis-speed text comparison and pixel check (item 8) merged first.
- A5 prompts read the Apple rules from `apple-rules.ts`. Once the knowledge base ships, the same entries move into the KB, so there is one rule source. The KB is not a blocker for A0 to A5.
- The merge points with in-flight branches are named in section 10:
  - share/import (A1);
  - the report schema and the cross-country groups (A5).

## 9. Tests

- **Parser:**
  - probe pages saved as fixtures give the order, sizes, video position and poster, events and media type;
  - a missing `serialized-server-data` block, or a changed shape, fails loudly with a readable error, never an empty deck.
- **API vs page:** the Survivor.io fixture yields `apiMismatch` and uses the page set.
- **Language:** TH with `th_th` and ID with `id_id` give the localised sets. HK with `zh_tw` equals TW.
- **Matching:**
  - the 9 probed games produce the expected class: 6 same-id including the case difference, 3 by name and seller;
  - a US-only app in JP gives `not_found`. A network error gives `fetch_failed` and never "none". Only your answer gives `confirmed_none`;
  - a trackId or bundle id that changes after a fetch blocks the deck until you re-confirm;
  - a lookalike game (for example "Archer Hunter" for Archero 2 in VN) is never auto-matched.
- **Queue:** it never exceeds the pace. A 429 with `retry-after` waits, and the run can resume.
- **Dedup:**
  - the same asset path in two storefronts is downloaded once;
  - identical pixels (the Sword x Staff fixture pair) give `sameAs` and reuse the analysis at $0;
  - adversarial pairs never get free reuse: one word changed, an icon changed, the same picture scaled, the same picture reshaped;
  - an Apple asset path that later serves new bytes appends a new sha and is analysed again.
- **Tiers:**
  - the approval counts per platform add up; nothing already analysed is counted again;
  - no paid call runs without a fresh itemised approval;
  - a doubtful candidate is never costed as a text comparison.
- **Page and API:** when the page fails, the deck is marked "from the API, set not verified" and listed in the run summary. There is no silent downgrade.
- **Media:** a fixture with 2 or 3 previews keeps all of them, in order. Event artwork is never counted as an image to analyse unless picked.
- **Data model:**
  - old `refs.json`, decks and share zips load unchanged;
  - a new zip round-trips with Apple data;
  - the real current import code is tested against a zip with the Apple folder (section 3);
  - two Apple locales in one storefront never overwrite each other.
- **Rules:** every Apple rule in `apple-rules.ts` has an exact quote, a URL, a check date and a label. A stale check date (over 6 months) shows a warning in the builder.
- **Reports:**
  - with no Apple data, every report is unchanged (snapshot test);
  - the Google Play vs App Store report's deterministic part is built from fixtures without AI;
  - a code check on the recommendation JSON blocks any Apple recommendation of a title-art-only gallery;
  - the same check blocks any Apple image spec that is "merely the title art", with no game shown in use, in every position.
- **UI:** the opt-in is off by default, every button gives feedback, and costs are visible before any paid button.

## 10. Risks and conflicts

| Risk | Handling |
|---|---|
| Matching the wrong app (regional publishers, lookalikes) | Only an exact bundle id with the same developer is automatic. Everything else needs your one-click confirm, with icons and screenshots side by side. The confirmation is saved per storefront. |
| The page format changes or the page is blocked | The parser fails loudly and falls back to the API set flagged "set not verified". The fixture tests catch format changes. The request pace is conservative. |
| Rate limits (page 429; API about 20 per minute) | A queue at 1 page per 9 s, API at most 15 per minute, one request for many ids, and a cache per day. Fetching all 9 games in 9 countries takes about 81 page reads, about 12 to 15 minutes, shown before starting. |
| The API returns the wrong set | The page wins, and any mismatch is shown in the deck header. |
| API or page gaps (subtitle, promotional text, custom product pages invisible) | They are stated in the report method notes, which are folded. Custom product pages are never guessed. |
| The reshaped text comparison is inaccurate | The A4 benchmark gate. If it fails, reshaped images go to full analysis: the pessimistic cost row. |
| Apple's terms on automated page reading, and on caching Search API content, are unclear. `robots.txt` not disallowing app pages is not a permission. | The A0 terms check comes first. Page reading ships only after your decision 13.6. The API-only mode works without the page, losing the video and the verified set. |
| Legal use of assets | Images stay local for internal analysis, as with Play. Whether the Artifact and share zips may carry Apple images, or only links and thumbnails, follows the A0 terms check. |
| The page falls back to the API silently | This is not allowed: the deck header and the run summary mark every deck taken from the API. |

**Conflicts with work in flight:**
- **Knowledge base (`docs/plan-knowledge-base.md`):**
  - It already plans App Store facts and cases as research step 2 (D5).
  - This plan needs only the store specs and rules, and keeps them in `apple-rules.ts` until the KB has App Store store-fact entries. They then move into the KB with the D1 split into enforced rules and guidance. Our four labels map onto that split: hard rule and review risk are enforced; guidance is guidance; our heuristics stay in the tool's own settings.
  - The KB's App Store research should include PPO metrics, custom product pages in search, and the 2.3.x rules listed here.
  - Nothing here blocks the KB, or the reverse.
- **Analysis speed (text comparison with crops, pixel check):** A4 depends on that text comparison working. The reshaped variant is an addition to it, not a change.
- **Layout capture:** used here to find band boxes on reshaped Apple images. There is no change to its stored format.
- **Cross-country groups:** gain a platform filter, and the group findings code is untouched.
- **Share/import:** the format gains an optional folder (A1), so zips made before A1 stay valid.
- **Games library (scheduled last):** it later shows both platforms per game. That is not built here.
- **Store history:** Apple changes are logged the same way (added, removed, moved, replaced), once the history feature exists.

## 11. What is deliberately not in this plan

- iPad and Apple TV sets, macOS and visionOS.
- Analysing video content: only the poster, and only as an option.
- Competitors' custom product pages, which cannot be seen.
- App Store top charts as a competitor source. The iTunes RSS charts could add this later; you would pick them, as with Play charts.
- Any automatic or background refresh. Store data is refreshed only inside a user action, as today.

## 12. Plain-language glossary for report text

- **Same file:** the store serves exactly the same image in both places.
- **Same picture:** the same size and the same pixels, apart from tiny file-compression noise. No word or icon has changed.
- **Same screen, new text:** the same game screen with different marketing text or a new shape. Only the text is checked again.
- **New picture:** a screen we have not analysed before.
- **Product Page Optimization:** Apple's built-in A/B test for the store page.
- **Custom product page:** an extra version of the App Store page, reached by its own link, by ads, or by chosen search keywords.

## 13. Decisions for you

1. **Language per country on Apple:** use the local language (TH Thai, ID Indonesian), mirroring Google Play. The alternative is the storefront default, which is English in TH and ID. *Recommended: local, same as Play.* English can be added as a second language per country later.
2. **The first opt-in scope:** the US only for all 9 games (about $4.50 to $6 for analysis), or US plus the 4 East Asian stores. *Recommended: US first, then expand with the normal expanding-circle approval.*
3. **Video posters:** record only (default), or analyse posters too (about $1 to $3 extra across all countries). *Recommended: record only for now.*
4. **Text comparison benchmark for reshaped images** (A4, cap $1.50). *Recommended: yes. Without it the estimate stays a range.*
5. **Platform icons:** generic icons with tooltips (recommended), or text chips only.
6. **Reading the public App Store page** (decided after the A0 terms check): allowed at a slow pace (recommended if the terms check finds no bar; it is the only source of the true order and video), or API only (free and simpler, but it can show the wrong set, as with Survivor.io, and misses videos and events).
7. **Priority:** after the current queue (recommended), or before the knowledge base.

## 14. Review record

The review was run once, on the finished draft, with gpt-5.6-sol through Codex CLI (read-only). The full text is in `docs/reviews/plan-app-store-review-gpt.md`. What was applied or declined is listed below.

| # | Finding (short) | Decision |
|---|---|---|
| 1 | `robots.txt` is not permission, and the API terms may limit caching | **Applied in part.** The terms check is now the first A0 step, and page reading ships only after decision 6. The Artifact and zip use of Apple images follows that check (sections 8, 10). **Declined:** making API-only the default. The probe shows the API can return a set users do not see (Survivor.io) and never lists videos, so an API-only tool would give wrong decks. You choose in decision 6. |
| 2 | Rule wording is overstated; the "first 3 count double" weighting is not Apple's | **Applied.** There are now four labels (hard rule, review risk, official guidance, our heuristic), and exact quotes are kept in `apple-rules.ts`. 2.3.7 is reworded to Apple's text. The weighting is labelled as our adjustable heuristic, and the report says "can appear in search results" (section 2). |
| 3 | The Apple URL index is not content-addressed | **Applied (clarified).** Apple images go through the same sha-addressed `ingest()`. `library/apple/…` is only an alias index to shas, append-only, like the Google index. The platform is provenance, never identity (section 3). |
| 4 | Free reuse after scaling is unsafe | **Applied.** Free reuse now needs the same pixel dimensions (no scaling), compression-level noise only, and no cluster of changed pixels. Adversarial tests are added, and "same picture" is redefined in the glossary (sections 4, 9, 12). |
| 5 | A hash distance of 20 bits or less does not prove "same screen" | **Applied.** The hash only finds candidates. "Same screen" needs the pixel check (changes only inside the text or band areas) or your confirmation. Doubtful candidates are costed and run as full analysis. A4 gates on this (sections 4, 8). |
| 6 | The estimate reads as a quote | **Applied.** It is labelled a provisional scenario, a worst-case row is added (about $12 US, about $59 everything), and the real price comes from the dry-run plan at approval with its assumptions shown (sections 0, 6). **Declined:** adding OCR costs. The pipeline has no OCR step, and the text is read by the text comparison already priced. |
| 7 | The opt-in controls have no single rule | **Applied.** There is one project list of (game, country) pairs, and every control edits it. The builder never adds pairs silently (sections 3, 5). |
| 8 | Saving "none" can freeze a transient failure; matching is vague; our own ID skips checks | **Applied.** There are four statuses with evidence, and the seller normalisation is defined. Our own game gets the same verified confirm, and an identity check runs after each fetch. A live re-probe found the lookup ignores letter case, and the plan now says so (section 1.3). |
| 9 | Paths can collide across Apple locales; the schema version is vague; the share claim is untested | **Applied.** Paths are keyed by Apple locale, and Apple files get their own `schemaVersion` and parser. One shared parser reads a missing platform as Play. The share/import behaviour is tested against the real import code, with a major version bump if needed (section 3). |
| 10 | Up to 3 previews and events are not modelled | **Applied.** Decks hold an ordered `media[]` list with several previews, and events are separate entities that are not costed by default (section 3). |
| 11 | A Play variant is not an Apple treatment; alternate icons need the build; CPP keywords are limited | **Applied.** Code feasibility checks run before a card counts as a runnable PPO test. Ideas that fail become creative recommendations. Icon tests carry the build dependency, and the CPP cards follow the approved-keyword limit (section 7.3). |
| 12 | Milestone order: dependencies, duplicate rules with the KB, A3 too large | **Applied in part.** A3 is split into A3a (ingest and dedup) and A3b (UI), and the dependencies and merge points are listed (section 8). **Declined:** making the KB a prerequisite. The KB plan is not approved yet and would block this work; `apple-rules.ts` is the one rule source until its entries move into the KB. |
| 13 | Missing adversarial tests | **Applied.** Tests are added for failure statuses, identity changes, locale collisions, multiple previews, URL reuse with new bytes, false-reuse traps, silent downgrade, fresh approval, rule provenance, and a per-image title-art check (section 9). |

## User decisions (2026-09-29)
All recommended options accepted: local language per country; US first; preview videos recorded as cover image only (no video analysis yet); the $1.50 test run is approved; small Play/Apple store icons with tooltips; read the public App Store page after a check of Apple's terms; priority after the current queue (wireframe redraw, then games directory + image page).

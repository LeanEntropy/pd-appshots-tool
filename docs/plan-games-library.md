# Plan: Image page, games directory and game page

Date: 2026-09-29 (version 2). Author: Claude (Opus). Status: **draft for the user's approval; one gpt-5.6-sol review processed**. No code yet.
Authority: `memory/PILLARS.md`. Builds on `docs/plan-project-setup.md` (12A shared library, 12C share/import, 12D store history), `docs/plan-store-metadata.md`, `docs/plan-reports.md`, `docs/plan-layout-wireframes.md`, `docs/plan-app-store.md` (in progress) and the code on master as of 1a212b3, plus the wireframe redraw in flight on `fix/wireframe-two-layers` (uncommitted, in its worktree).
Version 1 (directory + game page) was reviewed by gpt-5.6-terra: `docs/reviews/plan-games-library-review-gpt.md`; its accepted fixes are kept below. Version 2 adds the image page, re-checks everything against today's code, and was reviewed once by gpt-5.6-sol: `docs/reviews/plan-games-library-v2-review-gpt.md` (outcome at the end).

## 0. Bottom line

- **Three pages, planned together, built in this order:**
  1. **Image page** (new, moved up by the user): one page per picture, opened in a new tab from the (i) popover ("Open image page") and from the game page. Big picture, the two wireframes with numbered shapes and a numbered list, focus and focus match, all texts, where the picture is used, and when and how it was analysed. Details folded.
  2. **Games directory**: every game we hold data for, metadata only.
  3. **Game page**: one game's screenshots per country, store text and analysis, linking every picture to its image page.
- **When:** the image page starts right after the wireframe redraw (`fix/wireframe-two-layers`) is merged, because it reuses that branch's two-panel wireframe. The directory and game page follow it (D1 asks whether they also move up, or stay last as the pillar says today).
- **Free and code-only.** Every page reads data already on disk: no AI, no store reads, no downloads, no writes to projects, the library or reports. The only file these pages write is one cache (`shared/index/games.v1.json`), which can be deleted without loss. The one link that leads to work (a Light copy's "Download full-size pictures") opens the project's existing Overview action; nothing is started from these pages.
- **Two gaps the pages cannot fill for free** (decisions D3, D4): English for most non-English texts is not saved anywhere today, and "reinforcement" is not a saved field yet. The page says so plainly instead of inventing it.
- **Fast by reuse:** the per-process library fact cache, the workspace data stamp (`dataStamp`) with the `Computed` single-flight cache, stored same-screen and pixel-check results, and the library icon store. Nothing heavy is computed on page open.
- **Works for Light imports:** pictures without a full-size original show their preview, say so, and link to the existing free "Download full-size pictures" action.

## 1. What changed since version 1 (re-check against master)

| Master now has | Effect on this plan |
|---|---|
| Shared library with layouts (`library/layout/<sha>/`, `src/layout`) | The image page reads layouts through `layoutView`; wireframes come from `src/layout/wireframe-svg.ts` |
| Same-screen check (`src/store/same-screen.ts`, results under `library/same-screen/`) | "Same screen uploaded twice" is read from stored results; never recomputed on a page |
| Pixel check and "these are different / same" answers (`src/reports/pixel-pairs.ts`, `match-check.ts`) | Marks on the game page and image page use stored pixel results and the user's answers, then `samePicture` |
| App icons in the library (`library/icons/`, global route `/app-icons/<sha>.webp`) | Icons no longer come from a project's `icons/` folder: `appIconSrc(storage, appId)` for every game, letter placeholder when missing. Version 1's icon precedence rule and the per-project icon route are dropped |
| Share / import, Light copies (`src/share/originals.ts` `previewOnly`) | All three pages handle preview-only pictures (section 5) |
| Country and compare-countries reports, report cards with flags | Reports are not changed. Report thumbnails linking to image pages is a later, separate change (D6) |
| Knowledge base (switched off) | No effect |
| Fast project open (`Computed`, `dataStamp`, `pageView`) | Reused for all caching; version 1's own per-part stamp scheme is simplified (section 7.3) |
| `flags.ts` (`countryLabel`, `flagImg`) on master | Reused. **Rule changed since version 1:** flags only next to a country name in titles and headings (and on meta chips like the report type cards), never in running text. Version 1's "every country mention uses the flag helper" (review finding 12) is withdrawn |
| Home card rule: only "Open" | The "Games library" link goes in the home page's top bar, never on a project card |
| Style A (tinted bands) and "default-open clean, details folded" | All three pages use style A bands; everything beyond the essentials is behind folds |
| App Store plan (in progress) adds a `platform` to image sources and decks | URLs and data carry an optional `platform` (default Google Play) so Apple slots in later without new URLs |

## 2. Image page

### 2.1 Address and opening

- **Stable URL per picture:** `/image/<sha>` (the image's content hash, 64 hex). Context rides in the query: `?project=<id>&app=<appId>&gl=<gl>&hl=<hl>&pos=<n>` (later `&platform=`). The same picture always has the same path; the context only decides which project's view is shown and which appearance is highlighted.
- **Works standalone:** only fields that are *absent* get defaults. Without `project`, the page picks the most recently opened, not archived project that references the picture (then any archived one). Without `app/gl/hl/pos`, it highlights the first appearance in that project (main country first, then lowest position).
- **A supplied context that does not fit is never silently replaced.** The page still shows the picture (the hash is its identity), but opens with an amber notice band at the top naming what the address asked for and what is shown instead: "This address asks for Japan, position 3 in Other Game. That project no longer uses this picture; shown as Rogue Legend sees it (Japan, position 4)." The Shown-as selector and the appearance list let the user pick. An unknown or malformed hash: "We hold no picture with this address" (404).
- **The server resolves one referencing project per request** and builds every picture URL from it (original, or the preview for a Light copy) through that project's reference-gated route. If the picture's file cannot be loaded later (project removed or archived-and-cleaned between page and image request), the picture slot turns into a grey box "The picture is no longer available in this project" with the Shown-as selector; the bands still show.
- **Opened from:**
  - the (i) popover: a button "Open image page" next to "Open image", `target="_blank" rel="noopener"`, carrying the full context of the thumbnail it belongs to;
  - the game page's strips: each thumbnail links to its image page (new tab);
  - the image page itself: "Where it is used" rows link to the other appearances' image pages (same tab).
- **Viewing as:** one project's view (its analysis settings, its "different" answers). When several projects use the picture, a small selector at the top ("Shown as: [Rogue Legend v]") reloads with another `project`. This keeps the rule that a project never silently uses another project's analysis made under other settings.

### 2.2 What the user sees (default open, style A)

```
Games library / Capybara Go / [JP] Japan / Position 3              Shown as: [Rogue Legend v]
 ┌──────────────── dark teal header band ───────────────────────────────────────────────┐
 │ Capybara Go · Japan · position 3        Battle · Portrait 1080 × 1920 · Logo: no       │
 └───────────────────────────────────────────────────────────────────────────────────────┘
 [ the picture, large: fits the window height; click opens the original ]
   Preview only (shared Light copy). [Download full-size pictures]        (only when so)

 Focus band        Shows off: battle, a boss fight with skill effects
                   Marketing covers: the top HUD; keeps the hero and the boss
                   Reinforcement: the headline "Beat every boss" names the fight (D4)
                   Focus match: match, the headline and the boss cut-out both point at the fight
 Wireframes band   [Screenshot layer]           [Marketing layer]
                   numbered shapes              numbered shapes
                   1 Hero (knight, blue armour, determined, sword raised)
                   2 Boss (red dragon, angry, wings spread)   ...
                   M1 Top band (dark purple) ...  M2 Headline "..."  M3 Logo ...
 Texts band        Headline: 「ボスを全部倒せ」  English: "Defeat every boss"
                   Badge: 「NEW」  English: "NEW"   ...
 Where used band   Capybara Go: Japan #3, Taiwan #3 (identical), Korea #3 (same picture, new text)
                   Same screen uploaded twice: also Japan #7 (taller size)
                   Also in: Other Game project (chart game)
 Footer line       Analysed 27 Sep 2026 · claude-opus-4-8, checked by gpt-5.6-sol · $0.21 (paid by Rogue Legend)
 > Measured facts   > Colours   > Raw fields   > History                (folded)
```

Default-open content, in this order:

1. **Header band:** game name, country (flag in this title only), position; screen type (plain words, with the one-line definition on hover as the classification rule asks), orientation and size from the pixels, logo yes/no.
2. **The picture**, large, fitted to the window; click opens the full file in the same tab. Preview-only pictures show the preview with the line above and a link "Download full-size pictures" to the project's Overview, where the existing free action runs with its own busy, progress and result states. This page starts nothing.
3. **Focus band**: focus, what the marketing covers and keeps, reinforcement, focus match (`match / partial / mismatch / no marketing layer`, a mismatch in red, the reason after it), from `focusView` (in-flight `src/layout/focus.ts`). For a layout saved before focus was asked: the fallback wording `focusView` already gives ("Not judged for this saved layout"). No layout: "Not analysed yet" (and why: before layouts existed, or failed).
   - **Reinforcement** is shown only from a dedicated saved field, never relabelled from the focus-match reason. D4 recommends adding `composition.reinforcement` ("how the marketing layer repeats or strengthens the focus", at most 120 characters) to the layout v3 prompt on the in-flight branch before it merges, so no extra layout version is needed. Until a layout has it, the line reads "Reinforcement: not analysed yet".
4. **Wireframes band**: the two panels side by side (stacked on a narrow window), each with numbered shapes (screenshot layer 1, 2, 3...; marketing layer M1, M2...) and a numbered list under it. Each list row: role and who or what it is, colours, facial expression, pose, and for texts the exact words. Rows come from the layout element's note (who/what, then look) and, where the note is thin, the analysis' marketing elements (`what`, `pose`, `colours`) and screenshot description, exactly as the in-flight `aboutOf`/`detailsOf` do. Minor props go in each layer's one-line description under the list, never as shapes (pillar). A missing field is simply left out, never "n/a".
5. **Texts band**: every text block of the marketing layer in reading order, role first ("Headline", "Badge"...), the original exactly as drawn (script and spacing kept), and its English:
   - from the saved layer comparison (`library/layer-diff/`, `backTranslation`) when the picture went the "same picture, new text" way;
   - from the country report's saved back-translation of the headline when there is one;
   - English originals need none;
   - otherwise "English not saved yet".
   This does **not** fully meet the "original + English" requirement: most fully analysed non-English pictures have no saved English. D3 asks the user to choose between accepting the gap for now and adding milestone I1b, a paid text-only translation step (text only, no picture, a small model, the usual approval screen with count and cost first; saved per picture and text hash so it is never paid twice). The page itself never calls a model.
   Game-UI text is never listed as marketing text (existing text-reading rule).
6. **Where it is used band**, all by code, with bounded candidates and three explicit states per check (`matched`, `checked, no match`, `not checked yet`):
   - every appearance in the viewed project: game, country, position; the current one highlighted;
   - **identical in other countries**: the same hash on other country pages (from `refs.json` sources; exact, always known);
   - **same picture, new text**: candidates are only the same game's pictures on its other country pages in the viewed project (at most about 10 pages × 10 slots), kept when their perceptual hashes are within the report planner's limit; each candidate then gets the stored pixel verdict (`pixelLookup`) and `samePicture`, minus the user's "different" answers. A candidate without a stored pixel result shows "not checked yet", never "no match";
   - **same screen uploaded twice**: candidates are the other slots of the same deck that `sameScreenCandidate` accepts (at most about 10); each reads its stored result by `sameScreenKey`; a missing result is "not checked yet" (the background check runs once per data change and can take minutes the first time);
   - **other projects** that use it and their role ("chart game", "direct competitor").
   Each row links to that appearance's image page. Country names here are plain words (no flags in running text).
7. **Footer line**: "Analysed <date>" = `paidBy.at` (when the first usable reading was paid for), else the record's `updatedAt` labelled "last updated"; the models (producer, reviewer, adjudicator); and the cost of **this reading** = the finished attempts of the run that paid for it (`paidBy.runId`) in the picture's attempts log, i.e. `paidBy.usd`; "cost unknown" for imported records (`usd: null`); "(paid by <project>)" when another project paid. Retries, the layout call and earlier readings are listed with their costs in the History fold, not added into this number.

Folded (closed by default):

- **Measured facts**: size, orientation, ratio, bytes, format, device class and confidence, perceptual hash, first seen, the measured marketing coverage (`coverageUpTo`), band sizes.
- **Colours**: measured dominant colours of the image and of each layer (`colour-store`), and the model's colours, labelled apart.
- **Raw fields**: the full reading (both layers) as the (i) popover lists it today, status, differences, problems, analysis key and provenance, `updatedAt`, layout version and model.
- **History**, limited to what the viewed project may see (the `readStoredRecord` rule; readings other projects made under other settings are never shown or counted): the project's own earlier reading when it has one (its unproven or older-settings record), older layouts for its reading (in-flight `readOlderLayout`), every attempt in the picture's attempts log with date, stage and cost (retries and the layout call included, the total at the end), and the pictures fetched earlier under the same Google image id (`library/google/`). Store history (12D) adds deck changes here later.

### 2.3 Thumbnail-only (Light import) pictures

- The picture: the preview, the "Preview only" line, and the link to the project's Overview action (the existing free download with its busy/progress/success states). After it has run, the page shows the original on its next load.
- Everything else works: analyses, layouts and wireframes travel in the Light package and are drawn from data, not from the file.
- Measured facts come from the saved facts file; nothing is measured on page open.

## 3. Games directory (from version 1, adapted)

```
Store Screenshot Recipe / Games library                                  [Update the list]
 [Search games...          ]  Category [All v]  Country [All v]  Project [All v]
 Sort [Most images v]   Showing 41 games                            Updated 2 minutes ago

 [icon] Capybara Go                    Habby · 4.6 stars · Role Playing
        [US][JP][KR][TW][HK][TH][ID][PH]         64 images · 8 countries · 9 analysed
        Used in: Rogue Legend (direct competitor)
        > more (ASO words, keywords, store check)
```

- **Compact cards side by side** as the width permits; each card: icon, name, one meta line, the country chips row (D8: flag chips with the country name on hover, as on the report type cards the user asked for, or plain country codes; hover names the country, its image count and check date; dimmed for "not sold here"), one count line, one "Used in" line. ASO words, keywords per country and the last store check are behind the card's "more" fold (default-open clean). Clicking the card opens the game page.
- **Counts**: images = distinct pictures across its store pages; countries = pages with at least one picture; analysed = of those pictures, how many have a usable reading in any project. Failed slots and "not sold here" pages count nowhere.
- **ASO words** from `splitStoreTitle` on each page's title (main-language page first; "different in N countries" unfolds). **Keywords**: top 3 derived keywords per country, labelled once "Keywords derived from the store text (Google Play has no official keywords)"; "No store text saved yet" when missing.
- **Used in**: each project and the game's role in plain words; chart rank as "#3 in Japan" (plain words); archived projects tagged "(archived)".
- **Search** (name, developer, ASO words, keywords; case- and accent-insensitive), **filters** (category, country with screenshots, project), **sort** (most images, latest store check, name) all run in the page; the choice is remembered per browser (try/catch, convenience only).
- **States**: "Loading the games...", "No games yet. Create a project to start.", "No games match. Clear the filters." with a button. **Update the list** uses `src/view/action.ts`: busy button, "Updating the list: game 120 of 300", then "List updated: 3 games changed" or a plain error.
- Reached from a "Games library" link in the home page's top bar.

## 4. Game page (from version 1, adapted)

```
Games library / Capybara Go                                   Shown as: [Rogue Legend v]
 [icon] Capybara Go - Roguelike RPG   Habby · 4.6 stars · Role Playing · 64 images, 9 analysed
 Used in: Rogue Legend (direct competitor) [Open]

 [US] United States (English)   8 images · store checked 27 Sep 2026     (main country)
   1 [thumb](i)  2 [thumb](i)  3 [thumb]  ...
 [JP] Japan (Japanese)          8 images · store checked 27 Sep 2026
   1 [thumb] Same picture, new text   2 [thumb] Same file as United States   3 [thumb] New picture
 > Store text per country     > Keywords per country     > Store history (when it exists)
```

- **One strip per country** (flag in the strip heading), store order from the deck (never inferred), main country first, then the project's country order. Each thumbnail: its (i) popover (the shared script, so the wireframes and the "Open image page" button come for free) and a click that opens its image page in a new tab.
- **Marks per picture against the main country's page**, by code, in this order: "Same file as United States" (same hash anywhere on the main page); "Same picture, new text" (one-to-one match: stored pixel verdict or `samePicture`, not rejected by the viewing project's "different" answers; ties by smallest perceptual distance, then position distance, then lower position; each main picture used once); "New picture"; "Not in the main country" when the main country has no page. Each mark has its one-line explanation on hover. Plain words, no flags.
- **Same screen uploaded twice** within a strip: a small "same screen as #2" mark from the stored result (none while unchecked).
- **Failed slot**: grey box "Screenshot could not be saved" at its position, no mark, no (i), not counted.
- **Store text per country** (folded; same texts folded together), with read dates, and "text read 29 Sep, screenshots 27 Sep" when they differ. **Keywords per country** folded.
- **Shown as**: as on the image page. Default: the most recently opened project that uses the game; hidden when only one does.

## 5. Data sources (all existing, all free)

| Shown | Source |
|---|---|
| Picture, preview | library `images/orig|thumb/<sha>` through the project route `/p/<id>/images/...` (reference-gated) |
| Preview-only state | `previewOnly(storage, projectId, [sha])` |
| Size, orientation, facts | `readFacts` (process cache), pixel facts (`LIB.pixels`) |
| Reading, status, models | `readStoredRecord(paths, sha)` (the project's own key rule) |
| Layout, wireframes, focus | `layoutView(paths, record)` (in-flight version: two panels, `focusView`, `older`) |
| Measured colours | `readMeasured` (`colour-store`) |
| Cost | `readAttempts(paths, sha)`, `record.paidBy` |
| English of texts | `readLayerDiff` / `currentLayerDiff`, saved country-report back-translations |
| Appearances, other projects | each project's `refs.json` sources (one small file per project) |
| Same screen | `readSameScreen(storage, sameScreenKey(...))` for candidate pairs in the deck |
| Same picture, new text | stored pixel checks (`pixelLookup`), `samePicture`, `readDifferentPairs` |
| Earlier pictures of the slot | `readGoogleId` |
| Game name, developer, category, role | `project.json`, deck title, chart lists, `latestStoreText` |
| Icon | `appIconSrc(storage, appId)`, served by `/app-icons/<sha>.webp` |
| Rating | shared Play lookup cache (D2) |

## 6. Server

| Method | Path | Purpose |
|---|---|---|
| GET | `/image/<sha>` | Image page (context in the query) |
| GET | `/api/image/<sha>?project=&app=&gl=&hl=&pos=` | Image page data as that project sees it |
| GET | `/games` | Directory page |
| GET | `/games/<appId>` | Game page |
| GET | `/api/games` | The saved list, plus whether an update is running and its progress |
| POST | `/api/games/rebuild` | Update the list (forced; token and same-origin as every POST) |
| GET | `/api/games/<appId>?project=<id>` | Game page data as that project sees it |

- All global routes (not under `/p/<id>/`), added through one `libraryPagesRoute` call in `globalRoute`.
- **Validation before any storage access**: sha `^[0-9a-f]{64}$`, appId the package pattern, project id `^[a-z0-9-]{1,60}$`, `gl`/`hl` the market patterns, `pos` 1 to 99. Malformed API input: 400. Unknown picture or game: 404. A context that does not fit: ignored with the note (image page) or 404 on the game API when the project does not use the game.
- **No new file-serving route.** Pictures go through `/p/<id>/images/...` of the viewed project, which refuses pictures the project does not reference; icons through `/app-icons/<sha>.webp`. Page data only ever carries paths built from validated hashes, never a path from the request.
- **One escaping path per context:** page data is embedded once as JSON in `<script type="application/json">` with `<` written as `<` (the existing `gallery-html.ts` pattern, which also neutralises `</script>`); server-built HTML goes through the existing `esc`; every URL part (sha, appId, project, gl, hl, pos) is built with `encodeURIComponent` from validated values; links only ever use `/image/`, `/games/`, `/p/<id>/` or the Google Play image host (checked prefix, as the popover does); client scripts insert text with `textContent`, not HTML strings; wireframe data goes through the DOM renderer (`wireframe-xss` rules). Tests feed quotes, ampersands, Unicode, `javascript:` and `</script>` through game names, store text, texts and query values.

## 7. Performance (use the existing caches)

### 7.1 Image page

- One request builds one picture's data: one record, one layout (plus its measure), one facts file (cached), one attempts log, the viewed project's decks of that game (a few small files), stored pair results by key. No directory walks of `library/analysis/`.
- **Where used across projects** needs every project's `refs.json`. An in-memory **image-to-uses map** (sha → [{project, app, gl, hl, pos}]) is built once and kept in `Computed` under the workspace `dataStamp`, single flight. Any write invalidates it, so the worst case is re-reading one small `refs.json` per project on the next image page; that worst case (20 projects, cold disk) is measured, and if it misses the target the map keeps each project's part and re-reads only projects whose `refs.json` content hash changed. The same map feeds the games index.
- Not `infoViews` (it reads every record of the project): a new single-picture `infoView(paths, sha)` beside it returns the same shape for one picture; `infoViews` is changed to call it per record (same output, tested).
- Targets (measured on the real workspace and a synthetic 20-project one, warm and cold): image page data ≤ 150 ms warm, ≤ 600 ms cold; first paint of the picture before the bands (the picture URL is in the page HTML; the data follows).

### 7.2 Directory and game page

- The games index (`shared/index/games.v1.json`, written through `Storage`, Zod-checked, rebuilt if unreadable) keeps version 1's shape (`GameEntry` with `checked` pages, counts, `title`, `keywords`, `uses`), minus the icon field (icons now come from `appIconSrc`).
- Targets from version 1 stay: saved list first rows ≤ 300 ms; one project changed ≤ 1 s; full rebuild of 300 games ≤ 5 s with progress; search/filter/sort ≤ 50 ms per keystroke; game page (10 countries × 10 pictures) ≤ 500 ms, thumbnails lazy-loaded.

### 7.3 Freshness (simplified from version 1)

- On opening the directory, the server returns the saved list at once. If the workspace `dataStamp` differs from the one the index was built at, it re-reads the per-project parts whose inputs changed (version 1's cheap project stamp: a hash of `project.json` `updatedAt`, the run names (`Storage.children`), the deck key list (`Storage.list`), and the contents of `state/job.json`, `state/refreshes.json` and `refs.json`) and the library store-text part (key names under `library/store-text/<app>/`), yielding between games so progress polls are answered. One rebuild at a time; a second request joins it.
- Every stamp uses only existing `Storage` calls (`getJson`, `getText`, `list`, `children`); `Storage` has no file times, and none are needed. `dataStamp` (in `src/storage/changes.ts`, already the storage layer's own cross-process marker) is only a fast "anything written?" gate inside one server process; the index stores the per-part stamps, so after a restart they decide. A test writes from a second process and after a restart and checks both are seen.
- **Update the list** is a forced rebuild of every part. Known limit (hover of "Updated ..."): a second same-day store-text read, or a change a command-line step makes without touching the files above, is seen after Update the list.
- Nothing runs on a timer; nothing reads Google Play.

## 8. Milestones

Each: Opus dev agent in its own worktree branch; tests, typecheck, Biome; one cross-family code review (gpt-5.6-sol); user checkpoint with screenshots. At most 4-5 agents at once.

| # | Scope | What the user sees | Starts after |
|---|---|---|---|
| I1 | Image page: `/image/<sha>`, `/api/image/<sha>`, single-picture `infoView`, image-to-uses map, numbered wireframes (section 9), focus band, texts with saved English, where used, footer, folds, preview-only state, context notice, "Open image page" in the (i) popover, measurement | Hovers an (i), presses "Open image page", a new tab shows the picture large, the two numbered wireframes with their lists, focus and match, texts, where it is used and what it cost; reloads the URL alone and it still works; a Light copy shows its preview and the link to the download | `fix/wireframe-two-layers` merged |
| I1b (D3) | Only if chosen: paid text-only English translation of marketing texts, with the approval screen (count, cost, cap) first | Presses "Add English for 120 texts ($0.30)" on the Analysis page, approves, watches progress; image pages then show English | I1 |
| G1 | Games index, `/games`, `/api/games`, rebuild with progress, directory with search, filters, sort, flag chips, counts, home top-bar link, measurement | Opens the library, types "capy", filters by Japan, hovers a flag chip, presses Update the list and watches it | I1 (D1) |
| G2 | Game page: strips with marks, same-screen marks, failed slots, store text and keywords folds, (i), Shown as, thumbnails open image pages | Opens a game, sees which Japanese pictures are the US file, the same picture with new text, or new; clicks one and its image page opens | G1 |

## 9. The wireframe component: reuse and the one addition

- I1 reuses the in-flight renderer as is: `wireframe()` (`src/layout/wireframe-svg.ts`) builds the checked two-panel data; `WIREFRAME_SCRIPT` (`src/view/gallery-wireframe.ts`) draws it with DOM calls.
- **Addition: a separate numbered adapter, not a change to the popover's contract.** A new `numberedWireframe()` (new file `src/layout/wireframe-numbered.ts`) builds the same two panels from the same shape and placement code (`wireframe-items.ts`, `wireframe-place.ts`) but gives each shape a number chip (1..n in the screenshot layer, M1..Mn in the marketing layer) instead of text labels with leader lines, and returns its own `rows` list (one per numbered shape: number, name, who/what, colours, expression, pose, text). `wireframe()` and its `parts` stay exactly as the branch leaves them. The DOM renderer gets one small branch for number chips and `rows`, and a regression test pins the popover's output (same data, same DOM) before and after. The popover keeps its labels unless the user chooses numbers there too (D5).
- Built in I1 only after the branch is merged, so the two never edit the same file at the same time.

## 10. Files and conflict risks

New (each ≤ 300 lines): `src/library/image-uses.ts` (image-to-uses map), `src/layout/wireframe-numbered.ts`, `src/server/image-view.ts` (image page data), `src/server/routes-library-pages.ts`, `src/view/image-html.ts`, `src/view/image-script.ts`, `src/library/games-index.ts`, `src/library/games-parts.ts`, `src/library/games-stamp.ts`, `src/view/games-html.ts`, `src/view/games-script.ts`, `src/view/game-html.ts`, `src/view/game-script.ts`; tests below.

Changed (small): `src/analysis/records.ts` (`infoView` for one picture), `src/view/gallery-info.ts` (the "Open image page" button; the thumbnail context), `src/view/gallery-wireframe.ts` (number chips and rows in the renderer; `wireframe-svg.ts` unchanged), `src/server/app-server.ts` (one route call), `src/view/home-html.ts` (top-bar link).

| Other work | Overlap | Risk and handling |
|---|---|---|
| Wireframe redraw (`fix/wireframe-two-layers`, in flight, uncommitted) | Changes `wireframe-svg.ts`, `gallery-wireframe.ts`, `gallery-info.ts`, `layout/info.ts`, `layout/schema.ts`, adds `focus.ts` | **High if parallel, none if sequential:** I1 starts from master after it merges. If its data contract changes again (e.g. focus fields), I1 follows it |
| Layout prompt v3 (focus fields) on the same branch | The focus band reads it | Old layouts show the fallback wording; no backfill is part of this plan |
| App Store plan (A1 adds `platform` to sources and decks) | Refs sources, decks, image-to-uses map, URLs | Low, with a fixed rule: the picture's identity stays its hash (platform-free), a game stays its Play package (as the App Store plan says), and `platform` is an optional field that means Google Play when absent. This plan reads sources through one helper; if A1 lands first, that helper is A1's single source parser; if this plan lands first, A1 extends the helper. A test reads sources without `platform` as Google Play |
| Store history (12D, future) | History fold, game page fold | None now: they add their folds |
| Confirm-all matches, report type cards, home open (open branches) | `match-check.ts` answers are read only; home page | Low: read only; one top-bar link |
| Report pages | None changed | D6: linking report thumbnails to image pages is a later change |

## 11. Tests (node:test, no network, no paid calls)

- Image page data: a usable record with a current layout; an older layout (marked older); no layout ("Not analysed yet"); no reinforcement field ("not analysed yet", never the match reason); a failed record; a preview-only picture (preview URL, the line, the link); a picture used twice in one deck (same screen), identical in two countries, and the same picture with new text in a third; a candidate without a stored result shows "not checked yet"; a user "different" answer removes a match; cost = the paying run's attempts only, retries in History; "cost unknown" for imports; "paid by" another project; analysed date from `paidBy.at`, else "last updated".
- History shows no reading made by another project under other settings.
- Context: absent fields get defaults; a supplied project that does not use the picture, or a wrong position, shows the notice band naming what was asked and what is shown; archived projects last; malformed sha, app, project, gl, hl, pos give 400 on the API; unknown sha 404; the picture URL always belongs to the resolved project; a removed project between page and picture request gives the grey box.
- `infoView(one)` equals `infoViews()[sha]` for every record of a fixture project.
- Image-to-uses map: built once per `dataStamp`; a write rebuilds it; two projects, archived tagged; spy shows no per-request reads of every `refs.json`.
- Numbered wireframes: numbers match list rows; repeated items one box each; no text labels in numbered mode; the popover's `wireframe()` output is unchanged (pinned fixture); the XSS tests of the in-flight branch pass for numbered mode (text only as `textContent`, colours `#rrggbb`).
- Texts: original kept exactly (script, spacing); English from the layer comparison, from a country report, or "English not saved yet"; game-UI text excluded.
- Directory and game page: version 1's tests (merge, counts, ASO words, keywords, stamps, forced rebuild, corrupt index, routes, rebuild joining, marks one-to-one, failed slot), updated: icons from `appIconSrc`; flags only in headings and chips (a test that running text and marks contain no flag image).
- Pages (fake DOM, as today): folds closed by default; every action shows busy then success or error; names escaped; new-tab links carry `rel="noopener"`.
- Performance: the measurement script for section 7 (reported, not pass/fail).

## 12. Risks

| Risk | Mitigation |
|---|---|
| The wireframe branch changes again after I1 starts | I1 starts after it merges; one owner of the wireframe files at a time |
| English missing for most non-English pictures | Say "English not saved yet" plainly; D3 offers a cheap text-only step |
| Stale "where used" after a write in another process | `dataStamp` counts other processes' marker touches; a reload after the write shows it |
| A picture reached through a project that does not reference it | Pictures only through the viewed project's reference-gated route; the page picks a project that references it |
| Slow on a big workspace | Single-picture reads, `Computed` map, lazy thumbnails, measured targets |
| Scope creep into editing | All three pages are read-only; the only action is the existing free download for Light copies |

## 13. Decisions for the user

| # | Question | Recommended |
|---|---|---|
| D1 | Order: image page first, then directory and game page right after it (moved up with it), or directory and game page stay last | Image page first, directory and game page right after it |
| D2 | Rating: only when a lookup already cached it, or add it to every store read | Only when cached; add the field with the next store-reading change |
| D3 | English of texts (the requirement is only partly met for free): accept "English not saved yet" for now, or add I1b, a paid text-only translation step with the approval screen | Add I1b; the cost is small (text only), and I1 alone leaves most non-English pictures without English |
| D4 | Reinforcement: add a `reinforcement` field to the layout v3 prompt on the in-flight wireframe branch before it merges (new layouts only), or leave it "not analysed yet" | Add it to the in-flight branch now (no extra layout version later) |
| D5 | Numbered wireframes on the image page only, or in the (i) popover too | Image page only; the popover keeps labels (it is small) |
| D6 | Report thumbnails link to image pages | Later, as a separate small change |
| D7 | Which projects' games and pictures are listed: all, including archived (tagged), or only active | All, archived tagged and last |
| D8 | Directory card countries: flag chips with the name on hover (as on the report type cards), or plain country codes (strict reading of "flags only next to a country name in titles") | Flag chips, as on the report type cards |

## Review outcome (version 1, gpt-5.6-terra)

14 findings: 10 accepted, 4 partly accepted (kept in the text above). Changed since: finding 12 (flag on every country mention) is withdrawn by the newer flags rule; finding 10 (icons) is overtaken by the library icon store; finding 5 (progress) keeps the yielding rebuild. Raw review: `docs/reviews/plan-games-library-review-gpt.md`.

## Review outcome (version 2, gpt-5.6-sol)

Reviewer: gpt-5.6-sol, 2026-09-29, one review (plan, requirements and code facts inline). Raw review: `docs/reviews/plan-games-library-v2-review-gpt.md`. 15 findings: 11 accepted, 4 partly accepted, 0 declined outright.

| # | Finding | Outcome | Reason / change |
|---|---|---|---|
| 1 | "Original + English" not met; English missing for most pictures | Partly accepted | Gap stated plainly in section 0 and the texts band; I1b (paid text-only step with approval) added as D3, recommended. Declined: a model call from the page itself (these pages stay free; paid work needs the approval screen) |
| 2 | Focus-match reason relabelled as reinforcement | Accepted | Reinforcement only from a dedicated field; D4 recommends adding it to the in-flight layout v3 prompt before it merges; else "not analysed yet" |
| 3 | "Read-only" contradicted by the Light download button | Accepted | The page links to the Overview action; it starts nothing |
| 4 | History cannot show other settings' readings | Accepted | History limited to what the viewed project may see |
| 5 | Cost sums unrelated attempts; `paidBy` date | Partly accepted | Cost = the paying run's attempts (`paidBy.usd`), retries and layout in History. The date part is declined: `paidBy` does carry `at` on master |
| 6 | Mismatched context silently replaced | Partly accepted | Supplied context is never silently replaced: an amber notice band names what was asked and what is shown. Declined: a 404 for a valid picture (the hash is its identity; the page stays useful) |
| 7 | Picture URL, removed project, selector | Accepted | Server resolves one project and builds the URL; grey box if the file becomes unavailable; tests |
| 8 | Flag-only chips break the flags rule | Partly accepted | Made decision D8 (the user asked for the same chips on report type cards); plain codes offered |
| 9 | Numbered mode changes the in-flight contract | Accepted | Separate `numberedWireframe()` adapter; `wireframe()` and `parts` untouched; pinned popover regression test |
| 10 | Workspace-wide stamp re-reads every refs file | Partly accepted | Worst case measured; per-project reuse by `refs.json` content hash only if the target is missed |
| 11 | Stamps need file times the Storage interface lacks | Accepted | Stamps use only existing Storage calls; `dataStamp` stays in the storage layer; cross-process and restart test |
| 12 | Pair checks unbounded; "no match" vs "not computed" | Accepted | Bounded candidates per game and deck; three explicit states |
| 13 | Analysis date undefined | Accepted | `paidBy.at`, else `updatedAt` labelled "last updated" |
| 14 | XSS surface wider than text | Accepted | One escaping path per context (JSON `<`, `esc`, `encodeURIComponent`, prefix-checked links, `textContent`); payload tests |
| 15 | App Store `platform` conflict strategy vague | Accepted | Fixed identity rule, one source helper shared with A1, test for sources without `platform` |

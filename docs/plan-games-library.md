# Plan: Games library (a directory of every game we hold data for, and a page per game)

Date: 2026-09-29. Author: Claude (Opus). Status: **draft for the user's approval, revised after review**. No code yet.
Authority: `memory/PILLARS.md`. Builds on `docs/plan-project-setup.md` (12A shared library, 12D store history), `docs/plan-store-metadata.md` (category, store text, derived keywords), `docs/plan-reports.md` (R4), `docs/plan-layout-wireframes.md` (L0 to L5) and the code on master as of 13df7b8.
Review: gpt-5.6-terra (cross-family), see "Review outcome" at the end.

## 0. Bottom line

- **Priority: nice-to-have, scheduled LAST.** It starts only after R4 (country reports), the category fix, the suggestions UI (flags, add countries), the wireframe work (L0 to L4b) and anything else the user has queued ahead of it are merged. It blocks none of them and changes none of their files beyond two one-line hooks (section 7). If store history (12D) is still future then, the library goes first and 12D later adds its fold.
- **What the user gets:** a "Games library" page reached from the projects home. One compact row per game we hold data for, across all projects, with **metadata only** (icon, name, developer, rating, country flags, category, ASO words from the title, keywords per country, counts, last store check, which projects use it and how). Search, filters and sorting. Clicking a game opens its **game page**, where the heavy content lives: screenshots per country in store order with "same as / new text / new picture" marks, store text per country, and the analysis (i) per image.
- **Free and code-only.** Everything comes from data already on disk. No AI, no store reads, no downloads. "Check the store now" is left to the store-history refresh (D3).
- **One small read model** (`shared/index/games.v1.json`) built by code from the projects and the shared library, rebuilt only for the parts whose sources changed, or entirely when the user presses Update the list. It is a cache: deleting it loses nothing.
- **No new data is written anywhere else.** The library page never changes a project, the shared library or a report.

## 1. What the user sees

### 1.1 Games library (directory)

```
Store Screenshot Recipe / Games library                                  [Update the list]
 [Search games...          ]  Category [All v]  Country [All v]  Project [All v]
 Sort [Most images v]   Showing 41 games                            Updated 2 minutes ago

 [icon] Capybara Go                    Habby · 4.6 stars · Role Playing
        [US][JP][KR][TW][HK][TH][ID][PH]         64 images · 8 countries · 9 analysed
        ASO words: "Roguelike RPG"   (different in 3 countries)
        Keywords [US] roguelike, capybara, idle rpg   [JP] ローグライク, カピバラ  ... more
        Used in: Rogue Legend (direct competitor) · Other Game (chart game, #3 in [JP] Japan)
        Store checked 27 Sep 2026
```

- **Rows as cards, side by side as the width permits** (the pillar layout rule): one column on a phone, two or three on a wide screen. Each card is compact: at most five short lines; long lists end in "... more" that unfolds in place.
- **Flags** (real flag images through `countryLabel`/`flagImg` from the suggestions-ui branch) for every country whose store page we checked. Pages with screenshots show a normal flag; hover (and keyboard focus) shows "Japan: 8 images, store checked 27 Sep 2026 (in Rogue Legend)". Pages Google says the game is not sold on show a dimmed flag with "Japan: not sold here (checked 27 Sep 2026)" and count nowhere.
- **Every country mention uses the flag helper**, including marks ("Same file as [US] United States"), chart ranks ("#3 in [JP] Japan"), tooltips, folded text groups and filter options.
- **Counts:** images = distinct pictures across all its store pages; countries = pages with at least one picture; analysed = of those pictures, how many have a usable analysis in any project.
- **ASO words:** the second part of a two-part store title ("[name] - [ASO words]", same separators as the store-title rule), from the main-language page (US English when held, else the first held country). "Different in 3 countries" unfolds the per-country list with flags. One-part titles show nothing.
- **Keywords:** the top 3 derived keywords per country, flag first, labelled once per page "Keywords derived from the store text (Google Play has no official keywords)". Missing store text says "No store text saved yet" (never an error).
- **Used in:** each project and its role in plain words: "our game", "direct competitor", "same audience", "big reference game", "chart game (#3 in [JP] Japan)". Project names link to that project. Archived projects are listed with "(archived)".
- **Search** matches the name, brand, developer, ASO words and keywords (case- and accent-insensitive). **Filters:** category, country (games with screenshots from that country), project. **Sort:** most images, latest store check, name. All filtering and sorting runs in the page, instantly, and is remembered per browser (try/catch; convenience only).
- **Empty and loading states:** "Loading the games..." at once; "No games yet. Create a project to start." when empty; "No games match. Clear the filters." with a button.
- **Update the list** (and the check on opening, section 3.3) uses the shared action helper (`src/view/action.ts`): disabled button, spinner, "Updating the list: game 120 of 300", then "List updated: 3 games changed" or a plain error. Never silent.

### 1.2 Game page

```
Games library / Capybara Go                     Viewing with: [Rogue Legend v]
 [icon] Capybara Go - Roguelike RPG   Habby · 4.6 stars · Role Playing · 64 images, 9 analysed
 Used in: Rogue Legend (direct competitor) [Open]   Other Game (chart game) [Open]

 [US] United States (English)   8 images · store checked 27 Sep 2026     (main country)
   1 [thumb](i)  2 [thumb](i)  3 [thumb]  ...
 [JP] Japan (Japanese)          8 images · store checked 27 Sep 2026
   1 [thumb] Same picture, new text   2 [thumb] Same file as US   3 [thumb] New picture ...
 > Store text per country (folded)
 > Keywords per country (folded)
 > Store history (appears when store history exists)
```

- **One strip per country**, in store order (position numbers from the store, never inferred), main country first, then the project's country order. Thumbnails open the full picture; the (i) shows the existing analysis popover (the same script and view data the gallery uses, so wireframes appear here automatically once L2 adds them to the popover).
- **Marks per picture, against the main country's page of the same game**, by code, in this fixed order:
  1. "Same file as [US] United States": the same hash appears anywhere in the main country's page;
  2. "Same picture, new text": matched one-to-one to a main-country picture that `samePicture` (`src/reports/anchors.ts`, the report planner's rule) accepts and the viewing project's user answers ("these are different", `src/reports/match-check.ts`) do not reject. Among several candidates: smallest perceptual-hash distance, then smallest position distance, then lower position; each main-country picture is used once;
  3. "New picture": anything else; "Not in the main country" when the main country has no page.
  Each mark has a one-line explanation on hover (pillar: every classification explained).
- **A slot whose download failed** (no image saved) keeps its store position with a grey box "Screenshot could not be saved", no mark and no (i). It is not counted as an image.
- **Store text per country** (folded): title split into brand and ASO words, short description, category and tags, read date; the full description folded again. Countries with the same text are folded together ("same text as [US] United States"), as in the grid's Store (i). The text is the newest saved read of that page (shared by all projects), always labelled with its read date; when it was read after the viewed project's screenshots, the label says so ("text read 29 Sep, screenshots 27 Sep").
- **Keywords per country** (folded): the full derived top list with the fields each came from.
- **Viewing with:** analyses and marks are shown as the chosen project sees them (its analysis settings, its main country, its "different" answers). Default: the most recently opened project that uses the game. A game used by one project shows no selector. This keeps the existing rule that a project never silently uses another project's analysis made under other settings.
- **Links back:** each project that uses the game, with Open (its workspace).
- **Later slots, not built here:** store history (12D, milestone 6) adds a "Store history" fold; layout wireframes arrive through the shared (i) popover.

## 2. Data sources (all existing, all free)

| Shown | Source | Fallback |
|---|---|---|
| Name | `project.json` (our game, competitors) | deck title (brand part), chart entry title |
| Developer | `project.json` | project cache listing, chart entry; else "unknown developer" |
| Rating | shared Play lookup cache (`shared/cache/play/details/`), with its date ("4.6 stars, 27 Sep") | not shown (D2) |
| Icon | any project's `icons/<app>.png`, served by that project's existing icons route | letter placeholder (as on the home cards) |
| Category | latest store text snapshot's official category (US English first), through the helper the category fix settles on | `genreId` from `project.json` or the listing, in words |
| Countries, image counts, store check date | each project's deck manifests (`decks/<app>/<gl>-<hl>.json`: status, `fetchedAt`, slots with image hash). When two projects hold the same page, the newer `fetchedAt` wins (hover names the project) | none: no deck, no flag |
| Analysed | shared library `analysis/<sha>/*.json` with a usable status, any key | 0 |
| ASO words, brand | `splitStoreTitle` (from the store-title fix) on each page's title | whole title as brand, no ASO words |
| Keywords per country | `latestStoreText` (library store text, derived keywords, method version checked) | "No store text saved yet" |
| Used in and role | `project.json` (our game, tier), chart ranks from the project's saved chart lists (the gallery's source) | chart game without a rank |
| Screenshots, marks, (i) | per project: decks, library facts (hash, perceptual hash, size), `infoViews` | as the gallery shows them |

Chart games that appear in no project's settings are included (they have decks), with role "chart game".

**When sources disagree** (two projects hold the same game): name, developer and category come from our game's or a competitor's `project.json` before any listing or chart entry, then from the most recently opened project; rating from the newest cached lookup (its date is shown); icon from the first project that has one. The directory does not flag disagreements (they are rare and cosmetic); the game page's Viewing with shows each project's own view.

## 3. The read model (index)

### 3.1 Shape and place

`shared/index/games.v1.json`, written atomically through `Storage` by the server only (no direct `node:fs`). Zod-checked on read; an unreadable file is rebuilt (it is a cache).

```
GamesIndex = { version: 1, rules: 1, builtAt,
  parts: { [projectId]: { stamp, games: { [appId]: ProjectGamePart } } },
  library: { stamp, text: { [appId]: TextPart } },
  games: GameEntry[] }          // the merged list the page gets

GameEntry = { appId, name, developer, icon: { projectId, file } | null,
  rating: { value, at } | null, category: string | null,
  checked: [{ gl, hl, status: "ok"|"unavailable", images, fetchedAt, projectId }],   // every page checked
  images, countriesWithImages, analysed, lastCheck,
  title: { brand, aso: string | null, asoByCountry: [{ gl, aso }] },
  keywords: [{ gl, hl, date, top: string[] }],       // top 3 for the list; the game page reads the full list
  uses: [{ projectId, projectName, archived, role, tier?, chart?: [{ gl, rank }] }] }
```

Size target: about 1.5 KB per game, so 300 games stay under 500 KB.

### 3.2 How it is built

1. **Per project part** (decks, roles, icon, name, developer, chart ranks, and per game the set of image hashes in its decks): read only that project's files. The analysed count is computed here too: for each image hash of the game, whether the library holds a usable record for it under any key (`library/analysis/<sha>/`). Images belong to games through the decks, never through the analysis files. Rebuilt when its stamp changes.
2. **Library part** (store text: category, titles, top keywords): `library/store-text/<app>/` for the games in the index. Rebuilt when the library stamp changes.
3. **Merge** (pure function): join parts by `appId`, newest deck per country, distinct image hashes across projects, counts, sort keys.
- The rebuild runs in the server in small steps (it yields between games), so the page can poll its progress and other requests are served meanwhile. Only one rebuild runs at a time. It is not a job in `src/jobs` (no lanes or locks needed: it only reads, and writes one cache file).

### 3.3 How it stays fresh

- **Stamps, cheap to compute, no hooks in other code.** Deck files are only rewritten by a download (which writes a new run manifest) or, later, a store-history refresh (which writes `state/refreshes.json`); analysis records only by an analysis job (which rewrites `state/job.json`):
  - project stamp = hash of `project.json` `updatedAt`, the names of its `runs/` entries, its deck key list, and the contents of `state/job.json` and `state/refreshes.json` (both small);
  - library stamp = hash of the key names under `library/store-text/<app>/` for the indexed games (store text files are named by read date). No walk of the analysis folders on page open.
- On opening the page, the server returns the saved list at once, then compares stamps and, if some changed, rebuilds only those parts while the page shows "Updating the list..." with progress, then refreshes the rows.
- **Update the list is a forced rebuild:** it ignores the stamps and re-reads every source.
- **Known limit, stated in the hover of "Updated ...":** a second store-text read on the same day, or a change made by a command-line step that does not touch the files above, is seen after Update the list.
- Nothing runs on a timer; nothing reads Google Play. A rebuild starts only when the page is opened or the button is pressed.

### 3.4 Performance targets (measured, not promised)

Measured in G1 on a synthetic workspace, cold and warm disk cache; if a target is missed, the design is simplified (for example stamps per project only), not the target quietly dropped. The report of the measurement goes to the user at the G1 checkpoint.

| Case | Target |
|---|---|
| Page open: saved list shown | ≤ 300 ms to the first rows |
| Stamp check, 20 projects, 300 games, 2,400 store pages | ≤ 200 ms warm, ≤ 1 s cold |
| One project changed (80 games) | ≤ 1 s |
| Full rebuild, 300 games | ≤ 5 s, with progress |
| Search, filter, sort in the page (300 games) | ≤ 50 ms per keystroke |
| Game page, 10 countries × 10 images | ≤ 500 ms; thumbnails lazy-loaded |

## 4. Server

| Method | Path | Purpose |
|---|---|---|
| GET | `/games` | Directory page |
| GET | `/games/<appId>` | Game page. A malformed or unknown `appId`: the page "We hold no data for this game" (404) |
| GET | `/api/games` | The saved list, plus whether an update is running and its progress |
| POST | `/api/games/rebuild` | Update the list (forced; token and same-origin as every POST) |
| GET | `/api/games/<appId>?project=<id>` | Game page data as that project sees it: decks per country, marks, image URLs, `infoViews` for its images, store text and keywords |

- Validation before any storage access: `appId` against the package id pattern, `project` against the project id pattern. Malformed API input: 400; unknown game, unknown project, or a project that does not use this game: 404.
- Images are served by the **existing per-project route** `/p/<id>/images/`, which already refuses library images the project does not reference. Icons use `/p/<id>/icons/<file>`: that route serves any file in the project's icons folder (it is not reference-gated), so the game data only ever carries icon file names taken from the index, never a path from the request. No new file-serving route.
- A game page request builds its data from one project's files (a few decks and records); it uses the index only to list the projects.

## 5. Actions

- **Update the list:** described above.
- **Open (project):** link to the project's workspace.
- **Check the store now** (D3): not in this plan. A store read belongs to a project's store lane with preview and approval (12D refresh, milestone 6). The game page shows "Store checked 27 Sep 2026". When the refresh exists, a "Refresh store data" link to the project is added there.

## 6. Milestones

Each: implement (Opus dev agent in its own worktree branch), tests + typecheck + Biome, cross-family code review (gpt-5.6-terra or gpt-5.6-sol), then the user checkpoint. **Nothing starts before R4, the category fix, suggestions UI, L0 to L4b and any other work the user queues ahead are merged.**

| # | Scope | What the user sees |
|---|---|---|
| G1 | Index (stamps, parts, merge, schema), `/games`, `/api/games`, rebuild with progress, directory page with search, filters, sort, flags, counts, "Games library" link on the home page, the performance measurement | Opens the library from the home page, finds Capybara Go by typing "capy", filters by Japan, sorts by images, hovers a flag, presses Update the list and watches it; sees the measured times |
| G2 | Game page: strips per country with marks, failed slots, store text and keywords folds with read dates, (i) through the shared popover, Viewing with, links back | Opens a game, sees which Japanese pictures are the US file, the same picture with new text, or a new picture; opens an (i) |

## 7. Files and conflict risks

New (each ≤ 300 lines): `src/library/games-index.ts` (schema, merge), `src/library/games-parts.ts` (project and library parts), `src/library/games-stamp.ts`, `src/server/routes-games.ts`, `src/view/games-html.ts`, `src/view/games-script.ts`, `src/view/game-html.ts`, `src/view/game-script.ts`; tests below.

Changed (small, additive): `src/server/app-server.ts` (one call to `gamesRoute` in the global routes), `src/view/home-html.ts` (one "Games library" link).

Reused unchanged: `src/view/flags.ts` (suggestions-ui), `src/view/action.ts`, `src/view/gallery-info.ts` (the (i) script), `src/analysis/records.ts` (`infoViews`), `src/reports/anchors.ts` (`samePicture`), `src/reports/match-check.ts` (the user's "different" answers), `src/analysis/brand.ts` (store-title split), `src/library/store-text.ts`, `src/storage`, `src/config/registry.ts`, `src/view/shell.ts`.

| Other work | Overlap | Risk |
|---|---|---|
| R4 (country reports) | Reads the same decks and store text; changes report and analysis files, none of ours | Low: no shared file |
| Wireframes L1 to L4b | L2 changes the (i) popover; we reuse it as is, so wireframes appear on the game page for free | Low (only if L2 changes the popover's data contract: we follow it) |
| Suggestions UI | Adds `flags.ts`, changes `app-server.ts` and `home-html.ts` | Low: we land after it and add one line each |
| Category fix, store-title fix | We read their helpers | Low: we call whatever helper they settle on |
| Store history (12D) | Adds the history fold later; per-project snapshots stay the source | None now |

## 8. Tests (node:test, no network)

- Merge: a game in two projects (competitor in one, chart game in the other) gives one entry with both roles; the newer deck per country wins; archived projects listed as such.
- Counts: distinct images across countries and projects; an image shared by two games counts for each; a page not sold there is dimmed and not counted; failed slots not counted; analysed counts only usable records of the game's own images.
- ASO words: one-part and two-part titles, full-width separators, different ASO words per country.
- Keywords: top 3 per country; missing store text gives the plain message.
- Stamps: a new run, a job journal change, a refresh record or a new store text date rebuilds exactly the right part; nothing else is re-read (spy on reads). Forced rebuild re-reads everything, including a deck rewritten in place.
- Corrupt or missing index file is rebuilt; the index is written only through `Storage`.
- Routes: malformed API input 400; unknown game, unknown project and a project that does not use the game 404; POST without token refused; image and icon URLs come only from index data.
- Rebuild: other requests are answered while it runs; a second rebuild request joins the running one.
- Game page marks: same file, same picture with new text, new picture, a user "different" answer overrides the perceptual match, duplicates and reordered near-identical pictures matched one-to-one, no main-country page, failed slot.
- Page (fake DOM, as today): search, filter, sort; every action shows busy then success or error; names and texts escaped; flags present for every country mention (marks, ranks, tooltips, folds, filters).
- Performance: the measurement script for section 3.4 (not a pass/fail unit test).

## 9. Risks

| Risk | Mitigation |
|---|---|
| The index shows stale data | Stamps per part; "Updated ..." time with the known limit; Update the list is a forced rebuild |
| Two projects disagree about a game (different dates, settings) | The directory shows the newest page per country and names its project; the game page is always "viewing with" one project |
| Slow on a big workspace | Part-wise rebuild, progress over 1 s, lazy thumbnails, targets tested |
| Rating often missing | Shown only when a lookup cached it (D2) |
| Scope creep into history or analysis tools | Game page is read-only; history arrives with 12D |

## 10. Decisions for the user

| # | Question | Recommended |
|---|---|---|
| D1 | Directory layout: compact cards side by side (as proposed), or a sortable table | Cards (the pillar layout rule); a table view can come later |
| D2 | Rating: show it only when a lookup already cached it, or add the rating to every store read (a one-field change in the Play client, done after all other work) | Only when cached now; add the field with the next store-reading change |
| D3 | "Check the store now" on the game page: leave it to the store-history refresh (milestone 6), or add a small free "re-read the store text of this game" step (with a confirm) to this plan | Leave it to the store-history refresh (keeps this plan lean) |
| D4 | Which projects' games are listed: all, including archived (tagged), or only active projects | All, tagged "(archived)" |
| D5 | ASO words and keywords on the directory row: main country only plus "different in N countries", or every country | Main country plus the unfold, as proposed |

## Review outcome

Reviewer: gpt-5.6-terra, 2026-09-29 (plan and code excerpts passed inline; the sandbox could not read the repo). Raw review: `docs/reviews/plan-games-library-review-gpt.md`. 14 findings: 10 accepted, 4 partly accepted, 0 declined outright.

| # | Finding | Outcome | Reason |
|---|---|---|---|
| 1 | Not scheduled after everything; G3 added scope | Partly accepted | "After anything else queued ahead" added and G3 removed (D3 now points to the store-history refresh). Declined: waiting for store history (12D) itself, since the user named R4, the category fix, suggestions UI and wireframes, and 12D is future work that simply adds its fold later |
| 2 | Project stamp misses decks rewritten in place | Accepted | Decks change only through a download (new run manifest) or a refresh (`state/refreshes.json`); both are in the stamp now; forced rebuild covers the rest |
| 3 | Library stamp misses same-key rewrites; forced rebuild unspecified | Accepted | Update the list is an explicit forced rebuild; the known limit is stated; analysis changes are caught through the project's job journal |
| 4 | Analysed count cannot come from the analysis folders | Accepted | Images belong to games through decks; analysed = those images with a usable record |
| 5 | Synchronous rebuild cannot show progress | Partly accepted | The saved list is returned at once; the rebuild yields between games so progress polls are answered. Not moved into `src/jobs` (it only reads and writes one cache file; adding a job kind would touch higher-priority code) |
| 6 | Shared store text mixed with a project's older screenshots | Accepted | Always labelled with its read date, and "read after this project's screenshots" when so |
| 7 | `samePicture` has no one-to-one matching or user overrides | Accepted | Fixed matching order, tie rules, one-to-one, and the viewing project's "different" answers |
| 8 | Checked vs with-images countries conflict | Accepted | `checked` list; dimmed flags for "not sold here"; filters and counts use pages with screenshots |
| 9 | 400 vs 404 inconsistency; project parameter | Accepted | Pattern checks before storage; 400 for malformed API input, 404 for unknown or unrelated |
| 10 | Icons route is not reference-gated | Accepted | Claim corrected; icon names come only from the index |
| 11 | Failed downloads (`imageId: null`) | Accepted | Grey placeholder at its position, no mark, not counted |
| 12 | Country mentions without flags | Accepted | Every country mention goes through the flag helper |
| 13 | Conflicting metadata across projects | Partly accepted | Precedence rule added; flagging disagreements declined as over-engineering for cosmetic fields |
| 14 | Performance numbers unproven | Partly accepted | Stated as measured targets (cold and warm) with a simplification rule; the analysis walk was removed from page open. Kept the targets as the bar for G1 |

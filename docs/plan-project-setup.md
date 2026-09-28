# Plan: project setup and multiple projects (save and resume)

Status: **APPROVED by the user on 2026-09-27, including D1 to D6.** Added afterwards at the user's request: the shared image and analysis library (section 12A), reviewed separately by gpt-5.6-terra. No implementation yet.
Authority: `memory/PILLARS.md`. Builds on `docs/plan-v2.md` (approved) and the code as of 2026-09-27.
Review: gpt-5.6-terra (cross-family), see "Review outcome" at the end.

## 0. Summary

- **New first stage.** The user creates a project in the tool's own page: their game (Play link or package ID), competitors (link, ID or name search), countries (checkboxes with a language each) and charts. The tool writes the settings and creates the workspace itself. No file is ever edited or moved by the user.
- **One local app for all projects.** `npm start` opens a projects home. Each project opens on the screen that matches where it stopped. The existing gallery becomes the project's main workspace view.
- **State is derived from what is on disk**, not from a separate status flag that can drift. The only stored state is one job journal per project (what is running or was interrupted, and what an approved batch has spent) and a cached summary for the home screen.
- **Resume everywhere.** Store reading, downloads and analysis all resume from where they stopped. Downloads resume from an immutable copy of the approved list, without a new approval (no cost). Analysis resumes with a short "continue" approval showing what was already spent, because it costs money.
- **Shared library across projects** (section 12A): image files, pixel facts and analysis records live once in `workspace/_library/`, keyed by content hash (and, for analyses, schema, prompt and model versions). Projects hold only references and their own data. An image is never downloaded or analysed twice; reuse is free and the first payer is recorded.
- **Nothing is changed without the user's say-so**: the Rogue Legend import is offered on the home screen with a dry-run summary and runs only when the user presses Import.
- **One AI job at a time across all projects**, and one store-reading/downloading job at a time across all projects. The two may run at the same time, but never in the same project.
- **Settings are split** into project settings (per project, written by the UI) and tool defaults (one tracked file). The loader merges them into the exact `Config` shape the current code already reads, so nothing downstream changes.
- **Rogue Legend is imported into the new model**: its settings become `project.json`, and its images, facts and analysis records move into the shared library by hardlink with hash checks. Nothing is re-downloaded or re-analysed. Gates prove the analysis approval fingerprints and the report freshness are identical before and after.

## 1. User flows

Plain wording on every screen. No internal codes, no file paths shown unless the user asks for them ("Show files" link in advanced details).

### 1.1 Projects home

```
Store Screenshot Recipe                                   [+ New project]

 [icon] Rogue Legend                     Pilot ready: 17 images to analyse
        Pocket Haven · Role Playing · 14 competitors · 9 countries
        1,418 images downloaded · 1 of 18 pilot images analysed
        Next: run the pilot                                  [Open]  [...]

 [icon] Other Game                       Download stopped at 812 of 1,418
        ...                                          [Resume]  [Open]  [...]

 Working now: Rogue Legend, analysing image 5 of 17 ($0.94 so far)
```

- One card per project: icon, name, developer, category, counts, a plain status line, a progress bar when something is running or stopped, and the next step as a button.
- `[...]` menu: Settings, Rename, Archive (hides the card; nothing is deleted). Deleting a project's files is out of scope for this stage.
- A "Working now" strip at the bottom shows the one running AI job and the one running store job, whichever project they belong to.
- Order: last opened first. Archived projects sit behind a "Show archived" link.

### 1.2 New project wizard

Five short steps on one page, each saved as soon as it is confirmed. The project exists (as "Setting up") from the moment step 1 is confirmed, so closing the browser never loses work.

**Step 1: Your game**
```
Paste your game's Google Play link or package ID
[ https://play.google.com/store/apps/details?id=com.pockethaven.roguelegend ]  [Look up]

 [icon] Rogue Legend
        Pocket Haven · Role Playing · 100,000+ downloads · 4.6 stars
        This is my game  [Confirm]      Not it? Paste another link.
Project name: [ Rogue Legend ]
```
- Accepts a Play URL (any `hl`/`gl` parameters, mobile or desktop), a bare package ID, or `market://details?id=...`. A game name is not accepted here, because picking the wrong "own game" is costly; the message says "Paste the link from your game's Google Play page".
- If the app is not in a game category, a warning: "This app is listed under Tools, not a game category. Charts will be switched off." The user can still continue.
- If the app is not available in the United States: "This game is not on Google Play in the United States. The first analysis compares English pages from the United States, so it needs a game that is available there." Blocks in V1.

**Step 2: Competitors**
```
Add a competitor: [ Survivor                    ] [Search]
   (paste a link or package ID to add it directly)

 Top matches for "Survivor":
   [icon] Survivor.io        Habby · 4.5 stars           [Add]
   [icon] Survivor!.io       Some Dev · 4.1 stars        [Add]
   [icon] Survivors: ...     ...                         [Add]

 (Search results show only what Google Play's search returns: icon, name, developer and
  rating. Category and downloads appear on the confirmation card after you pick one.)

 Your competitors (drag to reorder; order = priority)
  1. [icon] Capybara Go      Habby       [Direct competitor v]   [Remove]
  2. [icon] Mini Tales       ...         [Direct competitor v]   [Remove]
  3. [icon] Archero 2        ...         [Same audience v]       [Remove]
 You need at least 5 whole competitor decks for the core check. You have 3.
```
- Link or ID: looked up and added directly (with the same confirmation card).
- Name: top 8 matches with icon, name, developer and rating (what search returns); the user picks one, and the confirmation card then shows category and downloads from one details lookup. No automatic "best match". Fetching details for all 8 matches up front would take about 7 seconds at the store pacing, so it is not done.
- "How close is it?" dropdown per competitor, in plain words: Direct competitor / Same audience / Big reference game (maps to the existing tiers `direct`, `same_audience`, `reference`). Default: Same audience.
- Duplicates and "that's your own game" are refused with a plain message.
- Order is the default priority (the existing "config order is the default core order" rule). The core pick in the gallery still decides the real core.

**Step 3: Countries**
```
Which Google Play countries?          United States (English) is always included.

 [x] Japan            Language [Japanese v]
 [x] South Korea      Language [Korean v]
 [x] Taiwan           Language [Traditional Chinese v]
 [x] Hong Kong        Language [Traditional Chinese v]
 [x] Thailand         Language [Thai v]
 [x] Vietnam          Language [Vietnamese v]
 [x] Indonesia        Language [Indonesian v]
 [x] Philippines      Language [English v]
 [ ] Germany          Language [German v]
 ... (more countries)                                    [Tick all in Asia]
```
- The list comes from a tracked country catalogue (section 4.4) with a default language per country and the allowed alternatives (e.g. Philippines: English or Filipino; Hong Kong: Traditional Chinese or English).
- United States (English) is fixed, ticked and not editable: it is the baseline and the core-check market.
- One language per country in this stage (the current schema allows more; the UI does not offer it yet).

**Step 4: Charts**
```
Also include the top-grossing games in your game's category (Role Playing)?
 (o) Yes, the top [10 v] in each country        ( ) No
 Chart games are downloaded and shown, but only analysed if you pick them later.
```
- Depth 1 to 50, default 10. The category comes from the user's game (step 1) and is shown in words.

**Step 5: Review and check the store**
```
Rogue Legend · 14 competitors · 9 countries · top 10 grossing charts
                                  [Check the store]  (no images are downloaded yet)
```
- "Check the store" starts the existing download preview (store pages and charts, no images) as a background job with live progress, then shows the existing download approval numbers (store pages, images, disk space, "0 images sent to AI"). **Approve download** starts the download. This is the existing Setup flow, moved from the terminal into the page.
- After the download, the tool builds the deck views itself and opens the project workspace (the gallery) on the competitor pick.

### 1.3 Existing flow, now inside the project

Download preview → approval → download → gallery and core pick → pilot → core check → report. Unchanged in logic; each step is reached from the project's page, with a step bar at the top:

```
All projects / Rogue Legend                                     [Settings]
 Settings ✓ ─ Download ✓ ─ Pick competitors ✓ ─ Pilot ● ─ Core check ─ Recommendations
```

### 1.4 Editing a project later

- Settings screen = the wizard steps 2 to 4 on one page, prefilled. Our game cannot be changed (create a new project instead).
- Every edit autosaves. A banner then says what is new, for example: "2 new competitors and 1 new country since the last download: about 64 store pages to check." with **Check the store for new items**.
- The preview only reads what is new (section 6.3). Nothing already downloaded is fetched again. The approval screen says "0 images downloaded again".
- Removing a competitor or country hides it from views and picks. No files or analyses are deleted, so adding it back costs nothing. If a removed competitor was in the core pick, it is dropped from the pick and the user is told. Reports built on the earlier pick stay as dated history, labelled "Based on an earlier pick", and the next analysis needs the pick to pass the whole-deck rule again.
- A separate "Refresh from the store" action (re-read every page to catch store updates) is listed as later work; it belongs with dated snapshots.

### 1.5 Resuming

- Reopening a project lands on its current step (section 5.2).
- If a job was interrupted (the tool was closed, the computer slept, a crash), the project page and the home card say so, in plain words, with one button:
  - "Checking the store stopped at 120 of 271 pages. [Continue]" (no approval needed; no cost; cached pages are not read again).
  - "Download stopped at 812 of 1,418 images. [Resume download]" (no new approval: same approved list, no AI cost).
  - "Analysis stopped at image 9 of 17. [Continue: 8 images left, about $1.60]" (opens the approval panel with the remaining numbers, what this batch already spent, and its spending limit; one click to approve).

## 2. Data model and on-disk layout

### 2.1 Layout

```
configs/
  defaults.json                 NEW (tracked): tool defaults (models, caps, estimates, download pacing, taxonomy)
  countries.json                NEW (tracked): country catalogue with default and allowed languages
  rogue-legend.json             kept, unchanged; only the migration and legacy --config read it
workspace/                      gitignored, as today
  projects.json                 NEW: project registry (an index; rebuildable)
  _library/                     NEW: shared images, facts and analysis records (section 12A)
  .locks/                       NEW: ai.lock, store.lock, server.json
  _shared/cache/play/           NEW: lookup and search cache shared by all projects
    details/<appId>/<gl>-<hl>.json
    search/<sha of term+gl+hl>.json
  <project id>/                 one folder per project, same layout as today, plus:
    project.json                NEW: this project's settings (written only by the tool)
    icons/<appId>.png           NEW: cached store icons for the home, wizard and headers
    state/job.json              NEW: the one job journal (running or interrupted job, progress, spend ledger)
    state/store-check.json      NEW: work list and checkpoints of the current store check (preview)
    state/approved/<plan hash>.json  NEW: immutable copy of each approved download list (resume reads only this)
    state/charts.json           NEW: last chart lists used by a download (reused by incremental previews)
    state/downloaded.json       NEW: settings fingerprint and deck keys of the last completed download
    refs.json                   NEW: references into the shared library (replaces images/db.json, section 12A)
    decks/ runs/ orders/ reports/ pending/ own/ views/ cache/ run-config.json   unchanged
    images/ analysis/ objects/  move into the shared library at Import (synthesis objects stay here)
```

- Project IDs match `^[a-z0-9-]+$` (already the config rule), so `_shared` and `.locks` can never collide with a project.
- `state/job.json` is the only job-status file. The old `pending/analysis-status.json` is read once as a fallback when no journal exists yet (compatibility) and is no longer written.

### 2.2 Project settings (`project.json`)

```ts
ProjectSettings = {
  schemaVersion: 1,
  id: "rogue-legend",                    // folder name, fixed at creation
  name: "Rogue Legend",                  // display name, editable
  createdAt, updatedAt,
  ourApp: { id, name, developer, genreId, iconFile? },
  competitors: [{ id, name, developer?, genreId?, tier: "direct"|"same_audience"|"reference", iconFile?, addedAt }],
  markets: [{ gl, hl, label }],          // US-English first, always present
  charts: { enabled: boolean, collection: "GROSSING", depth: 1..50 },
  category: "auto" | string,             // our game's genreId, filled at creation
  ownAssets?: { dir, psd? },             // only Rogue Legend has this in this stage
  overrides?: Partial<ToolDefaults>,     // advanced values that differ from defaults; not in the UI yet
  archived?: boolean,
}
```

### 2.3 Tool defaults (`configs/defaults.json`)

Everything in today's `Config` that is not project-specific: `workspace`, `download`, `core` (market "us", caps, stability, device classes), `review`, `budget`, `estimates`, `run`, `tierWeights`, `models`, `taxonomy`. Values = today's `configs/rogue-legend.json` values.

### 2.4 Loader (reuse, no downstream change)

- New `loadProject(id)` in `src/config/project.ts`: reads defaults + `project.json` (+ `overrides`, deep-merged), builds the object in today's `Config` shape (`project = id`, `markets[0].baseline = true`, `charts.depth`, etc.) and validates it with the **existing `ConfigSchema`**, including its cross-field rules (one baseline, core market, reviewer family, no Astra outside special review).
- It returns today's `LoadedConfig` with **`root` set explicitly to the repo root**. Today `loadConfig` derives the root as the config file's grandparent folder; for `workspace/<id>/project.json` that would be `workspace/`, which would break taxonomy, prompts and the PSD helper paths. `loadConfig` keeps its current behaviour for legacy files and tests.
- `hash` = stable hash of the merged config (as today).
- `ConfigSchema` changes, all backward compatible: `charts.enabled` (default true); `ownAssets` optional; nothing else. `buildPlan` skips charts when disabled; `own-assets` is skipped (and shown as "not set up") when `ownAssets` is absent.
- **Draft vs runnable.** A project is a draft until it has our game, at least one competitor and US-English. Drafts are validated only with `ProjectSettingsSchema` (which allows zero competitors). `loadProject` (the strict, runnable `Config`) is called only for non-draft projects. The home, wizard, settings and state routes work on drafts without it; the store check, download and analysis routes refuse a draft with "Add at least one competitor first."

### 2.5 Project registry (`workspace/projects.json`)

```ts
Registry = {
  version: 1,
  projects: [{ id, name, ourAppId, iconFile?, createdAt, lastOpenedAt, archived,
               summary?: { stage, line, updatedAt } }]   // cached for the home screen
}
```

- It is an index, not the source of truth. `project.json` in each folder is. If the registry is missing, unreadable or out of step, the tool rebuilds it by scanning `workspace/*/project.json` (a corrupt registry is renamed `projects.json.bad-<date>` first, never silently discarded).
- Written atomically (existing `writeJsonAtomic`), only by the server process holding `server.json` (section 7), or by the migration command under the same lock.
- The cached `summary` is refreshed whenever a project's state is computed; the home screen shows it immediately and refreshes each card in the background.
- Slugs: from the game title (`Rogue Legend` → `rogue-legend`), `-2`, `-3` on collision. The user never sees or edits the ID.

## 3. Play lookup and search

Reuse `google-play-scraper` (already a dependency) through the existing `PlayClient`, extended; no new library.

### 3.1 Input parsing (`src/play/input.ts`, pure function)

- `https://play.google.com/store/apps/details?id=<pkg>[&hl=..&gl=..]` (also `m.` host, trailing slashes, extra parameters) → package ID.
- `market://details?id=<pkg>` → package ID.
- A string matching the package pattern (`^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$`) → package ID.
- Any other Play URL (developer page, search page) → "This is not a game's page. Open the game on Google Play and copy that link."
- Anything else of 2 to 100 characters → a name search (competitors only).

### 3.2 PlayClient additions

- `details(appId, gl = "us", hl = "en")` → `gplay.app()`, mapped to `PlayDetails { appId, title, developer, genre, genreId, icon, installs, score?, url, available }`. 404 → `available: false`.
- `search(term, gl = "us", hl = "en", num = 8)` → `gplay.search({ term, num, lang, country })`, mapped to `PlayHit { appId, title, developer, icon, score? }`. Downloads and category appear after the user picks (one `details()` call), since search results do not include them. Hits are shown in store order; nothing is auto-picked.
- `icon(appId, url)` → downloads the icon once into `<project>/icons/`, only over https from Google's image hosts (`*.googleusercontent.com`, `*.ggpht.com`). Redirects are not followed (`redirect: "manual"`; a redirect is treated as a failure). 10 s timeout, image content type required, read as a stream and cut off at 1 MB, decoded by `sharp` with `limitInputPixels` of 4 megapixels, re-encoded to 128 px PNG. Any failure shows a letter placeholder.
- Every scraper response is checked with a Zod schema of just the fields we use (external boundary); a mismatch becomes "Google Play answered in an unexpected way" and is logged with the raw shape.
- Cache files read by the new code (lookup and search cache, store-check checkpoints) are parsed with the same schemas; an unreadable entry is moved aside and fetched again. Retrofitting schemas onto older files (image database, deck manifests) is not part of this stage.

### 3.3 Throttle

- **One `PlayClient` per server process**, shared by lookups, previews and all projects, so the pacing is global.
- Today `politely()` computes its wait without serialising, so two concurrent callers can both fire at once. It becomes a promise-chain queue (a few lines, no new dependency) with **two priorities**: interactive (wizard lookups and searches) goes ahead of background (preview page reads). Spacing stays `download.requestDelayMs` (800 ms).
- Image downloads keep their own existing pacing (`imageConcurrency`, `imageDelayMs`); they hit the image CDN, not the scraper pages.
- The wizard only searches on Enter or the Search button (no search-as-you-type), and ignores repeats of the same term within the cache time.

### 3.4 Caching

- Shared cache in `workspace/_shared/cache/play/`: details 24 hours, search 6 hours, same `fresh()` mtime rule as today. Errors are never cached (as today).
- Project store reads keep using the project cache folder (unchanged), so existing cached pages for Rogue Legend stay valid.

### 3.5 Errors (plain language)

| Case | Message |
|---|---|
| 404 on details | "No game with this ID on Google Play in the United States." |
| Not a game category | Warning, see step 1 |
| Search with no hits | "No games found for 'X'. Try the exact name, or paste the game's link." |
| Network error, 429, 5xx | One retry after 3 s (as today), then "Google Play did not answer. Try again in a minute." |
| Unexpected response shape | "Google Play answered in an unexpected way. Paste the game's link instead." (search can break when Play changes its pages; links and IDs keep working) |

## 4. Validation with Zod

All at system boundaries, with `z.strictObject` for request bodies and plain-language messages mapped from issues.

1. **Request bodies** (new routes): `LookupQuery`, `SearchQuery` (2 to 100 characters), `CreateProjectBody` (our app ID + name), `SettingsPatch` (competitors ≤ 60, markets ≤ 40, depth 1..50, tiers enum, IDs by regex), `DownloadRunBody` (`planHash` 64 hex), `ContinueBody`. Size cap stays 64 KB.
2. **Project ID in URLs**: `^[a-z0-9-]{1,60}$` and must exist in the registry; checked before any path is built (no path traversal across projects).
3. **Files**: `ProjectSettingsSchema`, `RegistrySchema`, `JobJournalSchema`, `StoreCheckSchema`, `ApprovedDownloadSchema`, `LockSchema`, `CountryCatalogueSchema`, `ToolDefaultsSchema`, and the Play cache entries. Every file a resume depends on is parsed before use. The merged result goes through the existing `ConfigSchema`.
4. **Scraper output**: `PlayDetailsRaw`, `PlayHitRaw` (section 3.2).
5. **Semantic rules** in `ProjectSettingsSchema.superRefine`: no duplicate competitor, a competitor is not our game, US-English present and first, one language per country, catalogue languages only.
- Soft rules are warnings, not errors: fewer than 5 competitors ("the core check needs at least 5 whole decks"), competitor not available in the US ("its English deck is missing; it cannot be in the core check").

### 4.4 Country catalogue (`configs/countries.json`)

About 40 Play countries: `{ gl, label, languages: [{ hl, label }], defaultHl, region }`. Seeded with the proven values (HK = zh-TW, PH = en, TW = zh-TW). Default ticks for a new project: the current Asia set (JP, KR, TW, HK, TH, VN, ID, PH) (**user decision D1**).

## 5. State machine and resume

### 5.1 Stages (derived, never stored as truth)

`projectState(id)` reads the disk and returns `{ stage, detail, progress?, next, notices[] }`. Order of checks:

| Stage | Plain label | True when |
|---|---|---|
| `setup` | Setting up | `project.json` exists but has no competitors, or no download has completed and no preview exists |
| `preview` | Ready to download | a download preview exists for the current settings and is not yet approved; or store checking is running / stopped |
| `downloading` | Downloading | job journal says a download is running or stopped |
| `pick` | Pick competitors | a completed download exists (latest setup run manifest) and the saved pick does not pass the whole-deck fit rule |
| `pilot` | Pilot | the pick passes the fit rule and the latest pilot report is not current (see "current" below) |
| `core` | Core check | the pilot report is current, and the core report is not |
| `recommendations` | Recommendations ready | the latest core report is current and has recommendations. The page asks: "How do you want to expand?" |
| `expand` | Expansions | an expansion increment exists (chosen, previewed, running, stopped or done). See below |

- Substates for pilot, core and each expansion increment: ready / running / stopped / failed (the last error shown).
- **"Current" report** reuses the existing freshness rule, not a new one: `buildAnalysisPlan(stage).synthesisNeeded` is false, i.e. no new images and the latest report's `dataHash` equals `batchDataHash` of the current games, positions, image IDs, usable record versions, prompt/schema versions and taxonomy. A change of pick, decks, taxonomy or records therefore makes the report "not current", and the page labels it "Based on an earlier pick or data" while keeping it visible as dated history.
- **Expansions in the state model.** The state model and the job journal carry a list of increments `{ id, kind: "competitors"|"countries"|"charts", choice, approvedPlanHash?, state }`, so `recommendations → expand` is defined now and needs no data change later. After the core, the page shows the expansion question as the user specified (more English competitors and/or countries by checkbox, each with its image count). **Running an expansion increment (layer diffs, per-country recommendations) is not built in this stage**: the analysis code refuses layer diffs today ("arrives with the country expansion step"). Choices made now are saved and shown as "waiting for the expansion step".
- **The fit rule is enforced by the server, not only by the step bar.** `postAnalysisPlan` and `postAnalysisRun` (and the CLI `pilot`/`core`) refuse when there is no completed download, or when the saved pick does not pass the whole-deck fit rule for the stage (the pilot needs `core.pilotCompetitors` whole decks, the core needs `core.minCompetitors`), in plain words: "Pick at least 5 competitors whose whole English decks fit within 100 images." Today neither endpoint checks this.
- Notices, independent of stage: "New items to download" (settings fingerprint differs from `state/downloaded.json`), "Download incomplete: 3 images failed", "Another project is using the AI right now".
- Deriving it means the state can never disagree with the files, and Rogue Legend needs no stored state to migrate.
- Cost: reading the image database and 18 to 100 analysis records per project is milliseconds; the home screen uses the cached registry summary first.

### 5.2 Landing screen

| Stage | Opens on |
|---|---|
| setup | Settings (the wizard, at the first incomplete step) |
| preview, downloading | Download screen (progress or approval numbers) |
| pick, pilot, core | Workspace (the gallery), with the status box and the report at the top when there is one |
| recommendations, expand | Workspace, report at the top, with the expansion question below it |

The last-used country filter and open panels are remembered per project in the browser (convenience only; wrapped in try/catch).

### 5.3 Job journal and resume

`state/job.json`, the only job-status file (versioned, Zod-checked):
`{ version: 1, jobs: { store?: Job, ai?: Job }, batches: Batch[], increments: Increment[] }`, where
`Job = { id, kind: "store-check"|"download"|"analysis", planHash, stage?, lockNonce, startedAt, heartbeatAt, progress { done, total, message, spentUsd }, state: "running"|"finished"|"stopped"|"failed", errors[], error? }` and
`Batch = { id, stage, firstApprovedPlanHash, limitUsd, spentUsd, runs: [runId] }` (the spend ledger of one approved analysis batch across stops and continues).

- Written atomically on every progress step, plus a heartbeat every 15 s. The in-memory state of `job.ts` is only a view of this file (section 5.4).
- **Interrupted** = `state: "running"` but its lock is gone, stale or owned by another nonce (section 7). It is then shown as "stopped".

| Job | What is already durable | Resume |
|---|---|---|
| Store check (preview) | `state/store-check.json` is written before the first request: the target list and charts to read. Each chart and store page result is checkpointed into it as it completes (today `buildPlan` writes only at the end) | "Continue" reads only the unfinished targets, using the checkpointed results for the rest regardless of cache age (up to 7 days). The progress line uses the checkpoint ("120 of 271"). The finished check becomes the download preview. No approval (no images, no AI) |
| Download | On approval, the plan is copied to `state/approved/<plan hash>.json` (immutable, write-once). Image files by hash; the image database saved every 10 images (today every 50) | "Resume download" reads **only that approved copy**, never `pending/download-plan.json` and never the current settings, so a later store check or settings edit cannot change it. Images already in the database are skipped; up to 10 may be fetched again. Deck manifests and the run manifest are written only at the end, so the views stay consistent until then. No new approval: same list, no cost. If the approved copy is older than 7 days, the tool re-checks the store first and asks again. Settings edits made meanwhile become the next, separate increment |
| Own assets, deck views | Idempotent | Re-run automatically after a download |
| Analysis | One record per image, written the moment it is done; every model answer cached in `objects/` by its full input as soon as it arrives; the batch spend ledger updated after every call | "Continue" rebuilds the plan: finished images are reused; the panel shows the remaining images and cost, **already spent in this batch, and the batch limit**; the user approves once (money is involved, PILLARS rule). The runner gets `limit − already spent` as its budget and checks it before each call (today `runApproved` starts every run at $0). Synthesis re-runs from the answer cache, so a stop during synthesis costs nothing to redo |

- **Known limit:** a crash while a model call is in flight loses that one answer, and the call is made again on Continue (at most one image, about $0.25, per stop). The Claude and Codex command-line tools have no request IDs to reconcile against, so this is accepted and stated on the Continue panel ("The image being analysed when it stopped is analysed again"). With the per-image calls in use, only one call is ever in flight.

### 5.4 Job-state isolation fix

`src/analysis/job.ts` keeps one in-memory state and one status-file path for the whole process. With several projects, a status request for project B would return project A's running job. The state gains `projectId`; `jobState(loaded)` returns the in-memory state only when it belongs to that project, otherwise that project's journal plus "another project is analysing". The in-memory state is written through to `state/job.json`, which stays the single source.

## 6. Server, API and UI

### 6.1 Server

- `npm start` (new) and `npm run gallery` (kept, alias) start one local server on 127.0.0.1:4777 and open the projects home. `--project <id>` opens that project directly.
- Single instance, in this order: (1) take `workspace/.locks/server.lock` with the lock procedure of section 7 (random nonce); (2) listen; (3) only then write `server.json` `{ pid, port, nonce }`. A second start that cannot take the lock reads `server.json` and calls `GET /api/health` on that port, which must answer with the same nonce: if it does, the second start opens the browser there and exits; if not, the lock is treated as stale and recovered. When the tool holds the lock but port 4777 is taken by some other program, it falls back to a free port (as today) and records that port, so there is still only one tool server.
- Security unchanged and applied to every new route: local host names only, same-origin check, per-server token on every POST/PUT, JSON only, 64 KB cap. Static files served only from a project's `images`, `views`, `own`, `icons` folders; still no HTML/JS/SVG served as files.
- `gallery-server.ts` (183 lines) is split to stay under 300: `http-util.ts` (send, readBody, localHost, sameOrigin, token check), `router.ts` (small route table with `:id` parameter, ~80 lines), `routes-home.ts`, `routes-project.ts`, `routes-play.ts`, `routes-jobs.ts`. Handlers stay pure `(ctx, body) => ApiResponse` like today's `api.ts`, so they are testable without HTTP.

### 6.2 Endpoints

Global:

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Projects home page |
| GET | `/new` | New project wizard page |
| GET | `/api/projects` | Registry with cached summaries |
| POST | `/api/projects` | Create a project from a confirmed game `{ appId, name }` → `{ id }` |
| GET | `/api/play/lookup?q=` | Parse input → details card, or a plain error |
| GET | `/api/play/search?q=` | Top matches for a name |
| GET | `/api/countries` | Country catalogue |
| GET | `/api/jobs` | What is running in each lane, for the "Working now" strip |
| GET | `/api/health` | `{ nonce }`, for the single-instance check only |
| GET | `/api/import` | Legacy projects found (dry-run summary) |
| POST | `/api/import` | `{ id }`: import one after the user presses Import (section 8) |

Per project (`/p/:id/...`):

| Method | Path | Purpose |
|---|---|---|
| GET | `/p/:id/` | Redirect to the landing screen (5.2) |
| GET | `/p/:id/settings` | Settings page (wizard prefilled) |
| GET | `/p/:id/download` | Download page |
| GET | `/p/:id/views/gallery.html` | Workspace (existing gallery) |
| GET | `/p/:id/api/state` | Derived state (5.1) |
| GET/PUT | `/p/:id/api/settings` | Read / autosave settings; response includes "what's new to download" |
| POST | `/p/:id/api/archive` | Archive or unarchive |
| POST | `/p/:id/api/store-check` | Start the (incremental) preview job |
| GET | `/p/:id/api/download/plan` | Approval numbers of the saved preview (reuses `describePlan` / `previewMarkdown`) |
| POST | `/p/:id/api/download/run` | `{ planHash }`: start or resume the approved download |
| GET | `/p/:id/api/job` | Job journal and live progress |
| GET/POST | `/p/:id/api/selection`, `/api/analysis/plan`, `/api/analysis/run`, GET `/api/analysis/status`, `/api/analyses`, `/api/report` | Existing endpoints, unchanged logic, now per project |

- The gallery script today calls absolute `/api/...` paths. It gets an injected `API_BASE = "/p/<id>/api"` (in the page's JSON data), and every call goes through one helper (`api(path)`) that prefixes it. Image paths are already relative (`../images/`), so they keep working under `/p/<id>/views/`.
- **Route inventory for the move** (each gets an integration test through the real server): today `/` → redirect, `/views/gallery.html` (rendered page with token), GET `/api/selection`, `/api/analysis/status`, `/api/analyses`, `/api/report?stage=`, POST `/api/selection`, `/api/analysis/plan`, `/api/analysis/run`, static `images/`, `views/`, `own/`. After the move, the old unprefixed paths answer with a redirect to the most recently opened project's page (GET) or 410 "This page is out of date; reload it" (POST), so a gallery tab left open from before the upgrade cannot write to the wrong project. The report API keeps returning the markdown path for the "Show files" link only.

### 6.3 Incremental download (reuse `buildPlan` and `runDownload`)

- `buildTargets` is unchanged. The preview gets an `incremental` mode. A target counts as "already downloaded" only if it is in the last completed download (`state/downloaded.json`) **and** its deck manifest passes an integrity check: status `ok` with every slot's image in the image database and its file on disk, or status `unavailable` (a confirmed store answer, which the later "Refresh from the store" action can re-check). Everything else is new or incomplete and is read again: new targets, decks with status `error`, and decks with failed or missing images (only the missing images are downloaded).
- Charts: reused from `state/charts.json` for countries already covered at the same depth; fetched only for new countries or a larger depth.
- The approval screen shows new store pages, new images, "0 downloaded again", and disk space.
- `runDownload` writes deck manifests only for new targets, and the run manifest's `decks` holds the **full merged set** (existing manifests from `decks/` plus the new ones), because the views read the latest setup run manifest (`latestRun`). A new `added` field lists the new deck keys.
- `state/downloaded.json` records the settings fingerprint and the deck keys, for the "new items" notice.

### 6.4 UI components

Same approach as today: deterministic HTML from TypeScript templates, plain JS in the page, no framework, no bundler, CSS tokens with dark mode. New modules:

| Module | Role | Budget |
|---|---|---|
| `view/shell.ts` | Shared CSS tokens (moved out of `gallery-html.ts`), header with "All projects", project name, step bar | ~150 |
| `view/home-html.ts`, `view/home-script.ts` | Projects home, cards, Working-now strip, polling `/api/jobs` every 2 s while something runs | ~120 + ~150 |
| `view/wizard-html.ts` | Wizard and settings page skeleton | ~120 |
| `view/wizard-game.ts`, `wizard-competitors.ts`, `wizard-countries.ts` | Step scripts; competitors reuse the gallery picker's drag-and-drop pattern | ~150 each |
| `view/download-html.ts`, `download-script.ts` | Progress, approval numbers (rendered with the existing `markdownToHtml`), Approve download, Resume | ~100 + ~120 |
| `view/gallery-html.ts` | Existing gallery, now inside the shell; `API_BASE` injected | ≤ 300 after moving CSS out |

Accessibility: buttons and labels, keyboard reorder (the picker already supports it), `aria-live` progress.

### 6.5 CLI and Claude Code command

- CLI gains `--project <id>` (default: the most recently opened project). `--config <file>` still works for tests and legacy use.
- New `npm run migrate` (dry run by default, `-- --yes` to apply).
- `.claude/commands/analyze.md` passes `--project`.
- README updated: `npm start` is the way in.

## 7. Concurrency and locking

**Decision: one AI job at a time globally, and one store job (store check or download) at a time globally. An AI job and a store job may run together, but never in the same project.**

Why global for AI:
- All projects share the same Claude and Codex subscriptions and their rate limits. Two batches in parallel would trigger rate-limit errors, and the "stop after 3 identical errors" rule would stop both.
- This machine already hit low memory during one step; two vision batches with image copies in memory make that worse.
- The approval numbers and the per-batch spending limit stay truthful only if one batch spends at a time.
- The code already assumes one job per process (`job.ts`), so this is the smallest change. One user rarely needs two analyses at once.
- A second start is refused with "Rogue Legend is using the AI now (image 5 of 17). You can start this when it finishes." A queue is later work.

Why global for store jobs: the pacing protects against Google blocking this machine, so it must be shared.

Why not in the same project: a download rewrites the image database and deck manifests that an analysis plan is built from; a plan computed mid-download would not match what runs.

Mechanism:
- Lock files `workspace/.locks/ai.lock`, `store.lock` and `server.lock`, created with exclusive create (`wx`), holding `{ nonce, pid, processStartedAt, projectId, kind, startedAt, heartbeatAt }` (Zod-checked). The nonce is random per acquisition. The CLI and the server use the same locks, so `npm run pilot` in a terminal and the page cannot run at once.
- Ownership: the holder keeps its nonce in memory. Heartbeat and release first re-read the file and act only if the nonce is still theirs; a process never deletes a lock it does not own.
- Stale lock = the pid is not alive (`process.kill(pid, 0)` fails), or the pid is alive but its process start time differs (pid reuse), or the heartbeat is older than 2 minutes. Takeover: rename the stale file to a unique `.stale-<nonce>` name (only one contender's rename can succeed), delete that copy, then retry the exclusive create; a contender that loses either step simply sees the lock as taken. The job the stale lock belonged to is marked "stopped" in its project's journal.
- Same-project rule: acquiring either lane checks the other lane's lock for the same `projectId`.
- In-process: the server keeps a map of running jobs; locks are released in `finally`.
- Settings edits during a running job are allowed (they only write `project.json`); the running job keeps its own approved plan, and the "new items" notice appears afterwards.
- The registry is written only by the server (or by the migration under the server lock).

## 8. Migration of Rogue Legend

Goal: no re-download, no re-analysis, same approval numbers, nothing moved.

1. **Never automatic.** On start, the server only detects legacy data: a workspace folder with data and no `project.json`, plus a `configs/<name>.json` with the same `project`. The home screen then shows "Found an existing project: Rogue Legend (1,418 images, 18 analyses). [Import it]" with the dry-run summary (what will be added; that nothing is moved, downloaded or analysed). The import runs only when the user presses Import. `npm run migrate` does the same from the terminal (dry run by default, `-- --yes` to apply).
2. Writes `workspace/rogue-legend/project.json` from `configs/rogue-legend.json`: game, 14 competitors in order with tiers, 9 markets, charts, category `auto` kept, `ownAssets`, and `overrides` for any value that differs from `defaults.json` (expected: none). Written with write-once (never overwrites).
3. Adds the registry entry. Fetches icons (optional; if offline, a letter placeholder until the next open).
4. `decks/`, `runs/`, `orders/`, `reports/`, `own/`, `pending/` and `run-config.json` stay byte-identical and in place. `images/`, `analysis/` and the per-image `objects/` move into the shared library by hardlink with hash checks, as described in section 12A (A8), which replaces the earlier "nothing moved" wording for those three folders.
5. **Equivalence gate before writing**: build the merged config with the new loader and compare with `loadConfig("configs/rogue-legend.json")`: deep-equal apart from the new defaulted fields (`charts.enabled: true`). Then build the pilot and core analysis plans with both loaders: **the plan fingerprints must be identical** (they cover models, versions, review, estimates, budget, items and counts; the analysis records are keyed by image hash and schema version, not by config hash). If either check fails, the migration stops and changes nothing.
6. Known and harmless: the old `pending/download-plan.json` fingerprint includes the config hash, so it no longer matches. It is only needed for a new download, which the incremental preview rebuilds. State derivation does not use it.
7. Expected state after migration: "Pilot: ready, 17 images to analyse" (1 of 18 already analysed by the smoke test), 1,418 images, pick of 8 competitors kept.
8. `configs/rogue-legend.json` stays in the repo unchanged as the migration source. After migration `project.json` is the source of truth; the CLI prints a one-line note if `--config` points at a migrated project.

## 9. Tests (node:test via tsx, no network)

- **Input parsing**: desktop and mobile Play URLs with `hl`/`gl`, `market://`, bare IDs, developer/search URLs rejected, names.
- **PlayClient** with an injected fake scraper: details/search mapping, 404 → unavailable, retry then plain error, cache hits and expiry, errors not cached, queue serialisation (two concurrent calls are spaced), interactive ahead of background, icon host allow-list.
- **Settings and loader**: schema rules, merge with overrides, explicit repo root (taxonomy and prompts resolve), `charts.enabled: false` skips charts.
- **Migration** on a copy of the Rogue Legend config with a temp workspace: equivalence gate, identical analysis plan fingerprints, idempotent second run, dry run writes nothing, no existing file changes (size + hash snapshot before/after), refusal when the gate fails.
- **Registry**: create, slug collisions, rebuild from folders, corrupt file kept aside and rebuilt.
- **State derivation**: one fixture per stage and substate, interrupted detection with a dead pid and an old heartbeat, "new items" notice.
- **Locks**: exclusive acquire, stale takeover, same-project rule, CLI vs server contention, release on failure.
- **Incremental download**: adding a competitor or a country produces only new targets; merged run manifest keeps all decks; removal deletes nothing and drops the competitor from the pick.
- **Server**: `/p/:id` routing, unknown project 404, invalid ID rejected before any file access, token and origin on every new POST/PUT, `API_BASE` injected, analysis status isolation between two projects.
- **Resume**: store check continues from its checkpoint (only unfinished targets read); download resume reads only the approved copy even after a new store check and a settings edit; analysis Continue passes `limit − spent` and the ledger survives a restart.
- **Fit guard**: plan and run endpoints and the CLI refuse without a completed download or with a pick that fails the fit rule.
- **Draft projects**: home, wizard, settings and state work with zero competitors; store check, download and analysis refuse.
- **Import**: nothing is written on server start; the import happens only on the explicit request.
- **Icon fetch**: redirect refused, oversize stream cut off, non-image refused, pixel limit.
- **File size**: a test fails if any file under `src/` or `test/` is over 300 lines.
- **Manual smoke** (not in `npm test`): `npm run play-smoke` does one real lookup and one real search.

Existing tests keep passing unchanged (they use `loadConfig` with a temp config).

## 10. File-size and strictness rules

- Every file ≤ 300 lines; the module list in 6.1 and 6.4 has budgets. `gallery-html.ts` (123) and `gallery-server.ts` (183) are split before they grow. Enforced by a test (`test/file-size.test.ts`), not only by review.
- TypeScript strict, no `any`. Types come from `z.infer`. The scraper's enum typing uses the existing typed-cast pattern (`listFn`), documented on the one line where it is needed.
- Biome clean; no config weakening. `npm run typecheck`, `npm run lint`, `npm test` pass at every milestone.
- No new runtime dependencies (zod, sharp, google-play-scraper already present).

## 11. Risks

| Risk | Mitigation |
|---|---|
| Play search breaks when Google changes its pages | Links and IDs always work; plain message points to them; library version pinned; manual smoke test |
| Google throttles or blocks this machine | One shared, serialised queue at 800 ms; caches; retry with backoff; interactive lookups are few |
| Migration changes a hash and invalidates approvals or triggers re-analysis | Equivalence gate with identical plan fingerprints before writing; nothing moved; dry run |
| Two sources of settings for Rogue Legend | `project.json` is the source after migration; CLI note on `--config`; the legacy file is only read by the migration and tests |
| Wrong project root after moving settings into the workspace | Loader sets the repo root explicitly; tested |
| Stale lock after a crash blocks work | pid + heartbeat takeover; the job shows as stopped with Resume |
| Status of one project shown on another | Job state carries the project ID (5.4); tested |
| Views lose old decks after an incremental download | Run manifest holds the full merged deck set; tested |
| New projects have no local screenshots or PSD | Own assets optional; Rogue Legend keeps its folder. An in-page upload for own files is later work |
| Disk use (Rogue Legend is 2.6 GB) | Preview shows disk space; home shows size per project; the host check already checks free space |
| Wrong own game picked | Own game only by link or ID, with a confirmation card; cannot be changed later (new project instead) |
| Chart category missing (app not in a game category) | Charts switched off with a message |
| A crash during a model call charges that call twice | At most one image per stop (one call in flight); stated on the Continue panel |
| A gallery tab left open from before the upgrade writes to the wrong place | Old unprefixed POST paths answer 410 "reload the page" |
| Expansions are only chosen, not run, in this stage | The state model and journal already hold increments; the expansion step itself is the next stage |

## 12. Milestones and user checkpoints

Each milestone: implement (Opus dev agent), tests + typecheck + Biome, cross-family code review (gpt-5.6-sol or gpt-5.6-terra), then the user checkpoint. No AI analysis calls in any of them.

| # | Scope | User checkpoint |
|---|---|---|
| 1 | Settings split (`defaults.json`, `project.json`, `loadProject` with explicit root), registry, storage module with the local file-system implementation and the `node:fs` allow-list test (12B), shared library (section 12A) on it with the `ImageDb` facade and refs, providers take `ModelImage` inputs (12B), Import with both equivalence gates (settings and library), CLI `--project`. Built in two halves with one checkpoint: 1a settings, registry and storage; 1b library and Import. Tests include content-hash checks, an import interrupted at each step and re-run, and old-format loading | Dry run shown; user approves the migration. Then: `npm run gallery` shows Rogue Legend exactly as before, and the pilot approval still says 17 images with the same cost |
| 2 | One server for all projects: router split, route inventory with redirects for old paths, `/p/:id` routes, `API_BASE`, projects home (with the Import offer), project shell and step bar, derived state and landing screens, the jobs module (12B) with the in-process runner, Stop and Resume for analysis, the cross-project record lock and attempt log (12A, A3 and A4; moved here from milestone 1 because the first paid call happens here), the single job journal, locks with nonces, single-instance check, job-state isolation, fit guard on the analysis endpoints, analysis Continue, the saved expansion question after the core | User opens the home, sees Rogue Legend's status and next step, opens it and lands on the workspace. Optional: stop and continue the pilot, and check that the Continue panel shows what was already spent |
| 3 | Play lookup and search (queue, cache, errors), country catalogue, new project wizard with autosave, settings page | User creates a second project through the wizard (no download yet), closes the browser mid-way and resumes it |
| 3b | Share and import a project (section 12C): Share dialog with exact sizes, package export and import jobs, integrity and security checks, merge, incremental updates | User shares Rogue Legend as Light, imports it into a second workspace as a copy, sees the same screens and 0 images to analyse again, then imports an update |
| 4 | Download inside the page, as jobs-module kinds (12B), including "Fetch full-size images" for shared Light and Core-only projects (12C, C6): store check job with checkpoints and progress, approval screen, immutable approved copy, download with progress, resume, automatic deck views, landing on the pick | User approves a real download for the new project, interrupts it once, resumes it |
| 5 | Editing and incremental downloads: "new items" notice, incremental preview and merged manifests, removals | User adds a competitor or country to a project; the approval screen shows only the new items and "0 downloaded again" |
| 6 (future) | Store history and change log per game (section 12D): Refresh store data, shared snapshots, archive by state, change detection, history view, grid and report highlights | User refreshes Rogue Legend's store data, sees the changes before approving, then the history and the highlights; a second project sharing a game keeps its own view until it chooses "Use it" |

## 12A. Shared image and analysis library (added requirement, 2026-09-27)

User requirement, added after approval: **the image and analysis database is shared across projects.** An image is downloaded once and analysed once, whichever projects use it. This section is authoritative where it differs from sections 2, 5 to 9 and 12.

### A1. What is shared and what stays in the project

| Shared library `workspace/_library/` (content-addressed) | Project folder `workspace/<id>/` (references and project data) |
|---|---|
| `images/orig/<sha256>.<ext>`: original files | `project.json`, `run-config.json` (settings, pick) |
| `images/thumb/<sha256>.webp`, `images/model/<sha256>-<size>.<ext>`: derived copies | `refs.json`: which images this project uses and where each appears (app, country, language, position, Google image IDs) |
| `images/facts/<sha256>.json`: pixel facts (hash, perceptual hash, size, device guess, colours from `image-facts.ts`) | `decks/`, `orders/`: store order per game per date (point to image hashes) |
| `google/<google image id>.json`: Google image ID → sha256 | `reports/`, `runs/`: project reports and run manifests |
| `analysis/<sha256>/<analysis key>.json`: analysis records | `state/job.json`: jobs and the budget ledger; `state/approved/`, `state/store-check.json` |
| `objects/<step>/<input hash>.json`: per-image model answers (analysis, review, settling) | `objects/<synthesis steps>/`: pattern and recommendation answers (their inputs are project-specific) |
| `locks/`: per-record locks | `own/`, `views/`, `icons/`, `cache/` |

- The project's current `images/db.json` becomes `refs.json` (sources and Google IDs per image) plus the shared fact files. The existing `ImageDb` class keeps its public methods (`get`, `byGoogleId`, `ingest`, `all`, `abs`, `addSource`, `save`) as a facade over library + refs, so downstream code does not change. `all()` returns only images this project references.
- The server serves `/p/<id>/images/orig|thumb|model/<sha>...` from the library **only if that project's refs include the hash**, so gallery image paths (`../images/...`) keep working and one project's page cannot list another's images.
- Every library file is immutable once written, except analysis records (A3).

### A2. Analysis key

`analysis key = hash(pipeline spec)`, where the pipeline spec is a canonical object: schema version; the prompt version of every per-image step (full analysis, review, settling); producer, reviewer (or "none") and settling models; the model-copy preprocessing version (size, format); and the version of the settling rules. Defined in one module (`analysis/pipeline.ts`) so no caller builds its own key.

- The same image under the same key is reused by every project. A project whose settings use other models or prompts gets a different key, so it never silently receives an analysis it did not approve; the approval screen shows "analysed before with other settings" as information, not as free.
- The taxonomy is **not** in the key. Label changes stay deterministic mappings applied by `refresh-records` without re-analysis, as decided earlier. A record stores the taxonomy version it was read with.
- The per-image model answer cache (`objects/`) was already keyed by its full input (image hash, prompt, model), so moving it into the library is safe and adds a second reuse layer.

### A3. Records, identity and cost attribution

- A record holds the analysis (both layers, status, readings, settling), its versions, and:
  - `paidBy`: the first project and run that paid for a usable result `{ projectId, runId, batchId, usd, at }`. Set once, never changed.
  - `attempts`: every paid attempt, including failed ones, `{ attemptId, projectId, runId, batchId, state: "started"|"finished"|"failed", usd, at }`. The attempt is written as `started` under the record lock **before** the call, and updated after it.
- **The project's spend ledger is derived from these attempts** (sum by `batchId`), not kept as a second copy, so a crash cannot leave the record and the ledger disagreeing. An attempt still `started` after a crash is shown as "interrupted, cost unknown (at most about $0.25)" and counted at its estimate against the batch limit.
- The identity block (earlier user requirement: the record identifies its image) stays in the record, now with library paths and **appearances across all projects** (project, game, country, position). All projects belong to the same local user, so the (i) popover may show "also used in Other Game". It is rebuilt by `refresh-records` under the record lock, with no AI call. It gets its own `identityUpdatedAt`; `updatedAt` (used by report freshness) changes only when the analysis itself changes, because reports do not render appearances.
- Reuse is free: the reusing project's reports show "analysed by another project" per image and "reused: N images, $0" in the cost line. Money is only ever counted against the project that paid.

### A4. Cross-project record lock

- Before a paid call for an image, the runner takes `_library/locks/analysis-<sha>-<key>.lock` with the lock procedure of section 7 (nonce, heartbeat, safe takeover), then **re-checks the record**: if another project finished it meanwhile, the image is skipped as "already analysed, free" and nothing is paid.
- If the lock is held by a live job, the image is deferred to the end of the batch and checked again; if it is still held then, it is reported as "being analysed by <project>, will be reused" and not paid for.
- Record writes (new result, review, settling, identity refresh) happen under the same lock, via temp file and rename.
- The global one-AI-job rule (D2) already keeps two projects from analysing at the same time. The record lock also covers the terminal commands and any later relaxation of that rule.
- Image files and facts need no lock: they are content-addressed and write-once (temp file, hash check, rename; if the target exists with the same hash, keep it).
- Google-ID files are written only by downloads, which already run one at a time across all projects (the store lane lock). A Google-ID file holds a list `[{ sha256, firstSeen }]`: if the same ID later returns different bytes (the store replaced the picture), the new hash is appended, never overwritten, and decks point to what was actually fetched.
- Approval and the record lock together: an image's tier in the approval fingerprint comes from the record state (key, status, schema) at planning time. A change can only make the batch cheaper (another project finished an image, which is then skipped as free), never more expensive; a record becoming unusable or a key change alters the fingerprint and asks for a new approval (existing rule).

### A5. Downloads

- The guarantee, stated precisely: **an image is stored once and analysed once; a Google image ID is downloaded once.** The hash of an image under a Google ID never seen before is unknown until it is fetched, so a byte-identical picture published under a new ID is fetched once, found identical, and not stored again.
- Store check and approval count an image as needed only if its Google image ID is not in `_library/google/`. The approval screen adds one line: "Already in the shared library: 312 images (not downloaded again)", and disk space counts only new files.
- A downloaded image whose bytes match an existing library file only gains a Google-ID file; nothing is stored twice.
- Refs for the project are written for every image its decks use, whether downloaded now or reused.

### A6. Approval screens

- The cost-tier table gets one row before the paid rows: **"Already analysed, free"**, split as "by this project" and "by another project (Other Game)". The cap counts these images (they are part of the core set); the cost does not.
- The plan fingerprint includes each image's tier, so if another project analyses an image after the screen was shown, the numbers change and the run asks for a new look (existing behaviour).
- Continue after a stop, and the batch ledger, count only what this project paid.

### A7. Archive and deletion

- Archive never deletes anything. An archived project's refs still count as live.
- Deleting a project (a later stage, see D5) deletes only its project folder. Library files are then removed only by a separate **"Free up space"** action: it computes, from all live projects' refs, the images no project uses, shows the count and size, and deletes image files and derived copies only after the user confirms. It runs only when no job is running (it takes both lane locks and a `library.lock`).
- Analysis records and model answers are never deleted automatically: they are small and cost money to recreate.
- Reference counts are always computed by scanning refs, never stored, so they cannot drift.
- An image is reachable (kept) if any of these points at it: a live project's refs, a live project's approved download copy or store-check work list, or a running or stopped job's checkpoint. Analysis records and model answers are always kept.
- Live projects = every registry entry not deleted (archived included), plus any project folder with a `project.json` not in the registry (counted as live until the registry is rebuilt). Free up space and project deletion hold `library.lock` plus both lane locks, and rescan all refs **while holding them**, immediately before deleting. Every refs write takes `library.lock` for the few milliseconds of the write, so no refs change can happen between that scan and the deletion.

### A8. Migrating Rogue Legend into the library

Part of the Import (section 8), same single user approval, same "nothing re-downloaded or re-analysed" rule. Journal-driven and safe to re-run. **The whole import holds `library.lock` and both lane locks** from start through gate and switch, so no download, analysis or other refs write can touch the library meanwhile, and a rollback can only remove entries nobody else could have started using.

1. **Images**: for each image in `images/db.json`, hardlink `orig`, `thumb` and `model` files into the library (same disk, instant, no extra space). If hardlinking fails (another disk or file system), copy instead. Then **hash every library original and check it equals its name** (1,418 files, 2.6 GB; about a minute). Facts from `db.json` and `images/facts/` are written as library fact files; Google IDs as Google-ID files.
2. **Refs**: `refs.json` is written from `db.json` sources and Google IDs.
3. **Records**: each `analysis/<sha>.json` is copied to `_library/analysis/<sha>/<key>.json`. The key is computed only from **provable provenance**: the record's producer and reviewer models and object keys, its schema, and the prompt and settling versions in its run's manifest (`runs/<runId>/manifest.json`), cross-checked against the cached model answers in `objects/`. `paidBy` = Rogue Legend and that run; `usd` unknown for migrated records (stated as such). Content, `status` and `updatedAt` unchanged; the identity block is refreshed to library paths.
   - A record whose provenance cannot be proven completely (for example, no run manifest, or a failed record without a schema version) is stored as **"earlier analysis, settings not proven"**: Rogue Legend keeps using it exactly as today (so nothing is re-analysed), but other projects do not reuse it for free; their approval screens show it as "analysed before with settings that cannot be confirmed" and count it as paid work. The dry run lists how many of the 18 records fall in each group.
4. **Model answers**: per-image `objects/` steps are hardlinked into `_library/objects/`.
5. **Gate** (before the project switches to the library): the new facade yields the same image list, deck view model and pilot/core analysis plan fingerprints as before; the latest pilot report's data hash is unchanged (it stays current); every record parses and counts as usable exactly as before. On any failure, the migration removes only the library entries it created (listed in its journal) and leaves the project as it was.
6. **Switch**: the project's old `images/`, `analysis/` and per-image `objects/` folders are renamed into `workspace/<id>/_before-library/`. With hardlinks this costs no extra space. They are deleted by the tool after the user's milestone checkpoint, with a confirmation, never by the user.
7. Expected result: same screens, same "17 images to analyse", 0 downloads, 0 AI calls, about 0 extra disk space.

### A9. Tests added

- Two temp projects sharing a competitor: the second download fetches 0 shared images; its refs point at the same library files.
- The second project's pilot plan shows the shared images as "already analysed, free, by another project" and costs $0 for them; a different model setting shows them as not reusable.
- Record lock: two runners racing on one image pay once (fake provider counts calls); a runner that finds the record written after planning skips it; stale record lock takeover.
- `paidBy` set once; reuse recorded at $0 in the second ledger; identity lists appearances from both projects and refresh keeps `updatedAt`.
- Server refuses a library image the project does not reference.
- Free up space: an image referenced by an archived project is kept; an unreferenced one is listed and deleted only after confirmation; records are never deleted.
- Migration: hardlink and copy paths, hash check catches a corrupted file, gate failure rolls back only created entries, re-run is a no-op, `_before-library` created.

### A10. Changes to other sections

- Summary, layout (2.1), migration (8), download (5.3 and 6.3), approval (5.3), locks (7), tests (9) and milestones (12) follow this section.
- Milestone 1 becomes: settings split, registry, **storage module (12B) and the shared library on it, with the `ImageDb` facade and refs**, and the Import (settings plus library migration), with one user checkpoint. The record lock and attempt log come in milestone 2, with the first paid call. Milestones 2 to 5 are unchanged, except that 4 and 5 count library images as already downloaded.
- The batch spend ledger in `state/job.json` (5.3) is replaced by the sum of the library records' attempts for that batch (A3); the journal keeps only the batch's limit and runs.
- Risks added: a library-wide mistake affects every project (mitigated by write-once files, hash checks, records never auto-deleted, locks); hardlinks on another disk fall back to copies (more disk; shown before the Import).

## 12B. Web-readiness design rule (added, approved by the user 2026-09-27)

We are **not** building web features. We keep three internal boundaries clean, so a future hosted website is cheap. Each is introduced in the milestone that first touches it; none adds user-visible work.

### B1. AI providers behind one interface (exists; keep)

- `src/analysis/providers.ts` already hides the Claude and Codex command-line tools behind one provider interface with a model family. Keep it the only way to call a model.
- Rule for the future API-key providers (Anthropic API, OpenAI API): drop-in replacements, chosen by the model reference in settings (`anthropic:`/`openai:` prefixes next to `claude:`/`codex:`), no caller changes. So the interface must not assume a local file, and must not know about storage: the analysis code resolves each library image into a provider-neutral `ModelImage { bytes, mimeType, localPath? }` before the call. A CLI provider uses `localPath` (or writes a temporary file); an API provider sends the bytes. Usage and cost come back in the same shape from both.
- Milestone: 1 (only the image-reference change, made while the library is built). The API providers themselves are not built.

### B2. Storage behind one interface

- A `src/storage/` module with a deliberately small interface: `getJson`, `putJson` (atomic), `putBlob` (write-once, content-addressed, hash-checked), `readStream` (for serving images), `exists`, `list(prefix)` (unordered; returns an async iterator, so a paged backend fits later). Keys are logical paths (`library/images/orig/<sha>.jpg`, `projects/<id>/decks/...`), never OS paths.
- Kept out of the general interface, as separate small capabilities: **locks** in `src/storage/leases.ts` (the section 7 procedure; a database backend would use its own leases); **`link`** only in the import code (falls back to copy); **blob deletion** only inside the Free up space procedure (A7), never callable by feature code.
- **Scope now, not later:** every project-scoped storage and job call takes a `ProjectContext { projectId }` (local mode: one user, no further scope). Library blobs and records are global and content-addressed; project metadata is always reached through its context, so a future owner/tenant check has one place to go.
- First implementation: the local file system (`storage/local-fs.ts`), wrapping today's `fsx.ts` helpers. A database plus object storage could replace it later.
- **Feature code does not call `node:fs` directly.** The shared library, refs, analysis records, decks, job journal, registry, locks and project settings go through storage from the milestone they are built or touched in. Older modules not touched in this stage keep their direct calls on a written allow-list; a test fails on any `node:fs` import outside `src/storage/` and that list, and the list may only shrink.
- Milestone: 1 (library, refs, records, settings, registry), then 2 (journal, locks, server static files through `readStream`).

### B3. Jobs behind one interface

- A `src/jobs/` module: `enqueue(ctx, kind, input, key)` → job ID, `status(jobId | ctx)`, `resume(jobId)`, `cancel(jobId)`, `list()`. Kinds: store check, download, analysis batch.
- The job record is the versioned, Zod-checked `Job` of section 5.3, made explicit: a reference to its **frozen input** (the immutable approved plan copy, or the store-check work list), state, progress and checkpoint, timestamps, structured errors, and result (report or run manifest path). `enqueue` is idempotent by `key` (the approved plan's fingerprint): the same approval never starts two jobs. Transitions: queued → running → finished | failed | stopped; stopped → running only by `resume`, which re-reads the frozen input and is a no-op if the job is already running or finished; `cancel` moves running → stopped.
- First implementation: the in-process runner with the two lanes, locks and journal of sections 5.3 and 7. A queue plus workers could replace it later. Routes and CLI commands only call this module; no route starts work directly (today `postAnalysisRun` calls `runApproved` itself).
- `cancel` stops after the current image (download or analysis); everything finished is kept, and the job shows as stopped with Resume. The page gets a "Stop" button next to the progress line.
- Milestone: 2 (analysis batches and the journal), 4 (store check and download).

### B4. What a website would add (not built; noted for later)

- **Play scraping from server IPs**: data-centre addresses are throttled or blocked much faster than a home connection, and Google Play's terms of service prohibit automated scraping. A hosted version needs a licensed data source or an approach that stays within the terms.
- **Hosting competitor images**: the screenshots are other companies' copyrighted material. Showing them publicly is a copyright risk; a hosted version should keep them private to signed-in users, prefer thumbnails, and have a takedown process.
- **Cross-user library**: the shared library could become shared across users, so a competitor image analysed for one customer is free for the next. It would then need a rule on what one user may learn about another (for example, not "also used in Other Company's project"), and a cost-sharing policy.
- Also: user accounts, API-key storage, and spending limits per user.

## 12C. Milestone 3b: share and import a project (added, approved by the user 2026-09-28)

Goal: the user shares a project with a friend without a website. The friend gets the project, its images and all results on their own computer, and keeps working. Written against the code merged to master after milestones 1 and 2: `src/storage/` (synchronous `Storage` with logical keys, `putBlob` with hash check, `readStream`, `localPath`; `leases.ts` with the ai, store, library and server locks; `import-ops.ts` as the only place that links or moves files), `src/jobs/` (enqueue/status/resume/cancel, the in-process runner, `state/job.json`), `src/library/` (layout, refs, facts, Google-ID files, records per analysis key), and the projects home (`routes-home.ts`, `home-script.ts`, with the legacy-project Import).

**Not recommended:** a live shared sync folder (Dropbox, OneDrive, a network drive) for the workspace. Locks, hardlinks and atomic renames do not survive sync, and two computers would write the same records. Sharing is always a package file.

### C1. User flow

**Sender: "Share project"** (button in the project header, next to Settings)

```
Share "Rogue Legend"
 ( ) Everything             1,418 images at full size, all results          2.63 GB
 (o) Core only              ours + 8 picked competitors at full size,        412 MB
                            thumbnails for the other 1,040 images, all results
 ( ) Light                  thumbnails for all images, analysis-sized copies  41 MB
                            of the 85 analysed images, all results
 ( ) Report only            the report as a web page with the pictures it     18 MB
                            shows; opens in any browser, no tool needed
 [x] Only what changed since my last share (28 Sep, Light)                   6 MB
                                                          [Build the file]
```
- The sizes and counts are **computed exactly from the files before anything is built** (sum of the chosen files; pictures are stored without re-compression, so the file is within about 1% of the shown size; JSON is compressed, so it can only be smaller). The current measurements (originals 2.6 GB, thumbnails 26 MB, analysis-sized copies 4.7 MB, project data 9.4 MB) are what the options add up from.
- "Build the file" runs as a job with a progress line ("Adding image 812 of 1,418"), in the "Working now" strip too. The finished file appears with **Save the file** (a normal browser download) and a plain hint: "Send this file to your friend, for example with a file-transfer service. It contains competitors' store screenshots: share it only with people working on your game."
- Sharing is the one case where the user handles a file, because a file is the thing being shared. Nothing else changes.
- "Only what changed since my last share" appears when the tool has a record of an earlier share of this project (C4).

**Friend: "Open a shared project"** (button on the projects home, next to New project)
1. Gets repo access, runs `npm install` and `npm start` (README gets a "Receiving a shared project" section).
2. Presses Open a shared project and picks the file. Upload progress is shown ("Reading the file: 1.2 of 2.6 GB").
3. The tool checks the file without importing anything and shows a summary: project name and game, who shared it and when, what it contains (images at full size, thumbnails only, analyses, reports), the size on disk after import, what is new compared with what the friend already has, and any problems.
4. The friend picks, when a project with the same origin already exists: **Update my copy** or **Import as a separate copy**. Otherwise just **Import**.
5. Import runs as a job with progress ("Checking image 812 of 1,418"), then opens the project on its current step.

**Report only:** the file is a zip of a folder with `index.html` and an `images/` folder. The recipient unzips it and opens `index.html`; no tool needed. It is an **export-only view**: generated by the tool's own deterministic template from the report data (the escaping markdown renderer, fixed CSS, **no script**, a restrictive `Content-Security-Policy` meta tag, image paths only to its own `images/` folder). It carries no data the tool can import, and "Open a shared project" refuses it with "This is a report to read in a browser, not a project to import."

### C2. Package format

One zip file named `<project id>-<date>-<kind>.recipe.zip`. Entries use the storage's logical keys, below a fixed top-level folder per kind of content:

```
manifest.json                         always the first entry
project/project.json, run-config.json, decks/**, orders/**, reports/**, runs/**, own/*.json, icons/**, state/history.json
library/images/orig/<sha>.<ext>       per option
library/images/thumb/<sha>.webp
library/images/model/<sha>-<edge>.jpg
library/images/facts/<sha>.json, library/images/pixels/<sha>.<v>.json
library/google/<hash>.json            only the Google-ID entries of included images
library/analysis/<sha>/<key>.json     analysis records of this project's images
library/objects/<step>/<key>.json     the per-image model answers those records cite
```

Not included: the job journal's live state (no running or stopped job travels), caches, views (rebuilt), `_before-library`, the local own-assets folder and PSD (only the facts read from them in `own/`), anything from other projects.

**Manifest** (`PackageManifestSchema`, Zod, strict):
- `format: "store-screenshot-recipe/project"`, `formatVersion: 1`, `tool: { version, commit }` (package.json version and git commit), `createdAt`, `packageId` (random), `kind: "full"|"core"|"light"|"report"`.
- `sender: { label }`: a display name the sender may type (default: empty). No email, no user name, no machine paths.
- `project: { originId, id, name, ourAppId, revision, baseRevision, stateHash }`. `originId` is a random ID given to a project once, at its first share (stored in `project.json`), so copies of the same project are recognised whatever their folder ID. `revision` is a counter the project increases on every share and every import; `stateHash` is the hash of the canonical, sorted file index; `baseRevision` is the revision an update package was built on.
- `dependencies`: the **closure** of what the project needs, computed from refs → images (facts, thumbnail, analysis-sized copy, original) → analysis records → the model answers and pixel facts each record cites. Each dependency is listed by content hash with its state: `included`, `earlier-package`, or `deferred-original` (only full-size originals may be deferred).
- `digest`: the SHA-256 of the canonical manifest (without this field). The inspect summary shows its first 12 characters, so sender and friend can compare it by message if they want to.
- `analysis: [{ key, pipeline }]`: every analysis key used by included records, with its full pipeline spec (schema, prompt versions, models, preprocessing), so the receiver can recompute and check each key.
- `files: [{ path, sha256, bytes, included }]`: **the complete index of the project's data at export time**, including files left out of this package (`included: false`). Left-out files are either full-size originals (Core only, Light) or files an earlier package already carried (C4).
- `images: [{ sha256, googleIds, parts: { orig, thumb, model } }]` with each part `"included"|"earlier-package"|"absent"`.
- `basedOn: { packageId, createdAt } | null` for an update package.

### C3. Integrity checks on import (before anything is written to the library or the project)

1. Zip structure is read with **yauzl** (reading) and written with **yazl** (writing): mature, streaming, ZIP64-capable libraries from the same author (MIT), with no native parts. yauzl reads entries one at a time from the file on disk (random access via the central directory), rejects invalid file names by default, and reports sizes before decompressing. Pictures are stored without compression (they are compressed already), JSON with deflate.
2. `manifest.json` must be the first entry, at most 50 MB, pass `PackageManifestSchema`, and hash to its own `digest`; `formatVersion` must be one this tool reads.
3. **Zip-level rules:** compression method stored or deflate only; encrypted entries refused; the central directory and each local header must agree on name and sizes; the CRC-32 is checked (yauzl's `validateEntrySizes` plus our own CRC check) in addition to the SHA-256; totals are computed from the validated entries, never taken from a declaration.
4. **The zip's entries and the manifest's `included: true` files must match exactly**: no extra entry, no missing entry, no duplicate name.
5. Each entry's bytes must hash to its manifest `sha256`. Originals additionally go through `putBlob(key, bytes, sha256)`, which checks the name hash.
6. Every JSON file passes its existing schema (settings, refs, decks, records, facts, Google-ID files, journal history). Analysis records must sit under the key that the manifest's pipeline spec for that key hashes to.
7. **Dependency closure:** every dependency in the manifest must be included, already present locally with the same content hash, or a `deferred-original` (fetchable later, C6). Anything else ("import the earlier package first: Light, 28 Sep") stops the import before writing.

**Inspect vs import.** "Inspect" (the summary before the friend chooses) runs **all** checks above by streaming the uploaded file once; it writes nothing to the library or any project (the upload itself is already on disk). Its result is saved as `shared/incoming/<upload id>.verified.json`, bound to the upload's SHA-256. The import accepts only an upload with a matching verification result, and still re-hashes each entry as it writes it (a changed file on disk fails).

### C4. Updates and incremental re-sharing

- After each share, the sender's project keeps `state/shares.json`: `{ packageId, createdAt, kind, files: [{ path, sha256 }] }` for its last few packages.
- "Only what changed since my last share" builds a package whose manifest still indexes **every** file, but includes only files that were not in the previous package of the same or a larger kind (by path and hash). `basedOn` names that package.
- The receiver needs no special mode: every import is a merge that skips files it already has with the same hash (C5). An update package just leaves those out, and check 6 in C3 confirms they are really there.
- Analysis records the friend already has are never replaced by a paid re-run: images analysed by either side are "already analysed, free" on the other side after an import (same analysis key). Nothing is ever re-paid because of sharing.

### C5. Merge semantics

**Which project receives the data**
- No local project with the same `originId`: import as a new project. The folder ID is the sender's ID, or `<id>-2` when that ID is taken by an unrelated project.
- Same `originId` exists: the friend chooses **Update my copy** (merge below) or **Import as a separate copy** (new ID, new `originId`, merged into nothing).

**Library content** (shared by all the friend's projects)
- Images, thumbnails, model copies, facts, pixel facts: content-addressed; an existing file with the same hash is kept; a different hash under the same name is impossible for originals (name = hash) and refused for other files.
- Google-ID files: append-only merge of entries (the 12A rule).
- Analysis records at the same image and key, under the record lock:
  - only one side has it: take it;
  - one side usable, the other failed or outdated: keep the usable one;
  - both usable: **keep the local one**, and keep the incoming one as an immutable **variant** at `analysis/<sha>/<key>.variants/<record content hash>.json`. The record at `<key>.json` stays the selected one used for statistics; variants go through the same privacy rewrite, are exported with their record, count as reachable (never deleted), and can be chosen instead in the (i) details ("Use the sender's analysis"). Listed in the import summary as "2 images were analysed by both of you; your own analysis is kept";
  - attempts are unioned by `attemptId`; `paidBy` keeps the earliest. Attempts from the package are tagged with the sender's label, so the friend's ledger and reports show "paid by <sender>" and never count them against the friend's batches.
- Per-image model answers: content-keyed; union.

**Project data (Update my copy)**
- Settings: competitors and countries the sender added are added (additions never lose data); removals, tier changes, order and chart changes from the sender are **not** applied automatically but listed as "The sender also changed: ..." with one button each to adopt. Advanced `overrides` from a package are never applied silently (a package cannot change the friend's models or spending limits); differences are listed.
- Core pick (`run-config.json`): the local pick is kept; the sender's pick is saved as "Sender's pick" and offered with Use this pick.
- Decks: per store page, the newer `fetchedAt` wins; the older stays in its run manifest.
- Orders (dated), runs and reports: unioned by file name; the same name with different content keeps the local file and lists the conflict.
- Feedback and corrections (plan v2: append-only typed corrections with IDs): unioned by ID; two corrections of the same item that disagree are held as "unresolved" and shown to the user, the rule plan v2 already has.
- Job history: the sender's finished batches go into `state/history.json` (read-only, for "what was spent where"); live jobs never travel.
- Refs: union of image references for this project.
- **Divergence:** if the local project's revision is not the package's `baseRevision` (both sides changed since the last exchange), the summary says "You both changed this project since your last exchange" and lists the conflicts from the rules above before the friend presses Update. An update package whose base the friend never imported fails the closure check (C3, step 7).

### C6. Light and Core-only imports: full-size images later

- Images whose original was left out are imported with facts, thumbnail and (if analysed) the analysis-sized copy. The library marks them "full size not downloaded" simply by the absent original; `ImageDb.get` keeps working for views.
- Everything that only views works immediately: gallery, comparison grid, (i) details, reports.
- Anything that needs the original (a new analysis of an image with no analysis-sized copy, layer-diff crops at native resolution, Free up space checks) sees it missing. The analysis approval screen then shows "34 images need their full-size picture first (free, from Google Play) [Fetch them]" and cannot start until they are fetched.
- "Fetch them" is a download job in the store lane (milestone 4 builds that kind): it downloads by Google image ID and compares the hash. Three outcomes per image, shown in plain words:
  - **recovered:** same hash; the original is filled in;
  - **changed on Google Play:** different bytes. The old image keeps its references, deck position and analysis (and stays viewable by its thumbnail and analysis-sized copy); the new picture is stored as a new library image but **not** linked into the project. The user sees "3 pictures changed on Google Play since this project was shared" and can refresh the store data (section 12D) to adopt the current pictures deliberately;
  - **no longer on Google Play:** recorded as unavailable; views keep working; only a new full analysis of that image is impossible (its analysis-sized copy still allows a re-analysis if one is needed).
- Until milestone 4 lands, the missing originals are shown but not fetchable; analysis of those images waits.

### C7. Security (the package comes from another person and is untrusted input)

- **Zip-slip:** entry names are never used as paths. Each name must be in the manifest and map to a storage key through `key()` (segment pattern, no `.` or `..`, no drive letters or backslashes) under the allowed prefixes of C2; anything else is refused. Writes go through `Storage` only. Symlink entries (by their external attributes) and directory entries are refused or ignored.
- **Size limits:** upload capped (default 20 GB, and never more than free disk minus 5 GB); manifest ≤ 50 MB; per entry ≤ 100 MB for originals and ≤ 20 MB for JSON; total uncompressed ≤ the manifest's declared total (and the file's own size for stored entries); deflated entries with a ratio above 100:1 refused (zip bomb); entry count ≤ 200,000. The declared sizes are checked before extraction and enforced while streaming.
- **Never executing content:** the tool never runs, requires or serves as a page anything from a package. The server's static rules already refuse HTML, SVG and JS files; imported reports are markdown rendered by the existing escaping renderer, whose image sources are limited to the project's own image paths; names and text are escaped in every page. Settings from a package pass `ProjectSettingsSchema`; overrides are not applied (C5).
- **Privacy on export:** records' identity blocks are rewritten for the package: no absolute paths (they are rebuilt on import by `refresh-records`), appearances limited to this project, other projects' names and IDs in attempts replaced by "another project". The sender label is optional.
- **Upload endpoint:** same token and same-origin rules; the only route allowed a large body, streamed to disk (`shared/incoming/<upload id>.zip`) with the cap enforced while streaming; deleted after import or after 7 days.
- **No signing:** the friend trusts the sender, as with any file they receive. The manifest's hashes protect against damage in transfer, not against a hostile sender; the checks above limit what a hostile file can do.

### C8. Through storage and jobs

- New storage capabilities, both local-disk only and outside the general interface (like `localPath`): `openWrite(key)` returning a write stream with `commit()` (rename into place) and `abort()`, used by the zip writer; and yauzl opens the package through `localPath(key)`. All other reads and writes use the existing `Storage` methods; `import-ops.ts` is not used (no hardlinks from a package).
- New job kinds in `src/jobs/`: `share-export` and `share-import`, both in the **store lane** (one file-heavy job at a time across all projects, never together with a download), with the same-project rule (no export or import while that project's analysis or download runs: "Wait until the analysis finishes"). Their frozen inputs: the export choice with the file list computed at the estimate, or the uploaded file's manifest.
- **Import as a transaction.** (1) Library content (content-addressed files, variants) is written first; these writes are idempotent, and unreferenced until step 3. (2) The **complete merged project tree** (new project, or the existing one plus the merge) is built in `projects/<id>.importing/` from a snapshot of the current project, and validated with the same schemas and the state derivation. (3) Under `library.lock` and the project's exclusivity, the selected-record and attempt merges are applied, then the staged tree is swapped in by rename (the old tree kept as `projects/<id>.before-import/` until the next start), the registry updated, and a commit marker written to the import journal. A stop before the marker leaves the project exactly as it was; resume rebuilds the staging from scratch. Conflict file names are deterministic (by content hash), so a re-run creates no duplicates.
- Export writes to `shared/exports/<export id>.partial` and renames on completion; a stopped export is rebuilt from the start (minutes, no cost). Old export files are removed after they are saved, or after 7 days.

### C9. Progress (PILLARS UI rule)

Every step shows live progress with counts in the project page and the "Working now" strip: "Counting files", "Adding image 812 of 1,418 (1.1 of 2.6 GB)", "Reading the file: 1.2 of 2.6 GB", "Checking image 812 of 1,418", "Adding analyses 40 of 85", "Merging project data". A failure shows the file or step it stopped at in plain words, and Continue.

### C10. Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/p/:id/api/share/estimate` | Exact counts and sizes of each option, and of "only what changed" |
| POST | `/p/:id/api/share/export` | `{ kind, onlyChanges }` → export job |
| GET | `/p/:id/api/share/exports/:exportId` | The finished file (streamed) |
| POST | `/api/share/upload` | Streamed upload of a package → `{ uploadId }` |
| POST | `/api/share/inspect` | `{ uploadId }` → the checked summary (C1 step 3); writes nothing |
| POST | `/api/share/import` | `{ uploadId, mode: "new"|"update"|"copy" }` → import job |

Job progress and Stop go through the existing jobs endpoints.

### C11. Tests

- Round trip per kind in temp workspaces (two storages = two computers): export, import as new, same screens, same approval numbers, and **0 images to analyse again** for everything analysed.
- Core only and Light: views work; missing originals reported; approval blocked with the fetch line; a fetch with a matching hash fills in; a changed picture becomes a new image.
- Incremental: second export contains only new files; importing it without the first package fails check 6 with the plain message; importing both in order equals one full import.
- Merge: same `originId` update vs copy; both-usable records keep local and store the incoming one beside it; attempts union and "paid by sender" in the ledger; settings additions applied and removals listed; pick kept with "Sender's pick"; corrections union and unresolved conflicts.
- Integrity: tampered byte, extra entry, missing entry, duplicate name, wrong record key, unknown format version, manifest not first, wrong manifest digest, encrypted entry, unsupported compression method, header/central-directory mismatch, missing dependency in the closure, upload changed between inspect and import.
- Transaction: stop at each import step; the project is unchanged before the commit marker and fully merged after it; re-run creates no duplicate conflict files.
- Divergence: both sides changed since the last exchange → summary lists the conflicts.
- Security: `../` and absolute and drive-letter names, backslashes, symlink entries, zip bomb ratio, oversize entry, upload over cap, HTML file in a report path (stored, never served as a page), overrides in the package not applied.
- Privacy: no absolute path, user name or other project's name in the exported bytes.
- Jobs: store-lane exclusivity with a download, same-project refusal during analysis, stop and resume of an import leaves no half-merged project.
- Report only: the HTML has no script and its image paths resolve inside the zip.

### C12. Risks

| Risk | Mitigation |
|---|---|
| Re-sharing competitor screenshots (copyright, Google Play terms) | Private sharing with people on the same game only; stated in the Share dialog; no public hosting; the package notes the source of every image |
| Different tool versions on the two computers | Manifest carries the tool version and commit; if the friend's analysis key differs, the summary says "Update the tool (git pull) to reuse all analyses; otherwise N analyses show as made with other settings"; the import still works |
| Very large files (2.6 GB) are hard to send | Light is the default choice; Core only as the middle ground; "only what changed" for updates |
| A hostile or damaged file | C3 and C7 checks; nothing executed; staging before switch |
| Both users analyse the same image before syncing | Both analyses kept (local one used); both payers recorded; unavoidable double spend is visible |
| Leaking the sender's private data | Identity rewrite, no paths, optional sender label, no other projects |
| Zip over 4 GB later (more countries) | yazl and yauzl support ZIP64 |
| Antivirus scanning slows import of big zips | Progress shows it is working; nothing to fix in the tool |

### C13. Milestone placement

Milestone **3b**, after milestone 3 (wizard) and before 4 (downloads in the page). It adds `yazl` and `yauzl` as dependencies (the only new ones in this plan; `@types` for both as dev dependencies). The "Fetch full-size images" action lands with milestone 4's download job. User checkpoint: the user shares Rogue Legend as Light, imports it on a second workspace (or a friend's computer) as a copy, sees the same screens and "0 images to analyse again", then re-shares after a change and imports the update.

## 12D. Milestone 6: store history and change log per game (future work, added 2026-09-28)

User requirement: when a game changes its store images or their order, the old images are kept, archived, with all their analysis, their position, their country and language, and the deck they belonged to (the other images in that deck, in order, with dates). The current state moves to the new images and order. Each game gets a change log (added, removed, moved, replaced; date seen; before and after; per country and language), shown in the page: a per-game history, and "what changed since the last refresh" highlighted in the grid and the report. **Store data is never refreshed automatically or in the background**, only by a user action with the usual preview, approval and progress.

### D1. Placement: its own milestone 6, after milestone 5

- Milestone 5 adds competitors and countries and, by design, **never re-reads a store page it already has**; nothing can change there, so no change log arises. A refresh is the opposite: it re-reads every page, and needs the archive model, change detection, the shared history, a history view and report sections. Folding it into 5 would double that milestone and mix a low-risk change with a data-model change behind one checkpoint.
- It reuses what 4 and 5 build (the store-check and download jobs, the incremental preview, the deck integrity check) and what 3b introduces (a picture changed on Google Play, C6). So it comes last.

### D2. Archive model: references plus a state, no copies

Built on the content-addressed library (images and analyses are never deleted), the run manifests and the dated order files.

- **Shared per game and store page, in the library** (one history per game, whoever observed it):
  - `library/store/<appId>/<gl>-<hl>/snapshots/<snapshot id>.json`, write-once: `{ id (ULID), parentId, observedBy, fetchedAt, appId, gl, hl, status: "ok"|"unavailable", title, occurrences: [{ position, sha256, googleId, device }], visualHash }`. `visualHash` = hash of status plus the ordered image hashes. **A snapshot is written only when `visualHash` differs from the latest one**; otherwise the check is appended to `confirmations.json` (`{ snapshotId, checkedAt, by, metadata changes }`, append-only), where metadata changes (a new Google ID for the same picture, a device guess, the title) are recorded, so nothing observed is lost and "unchanged" costs one line.
  - `parentId` is the latest snapshot in the library at commit time (refreshes are serialised in the store lane, so locally there is one line). Snapshots arriving from a shared package (3b) can create a second line from the same parent; the timeline is ordered by `fetchedAt`, and parallel observations are shown side by side ("seen by you" / "seen by the sender"), never merged into one.
  - `changes/<parent id>--<child id>.json`: the change set of one edge (parent → child). Derived by the rules in D4 (versioned), so it can always be recomputed; stored for speed.
  - A snapshot **is** the deck and the historical source of truth: its occurrences list every image of that page in order with the date, which answers "which deck did this image belong to, and what else was in it", including an image that appears twice or comes back later.
- **Per project** (its own view):
  - each deck manifest in `decks/` gains `snapshotId`: the project's current state of that page = the snapshot of its own last refresh (or one it adopted, D6);
  - **current membership is derived** from the project's selected snapshots; **archived** = an image that occurs in an earlier snapshot of one of the project's pages but not in the selected one ("used until 27 Sep", from the snapshot dates). No image is copied or moved; archiving is only this derived state;
  - `refs.json` stays the reachability list (the images this project needs kept): it gains an `archived: true` flag for images only in earlier snapshots, and is never the source of history;
  - `state/refreshes.json`: each refresh `{ id, at, decks: { <deck key>: { before, after } } }`, which defines "since the last refresh" for this project;
  - the dated `orders/<app>/<gl-hl>/<date>.json` files stay as the project's analysed view of a snapshot (with screen types), written for the new snapshot as today.
- **Reachability** (12A, A7): archived references count as references, so archived images are kept by Free up space. A later option may drop archived *originals* only, keeping thumbnail, analysis-sized copy and analysis.
- **Backfill without network:** the first snapshot of each page is built from the latest setup run manifest (full deck lists) and the existing order files, so Rogue Legend's history starts at 27 Sep with no store read.

### D3. Refresh flow (user-triggered only)

1. The user presses **Refresh store data** (project header). Options: all games, or selected games; charts yes/no.
2. A store-check job re-reads those store pages (pacing as always; the metadata cache is bypassed except for pages read in the last hour, which protects against double reads). Progress: "Checking store page 120 of 271".
3. The approval screen shows, before anything is downloaded, what the store page data alone can tell (Google image IDs and order): "271 store pages checked: 12 changed in 5 games; 38 new pictures to download (about 41 MB); 0 images sent to AI", and a **provisional** list of changes ("Capybara Go, United States: new picture at position 1; positions 3 and 4 swapped"). It says plainly that the exact classification (for example "replaced by a nearly identical picture", or "same picture under a new Google ID") follows the download, since it needs the picture's bytes. The download costs nothing but time and disk, which is what this approval covers.
4. **Approve** runs the download job for the new pictures, computes the final change sets, and commits as a **transaction**: (a) new pictures go into the library (content-addressed, idempotent); (b) snapshots, change sets and order files are staged and validated; (c) under `library.lock`, the snapshots and change sets are published write-once, then the project's decks, refs and refresh record are switched by one staged rename, and a commit marker is written. **A project's `snapshotId` moves only after every file it points to is durable.** A stop before the marker leaves the project on its old store state; resume redoes the staging; unreferenced pictures from an abandoned refresh are ordinary Free up space candidates. The final change list is shown after the refresh.
5. **Never automatic:** no timer, no refresh on start or on opening a project, no background job. Wizard lookups and the Play cache never touch decks. A test asserts that no store page is read without a user-started job.
6. Charts: games entering or leaving a chart are logged as chart changes ("entered the top 10 in Japan"). New chart games become new targets offered in the approval list; games that left keep their decks, labelled "no longer in the top 10 since 28 Sep".

### D4. Change detection (deterministic)

Between the previous snapshot P and the new snapshot N of one page (same game, country and language):

| Event | Rule |
|---|---|
Matching works on **occurrences** (an image may appear twice in one deck), in this fixed order; each step only uses occurrences not matched by an earlier step:

1. **Exact:** occurrences with the same hash are matched between P and N. For a hash that occurs more than once, pairs are chosen to minimise the total position distance, ties broken by lower position. Same position = unchanged (no event); different position = **moved** ("moved from 3 to 5").
2. **Same Google image ID, different bytes:** **replaced**, sub-labelled "updated under the same Google image ID".
3. **Same position:** an unmatched occurrence at position k in P and one at k in N = **replaced**, sub-labelled by the existing `classifyPair`: "replaced by a nearly identical picture" (perceptual hash within 6 bits, e.g. re-encoded) or "replaced".
4. **Nearly identical elsewhere:** an unmatched P occurrence and an unmatched N occurrence at different positions within 6 bits = **replaced and moved**, closest first, ties by lower position.
5. Whatever remains: **added** (N) or **removed** (P).
6. Page status: **became unavailable / available again**. Same picture under a new Google ID is not a change (recorded in the confirmation's metadata and the Google-ID file).

- Inputs are canonicalised (sorted by position) and every tie has a rule, so the same two snapshots always give the same change set. The algorithm is versioned (`changeRules: 1`).
- Two views of "since the last refresh", both defined: **net change** (P → N, used by the grid highlights: what is different now) and **event timeline** (every edge between P and N in order, used by the history view and the report, so a picture that was removed and came back is visible).
- The existing `compareOrders` in `analysis/orders.ts` is generalised into `store/changes.ts` returning events; `compareOrders` becomes its text formatter, so the wording stays as today. When analyses exist, the text adds screen types ("title image replaced by a gameplay battle screen").
- A project that skipped intermediate snapshots (it adopts N while at P, with M between) sees the combined change set P→N computed on the fly, and the history view lists M as well.

### D5. Analyses of archived images

- Analysis records are keyed by image hash (12A), so archived images keep their analyses, free. Nothing is re-analysed because of a refresh; the next analysis plan contains **only the new images** (with the usual approval).
- Patterns, the comparison grid and recommendations use the **current** decks. Reports built on older decks become "not current" through the existing data hash and are labelled "Based on the store as of 27 Sep", kept as history.
- New report parts: **"What changed since the last refresh"** per game (events with before/after thumbnails and screen types), and per game **"What they used before"**, the previous deck with its analyses.
- Provenance for old decks: "What they used before" uses, for each image, the analysis under the project's analysis key if there is one, otherwise the newest usable record under an older key, labelled with its date and "analysed with earlier settings". An analysis made after the image was archived is labelled "analysed on <date>, after it left the store". A toggle "Include earlier decks in the patterns" (off by default) lets the user see whether trends shifted.

### D6. Shared history across projects

- Snapshots and change sets are **shared per game** in the library: one timeline, whichever project observed it (`observedBy` shows the project name locally; in a shared package it becomes "another project", 3b C7).
- **Each project's current view is its own last refresh** (its decks' `snapshotId`). When project B refreshes Capybara Go, project A's view does not change. A's page shows a notice: "Newer store data for Capybara Go exists (seen 28 Sep in Other Game): 2 changes. [Use it]". Using it is a user action with a short preview; it costs nothing (no store read, the images are already in the library), and it is recorded as a refresh of those decks in A.
- Writes are safe: refreshes run in the store lane, one at a time across all projects; snapshots are write-once; `confirmations.json` is append-only.
- Share packages (3b) include the library snapshots and change sets of the project's games, so the friend receives the history too; merging is a union of write-once files.

### D7. UI

- **History view per game** (a tab on the game in the workspace): one row per date and country-language, with the deck as a strip of thumbnails; badges for added, removed, moved, replaced; archived images greyed with "Used until 27 Sep" and their (i) analysis. Filter by country.
- **Grid highlight:** after a refresh, changed cells carry a badge ("new", "moved from 3", "replaced"; hover shows the old picture), with a "Show only changes" toggle.
- **Home card:** "Store data from 27 Sep · 12 changes found on 28 Sep".

### D8. Tests

- Change detection table: each event, the near-identical sub-label, same picture under a new Google ID (no event, metadata recorded), duplicate occurrences of one image, reorder combined with insertion and removal, unavailable and back, length changes, flip-flop A→B→A (net change empty, timeline shows both edges), determinism under shuffled inputs.
- Branches: a shared package's snapshot with the same parent as a local one shows as a parallel observation.
- Refresh transaction: stop at each step; the project's store state is unchanged before the commit marker.
- No automatic store reads (a spy on the Play client over start, open, wizard and idle time).
- Refresh commit: snapshots written only on change, confirmations otherwise; refs archived and current; decks updated; order file written; archived images kept by Free up space.
- Two projects sharing a game: B's refresh leaves A's view unchanged; A's "Use it" adopts at no cost; combined P→N change set.
- Analyses of archived images reused; next plan contains only new images; the old report labelled with its store date.
- Backfill from Rogue Legend's run manifest and order files without network.

### D9. Risks

| Risk | Mitigation |
|---|---|
| Google tests different screenshots with different visitors, so decks flip between refreshes | Each change is "seen on this date"; flip-flops are shown as such; a "Check again" action re-reads one page before the user acts on a change |
| Disk grows with archived originals | Shown in the approval screen; a later option keeps only thumbnails and analysis-sized copies of archived images |
| A full refresh takes minutes (about 4 minutes for 271 pages at the store pacing) | Refresh per game or per selection; live progress |
| Confusion between projects that refreshed at different times | Each project states its store date; the "Newer store data exists" notice |

## 13. Decisions for the user

- **D1** Default ticked countries for a new project: the current Asia set (proposed), or none, or the last project's set.
- **D2** One AI job at a time across all projects (proposed), rather than one per project.
- **D3** A download resumes without a new approval, from the immutable approved list, even if settings changed meanwhile (the changes become the next increment); analysis asks for a one-click "continue" approval that shows what was already spent (proposed).
- **D4** Our game is fixed once a project is created (proposed); changing it means a new project.
- **D5** Deleting a project's files from the page is left out of this stage; Archive only (proposed).
- **D6** Scope of expansions in this stage: the state model and the expansion question are built now, and choices are saved; running expansion increments is the next stage (proposed). The alternative is to add the expansion step to this stage, which roughly doubles it.

- **D7** (share, 12C) The "Light" package carries the **analysis-sized copies** of analysed images rather than their full-size originals (decided by the user, 2026-09-28). This keeps Light near the expected 40–50 MB: full-size originals of about 85 analysed images would add roughly 150 MB after the core check. The analysis-sized copies are enough for viewing and for re-analysis; the originals can be fetched later (C6).

## Review outcome

Reviewer: gpt-5.6-terra, 2026-09-27. Raw review: `docs/reviews/project-setup-plan-review-terra.md`. 19 findings: 13 accepted, 6 partly accepted, 0 declined.

| # | Finding | Outcome | Reason |
|---|---|---|---|
| 1 | Expansions and a recommendations stage missing from the lifecycle | Partly accepted | Added a `recommendations` stage, increments in the state model and journal, and the saved expansion question; running expansions stays in the next stage (D6), since the analysis code does not support layer diffs yet |
| 2 | Analysis endpoints do not check the pick | Accepted | Verified in `api.ts`/`job.ts`: no fit check. The server and CLI now refuse without a download or a pick that passes the fit rule. `confirmed` is not required, because the page flow never sets it; the approval screen shows the list |
| 3 | Continue can exceed the batch budget | Accepted | Verified: `runApproved` starts at $0. Added a persisted batch spend ledger; the runner gets `limit − spent` |
| 4 | Crash mid-call charges again | Partly accepted | The CLI providers have no request IDs, so no reconciliation is possible; the bound (one image per stop) is stated on the Continue panel and in risks |
| 5 | Download resume can use a changed plan | Accepted | Approved plans are copied to immutable `state/approved/<hash>.json`; resume reads only that; settings edits become the next increment |
| 6 | Store check not resumable per target | Accepted | Added `state/store-check.json` with a work list and per-target checkpoints |
| 7 | Lock takeover races and pid reuse | Accepted | Nonce ownership, process start time, rename-based takeover, never delete a lock you do not own |
| 8 | Single-instance server underspecified | Accepted | Lock before listen, `server.json` after listen, nonce-checked `/api/health` |
| 9 | Automatic migration conflicts with approval | Accepted | Import is only offered; it runs when the user presses Import (or `migrate -- --yes`) |
| 10 | Draft project cannot pass `ConfigSchema` | Accepted | Draft vs runnable split; drafts never load the strict config |
| 11 | Two analysis-status stores | Accepted | `state/job.json` is the only one; the old file is read once as a fallback and no longer written |
| 12 | Incremental reuse trusts old manifests | Partly accepted | Integrity check added (in last completed download, all images present); a confirmed "unavailable" is still reused, re-checked by the later refresh action |
| 13 | Icon download checks too weak | Accepted | No redirects, timeout, content type, streamed size cap, pixel limit |
| 14 | Zod missing at existing file reads | Partly accepted | Schemas for every file the new code and resume read; retrofitting the image database and deck manifests is out of scope |
| 15 | Search mock shows fields search does not return | Accepted | Results show icon, name, developer, rating; category and downloads on the confirmation card |
| 16 | Route move incomplete | Accepted | Route inventory, one API helper, redirects/410 for old paths, integration test per route |
| 17 | Report freshness not defined | Partly accepted | Already defined by the existing `batchDataHash`/`synthesisNeeded`; the plan now says so explicitly and reuses it instead of a new fingerprint |
| 18 | 300-line rule not enforced | Accepted | Added a file-size test |
| 19 | Removal silently invalidates reports | Partly accepted | Reports become "not current" through the existing data hash and are labelled "Based on an earlier pick or data", kept as history; no extra mechanism |

Terra's suggested user decisions: automatic migration (settled: never automatic); download resumability after settings edits (D3); default countries (D1); global AI policy (D2, kept, with the lock fixes above).

### Delta review 1: shared library (section 12A)

Reviewer: gpt-5.6-terra, 2026-09-27. Raw review appended to `docs/reviews/project-setup-plan-review-terra.md`. 10 findings: 5 accepted, 4 partly accepted, 1 declined.

| # | Finding | Outcome | Reason |
|---|---|---|---|
| 1 | Analysis key omits review and settling prompts and preprocessing | Accepted | Key is now the hash of a full pipeline spec defined in one module |
| 2 | "Never downloaded twice" impossible for unknown Google IDs | Accepted | Guarantee restated: stored once, analysed once, each Google image ID downloaded once |
| 3 | Legacy records lack full provenance for a shared key | Accepted | Only provable records become shareable; the rest stay usable by Rogue Legend (no re-analysis) but are not free for other projects |
| 4 | Cross-project appearances leak between projects | Declined | All projects belong to one local user; showing "also used in Other Game" is useful. The multi-user case is noted in 12B (B4) |
| 5 | Cost attribution not crash-safe | Partly accepted | Attempt written as "started" before the call and the ledger derived from attempts (one source); the CLIs have no idempotency keys, so an interrupted call is shown with its estimate |
| 6 | Import rollback could delete entries another project started using | Accepted | The import holds the library lock and both lane locks throughout |
| 7 | Google-ID mapping races and upstream changes | Partly accepted | Mapping is append-only with dates; no extra lock, because downloads already run one at a time globally |
| 8 | Identity refresh invisible to report freshness | Partly accepted | Separate `identityUpdatedAt`; freshness unchanged, because reports do not render appearances |
| 9 | Approval invalidation when another project finishes an image | Partly accepted | Clarified: tiers come from record state at planning; a change that makes the batch cheaper is skipped as free, anything else changes the fingerprint and asks again |
| 10 | Free up space races ref changes; live set undefined | Accepted | Live set defined; deletion rescans refs while holding the library lock, which every refs write also takes |

### Delta review 2: web-readiness rule (section 12B)

Reviewer: gpt-5.6-terra, 2026-09-27. 6 findings: 3 accepted, 3 partly accepted, 0 declined.

| # | Finding | Outcome | Reason |
|---|---|---|---|
| 1 | Storage interface too broad (locks, link, delete, list) | Partly accepted | Locks moved to a separate leases module, `link` import-only, deletion internal to Free up space; `list` kept as an unordered async iterator |
| 2 | No ownership scope in storage and job contracts | Partly accepted | Project-scoped calls take a `ProjectContext` now; no tenant or auth model is built |
| 3 | Providers should not resolve storage references | Accepted | Analysis code resolves images into a provider-neutral `ModelImage` |
| 4 | Job contract underspecified | Accepted | Versioned job record with frozen input, checkpoint, result, idempotent enqueue by plan fingerprint, defined transitions |
| 5 | Milestone 1 too large; verification narrow | Accepted | Split into 1a and 1b with one checkpoint, interrupted-import and hash tests added, record lock moved to milestone 2 |
| 6 | Retention and reachability rules missing | Partly accepted | Reachability roots added (refs, approved copies, job checkpoints); the scan-based procedure in A7 already existed |

### Delta review 3: share and import (section 12C)

Reviewer: gpt-5.6-terra, 2026-09-28. 8 findings: 5 accepted, 3 partly accepted, 0 declined.

| # | Finding | Outcome | Reason |
|---|---|---|---|
| 1 | Report-only HTML contradicts "never serve package content" | Accepted | Report-only is an export-only view from the tool's own template (no script, restrictive CSP); never importable |
| 2 | File list is not a dependency closure | Accepted | Manifest carries the closure (refs → images → records → cited answers) by content hash; only originals may be deferred |
| 3 | Update import not atomic | Accepted | The whole merged tree is built in staging, validated, then swapped under the locks with a commit marker; deterministic conflict names |
| 4 | Inspect cannot validate without writing | Accepted | Inspect streams and checks everything, writing only a verification result bound to the upload's hash; import re-hashes |
| 5 | No project revision; divergence undetected | Partly accepted | Added revision, base revision and state hash, and a "you both changed it" summary; no full three-way merge, because the union rules already decide each conflict |
| 6 | Conflict record files break the key model | Partly accepted | Incoming records become immutable variants beside the selected record, exported, reachable and selectable; the `<key>.json` layout stays |
| 7 | Zip validation incomplete | Accepted | Stored/deflate only, no encryption, header agreement, CRC plus SHA-256, totals from validated entries, manifest digest |
| 8 | Refetching originals assumes identical bytes | Partly accepted | Three outcomes (recovered, changed on Google Play, gone); old references and analyses are kept; adopting new pictures is left to a deliberate store refresh (12D) |

### Delta review 4: store history (section 12D)

Reviewer: gpt-5.6-terra, 2026-09-28. 8 findings: 5 accepted, 3 partly accepted, 0 declined.

| # | Finding | Outcome | Reason |
|---|---|---|---|
| 1 | Preview cannot know hash-level changes before downloading | Partly accepted | The preview is by Google image ID and marked provisional; the exact classification follows the free download. No pre-approval download, because approval must come before downloading |
| 2 | Snapshot identity, parentage and branches undefined | Accepted | ULID, parent pointer, observer, edges keyed by parent and child; branches from shared packages shown as parallel observations |
| 3 | Refs cannot hold history | Accepted | Snapshots with occurrences are the history; current and archived membership are derived; refs only mark reachability |
| 4 | Duplicates and mixed reorders ambiguous | Accepted | Occurrence matching in a fixed order with minimal-distance pairing and tie rules |
| 5 | Visual hash drops metadata | Partly accepted | Metadata changes are recorded in the confirmation entry; no separate full-state snapshot |
| 6 | "Combined P→N" semantics unclear | Accepted | Net change for the grid, event timeline for history and report |
| 7 | Refresh commit not atomic | Accepted | Staged transaction; a project's snapshot moves only after its files are durable; commit marker |
| 8 | Old decks may show later analyses | Partly accepted | Old decks prefer the current-key record, otherwise an older key's, labelled with date and "after it left the store"; no per-snapshot analysis freeze |

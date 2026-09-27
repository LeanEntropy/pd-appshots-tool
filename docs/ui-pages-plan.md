# Gallery pages and a report that always has content: plan

> **Update 2026-09-28:** the user's report requirements (`docs/report-requirements-user-2026-09-28.md`) override section 3 of this plan. The report is now numbered with a table of contents: 1 overview (a computed verdict and prioritised key points, worded by AI when current), 2 patterns and partial patterns (order too) each marked [V] fits or [X] different with the reason, 3 one row per store position with our screenshot first, 4 recommendations, 5 detailed statistics. There are no per-game image lists. A title image now counts as the in-game title screen: taxonomy 3.1, analysis prompt v4, and a deterministic remap of saved records.

Date: 2026-09-28. Scope: the gallery page (`src/view/`), its server API (`src/server/`), and the final report (`src/analysis/final-report.ts`, `report-sections.ts`). The analysis pipeline itself is out of scope.

## Problems

- The gallery is one long page. The picker, grid, overview, analysis and report compete for attention, so the user cannot find things.
- The report is written only at the end of a run. When the AI synthesis is skipped, the report even drops the deterministic content (patterns and ours vs the patterns). The user then sees one line and nothing useful, not even the store order.

## 1. Pages with a menu

- A top menu (tabs) under the page title: **Overview**, **Competitors**, **Screenshots**, **Analysis** and **Report**.
  - The active tab has an accent background; the others are neutral.
  - The state lives in the URL hash (`#overview`, `#competitors` and so on). Back and forward work, and a reload keeps the tab. The default is `#screenshots`.
  - Tabs are real links with `aria-current="page"`, so keyboard and screen readers work.
- Each page is a `<section data-page>`. Only the active one is shown, which is cheap because the pages are only hidden, not re-rendered.
  - **Overview:** the free store overview, with its build button.
  - **Competitors:** the named competitors' decks with the "core competitor" ticks, and the ordered pick list with drag and drop. The picker moves from the side column into this page.
  - **Screenshots:** the comparison grid (next-batch marks, counts), then all downloaded decks (ours, named, chart games).
  - **Analysis:** the batch selector, Start analysis, the status/run panel, and a short explanation of the steps. The approval dialog stays a modal, so it works from any page.
  - **Report:** the report (section 3), with a selector for earlier runs.
- The sticky run bar stays above the menu on every page. Its "Details" button switches to the Analysis page.
- After "Approve and run", the dialog stays the run panel (as now). Closing it goes to the Analysis page.
- Links inside pages (e.g. "Show the final report") switch tabs through the hash.

## 2. Colour and hierarchy

- The existing tokens (`--accent`, `--next`, `--tint`, `--warn`, light and dark) stay. New ones:
  - `--accent-2` (teal), for section headers;
  - `--ok` (green), `--mid` (amber) and `--bad` (red), for the verdicts following, slightly different and very different;
  - `--head-bg`, a tinted header background.

  Each is defined for both light and dark mode.
- Foldable section headers (`<details class="sec">`) get a coloured left bar and a tinted background. Content sits in cards. The type scale is 22 / 18 / 15 / 13 px.
- Share bars: a thin inline bar (CSS width percent) next to each percentage in pattern tables. The number is always shown as text too.

## 3. Report content, always

New module `src/analysis/report-data.ts` with `buildReportData(loaded, stage)`. It is deterministic (no AI) and computed from what is on disk, so it works even when synthesis never ran.

- **Batch:** the approved plan saved for the stage (`pending/analysis-plan-<stage>.json`), falling back to a freshly built plan (not saved) if none exists.
- **Store order per game:** for each game in the batch, every store position from the core-market deck (including excluded tablet images, marked as excluded). Each position shows:
  - image id, thumbnail and full path;
  - screen-type label, subtype and headline;
  - orientation (pixels) and composition, with the captures;
  - marketing layer yes or no;
  - status (analysed / not double-checked / not analysed, with the reason).

  The order date comes from the saved order snapshot.
- **Position-by-position comparison:** a matrix with positions 1..max as rows and games as columns. Each cell holds the screen-type label and headline (and the thumbnail in the page).
- **Pattern stats:** `findPatterns()` over the competitors' usable entries, and `compareOurs()` for ours. These run even when some images are missing; `n` per position and the missing list are shown ("computed from 14 of 18 screenshots; missing: ..."). They are only omitted when there are fewer than 2 usable competitor screenshots, with a message saying so.
- **AI synthesis:** the interpretation, recommendations and review JSON from the latest report run of the stage, if it exists. Also a freshness flag: does its data hash equal the current `batchDataHash`? If not: "written from older data; press Start analysis to refresh (no new images, about $X)".
- **Why synthesis is missing,** as one of these exact reasons:
  - never run;
  - N screenshots missing (listed), to be retried by Start analysis;
  - the batch stopped early (with the reason);
  - the spending limit was reached;
  - written from older data.

  Each reason comes with how to fix it and the estimated cost. The page shows an "Open the approval" button that runs the normal approval flow; nothing runs without approval.
- **Recommendations:** each slot shows the full screenshot spec and the full marketing-layer spec (mask; a text table with text, role, colour, outline, font, size and position; extra elements). Up to 3 **competitor examples** are shown as thumbnails: competitor screenshots whose screen type matches the slot, chosen deterministically (same position first, then by game order).
- **Runs:** a list of earlier report runs (`reports/<run id>/report.md`, newest first) for the selector. Picking one shows that run's saved markdown as HTML. "Current" shows the live data.

### API

- `GET /api/report?stage=pilot` returns `{ data: ReportData, runs: [{ runId, file, createdAt, complete }] }`.
- `GET /api/report?stage=pilot&run=<id>` returns the saved markdown of that run as HTML. The id is validated against the listed runs; no path input.

### Markdown

- `writeFinalReport` builds the same `ReportData` and renders it to markdown in the same order: store order per game, position comparison, pattern stats, ours vs the patterns, AI insights, recommendations with example thumbnails, then problems. Image links are relative (`../../images/...`), as now.
- New CLI `npm run report -- pilot` rewrites the latest markdown report from the data on disk, with no AI. It is written to `reports/<stage>-current.md` and does not touch `latest-<stage>.json`, so the user can get a full report without a run.

## 4. Files (each under 300 lines)

- `src/analysis/report-data.ts` (new): builds the data.
- `src/analysis/report-md.ts` (new): renders the data to markdown. `final-report.ts` calls it; `report-sections.ts` is folded into it or trimmed.
- `src/server/api.ts`: the report endpoint and run listing.
- `src/view/gallery-css.ts` (new, CSS moved out of `gallery-html.ts`); `gallery-html.ts` (page skeleton, menu); `gallery-nav.ts` (new, hash routing); `gallery-report.ts` (new, client render of the report data); `gallery-report-parts.ts` (new, if needed).
- `src/cli.ts` and `src/steps/`: the `report` command.

## Tests

- `buildReportData`, on a temp project:
  - store order for every position, including excluded ones;
  - comparison matrix shape;
  - patterns present with 1 image missing, with the missing list;
  - the synthesis reason when never run;
  - AI parts read when present;
  - stale flag.
- Markdown: it contains the store-order and pattern sections when synthesis is missing.
- API: an unknown run id is refused (404), and the run list is newest first.
- View: the page script parses. The menu hash switches pages (vm test with a fake DOM for the router function). The report renderer escapes text (a headline with `<script>` is rendered as text).

## Risks

- Merge with `feat/project-setup` (the other agent): the same view files are touched. The page structure is changed in one place (`gallery-html.ts`) to keep conflicts local.
- Old report runs have no data JSON for the deterministic parts. That's fine: "Current" is always computed live.

## Changes after the plan review (gpt-5.6-sol, docs/reviews/ui-pages-plan-review-gpt.md)

- **Pure builder:** `report-data.ts` is pure: `buildReportData(inputs)`. A separate `report-inputs.ts` does all disk reads (the plan, records, image db, orders, latest pointer, run status, AI JSON), so the builder is unit-tested without files.
- **No silent fallback plan:** if no approved plan is saved for the stage, the report says "no approved batch yet". It shows the store order of the batch that Start analysis would propose, labelled as not approved.
- **Snapshot per run:** every run saves `report-data.json` next to `report.md`, and the page renders earlier runs from it. Runs from before this change have none; the page then shows their saved markdown (rendered by the existing escaping markdown renderer, as today) with a note. From `/views/gallery.html`, `../../images/` resolves to `/images/`, so their image links work.
- **Provenance:**
  - Freshness uses `latest-<stage>.json`'s `dataHash` (already saved) against `batchDataHash` now.
  - The stop and skip reasons come from the saved run status (`error`, `synthesisSkipped`, `aborted`).
  - Order dates come from the saved order snapshots. A field that is missing shows as "unknown", never guessed.
- **AI output never attached to a different batch:** AI output is shown as current only when its data hash matches. Otherwise it is shown under "From an earlier run (older data)", with the run id.
- **Partial patterns:** `findPatterns` already counts per position from the entries it gets, so `n` per position is honest. The report states "computed from X of Y screenshots" and lists what is missing. Ours vs the patterns is compared only for our analysed positions; the others say "not analysed".
- **Ours vs the patterns** is a required section in both the data and the page.
- **Competitor examples** are chosen from the run's own entries and saved with the run's data.
- **One model, two views:** HTML (page) and markdown render the same `ReportData`, in the same sections and order, with images in both.
- **Endpoints:**
  - `GET /api/report/current?stage=`: live data;
  - `GET /api/report/runs?stage=`: the list;
  - `GET /api/report/run?stage=&id=`: that run's data, or its markdown as HTML for old runs; the id is validated against the list.
- **Heavy pages:** hidden pages don't load lazy images. The report renders when its tab opens and when data changes.
- **Accessibility:**
  - Hash parsing is one pure function (`pageFromHash`), with a fallback to Screenshots.
  - Focus moves to the page heading on a tab change.
  - Tabs are links with `aria-current`.
  - Verdicts show a text label as well as a colour.
  - Required report sections are open by default.
- **"Open the approval"** calls the existing approval flow. The dialog lists exactly the images to send, and runs skip analysed images (resumable).

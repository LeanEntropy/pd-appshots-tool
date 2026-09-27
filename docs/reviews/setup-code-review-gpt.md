# Setup milestone: cross-family code review (gpt-5.6-sol)

- Reviewer: `codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral`, prompt on stdin with all source files, tests, configs, the plan-v2 Setup/data sections and the PILLARS rules inlined.
- Date: 2026-09-27. Reviewed code: the Setup milestone before the fixes listed at the end.

## Reviewer output (verbatim)

## 1. Correctness bugs

### High

1. **Incomplete downloads can exit successfully**
   - **File/function:** `src/cli.ts`, `download`; `src/steps/download.ts`, `runDownload`
   - **Why:** Success depends only on screenshot fetch failures. Failed chart requests and listing errors are recorded separately but do not make the command fail. The CLI can print “Done” and exit 0 while required chart decks or store pages were never downloaded.
   - **Fix:** Treat unresolved chart/listing errors as incomplete-plan failures, or require explicit approval to proceed with omissions. Include `decksFailed`/chart failures in the returned success status.

2. **The approved plan is neither validated nor integrity-checked**
   - **File/function:** `src/steps/preview.ts`, `readPlan`; `src/cli.ts`, `download`
   - **Why:** `download-plan.json` is cast directly to `DownloadPlan`. Before downloading, only its age and `configHash` are checked; `planHash` is not recomputed. A corrupted or edited plan can download different URLs than the user previewed and approved.
   - **Fix:** Define a Zod schema for persisted plans, parse it, and recompute/verify the plan hash immediately before approval and download.

3. **Configured core market is ignored**
   - **File/function:** `src/steps/select.ts`, `englishLength` and `currentFit`
   - **Why:** Deck lengths always come from the market marked `baseline`, although `core.market` is independently configurable and only checked for existence. A valid configuration where those differ computes the fit from the wrong locale.
   - **Fix:** Resolve the market identified by `core.market`, require its intended language, and use it consistently. Alternatively enforce that `core.market` equals the sole baseline market.

### Medium

4. **Slot count excludes our own deck and is not fixed**
   - **File/function:** `src/steps/select.ts`, `currentFit`
   - **Why:** `slotCount` receives only selected competitor lengths, although the core set includes our live deck. It is also recomputed from mutable selection state rather than persisted when Setup is confirmed, so it is not “held for the whole core check.”
   - **Fix:** Compute from the specified full core-deck set, including ours if required by the slot rule, then persist the value in the immutable/setup run configuration after confirmation.

5. **Taxonomy validation happens after image and deck mutations**
   - **File/function:** `src/steps/download.ts`, `runDownload`
   - **Why:** `loadTaxonomy` is called only while constructing the final run manifest. An invalid taxonomy can therefore fail the operation after images and mutable deck manifests have been written, leaving an unrecorded partial run.
   - **Fix:** Load and validate the taxonomy before downloading or writing any run data; retain its hash for manifest creation.

6. **Doctor may check the wrong Python installation**
   - **File/function:** `src/steps/doctor.ts`, `runDoctor`
   - **Why:** `pythonCandidates(...).at(-1)` always selects the final PATH candidate, ignoring `PSD_PYTHON` and an existing project virtual environment. It can report Python missing or obsolete while the configured PSD Python is valid.
   - **Fix:** Probe candidates in priority order and report the first executable version, preferably alongside the interpreter path.

7. **“Possibly same capture” is counted as a successful local match**
   - **File/function:** `src/steps/own-assets.ts`, `runOwnAssets` / `matchVerdict`
   - **Why:** A provisional pHash distance up to 16 is included in `matched`, despite pHash similarity not establishing that two images use the same capture. This can misreport unrelated local artwork as matched.
   - **Fix:** Count only exact and validated near-identical matches as matched. Report “possibly same capture” separately pending the milestone-2 labelled threshold test.

### Low

8. **Claude doctor check can accept a failed process**
   - **File/function:** `src/steps/doctor.ts`, `checkClaude`
   - **Why:** `ok` does not require `r.code === 0`; parseable JSON containing “OK” may pass despite a nonzero CLI exit.
   - **Fix:** Require both exit code 0 and a valid expected response.

---

## 2. Spec compliance gaps

1. **Named competitors and our game are downloaded for every market**
   - `configs/rogue-legend.json` sets both `namedCompetitorMarkets` and `ourMarkets` to `"all"`.
   - The plan calls for our live deck and core named competitors in US English, plus each country’s chart decks. Other named/localized decks belong to later user-approved expansions.
   - Set those scopes to `"baseline"`; `buildTargets` can still add named/own apps encountered in each country’s top-ten chart.

2. **Preview is not broken down per game and locale**
   - `describePlan` shows aggregate group counts and chart-country counts only.
   - The requirement asks for deck and image counts per game per locale.
   - Add a deterministic per-target table including availability, deduplicated screenshot count, and estimated bytes.

3. **No core-list approval checkpoint**
   - `select` immediately writes the selection; `fit` only displays it.
   - Setup must show the resulting whole decks and exact image count, then wait for explicit approval.
   - Add a confirm/`--yes` step that freezes an approved core plan, slot count, and exact total.

4. **Run manifest lacks required reproducibility inputs**
   - `RunManifest` contains config/taxonomy/plan/deck hashes, but not the lockfile hash, corrections revision, or a complete object-hash map.
   - Add these fields even when the corrections/object sets are initially empty.

5. **Required source-of-truth layout is incomplete**
   - `projectPaths` provides `images/orig`, `images/thumb`, decks, runs, and views.
   - The approved layout requires `images/{orig,web,model,crops}`, `data/objects/<step>/<input hash>.json`, `reports/<run id>/`, and correction state. `thumb` does not substitute for all these paths.

6. **Package-ID resolution is not a distinct verified result**
   - IDs are consumed directly from config and listing failures are tolerated. There is no persisted resolution/verification record connecting configured names to resolved Play listings.
   - Persist verified ID/title/status results and block or explicitly approve unresolved required apps.

7. **Chart/listing failure prevents fulfillment of “all chart decks”**
   - Preview exposes failures but still creates an approvable plan, and download can succeed without those decks.
   - Require a complete chart result for every configured country, or clearly make an incomplete snapshot a separate explicitly approved state.

8. **Core choice is not constrained to 5–8 at save time**
   - `runSelect` accepts any number and writes it; the fit result may later fail.
   - The final approved selection should reject fewer than five fitting decks and freeze no more than eight.

9. **No test covers the persisted approval boundary**
   - The requested algorithmic tests exist for deduplication, identity, fit, and preview totals.
   - Missing coverage includes plan tampering/staleness, core confirmation/freeze, and incomplete chart/listing behavior.

---

## 3. Rule violations

- **TypeScript strict / `any`:** No violation found. Strict mode is enabled and no explicit or implicit `any` is evident in the inlined TypeScript.
- **Maximum 300 lines:** No violation found; every inlined file is below 300 lines.
- **Biome:** No definite violation is evident from the inlined code. Actual compliance still requires running `biome check`.
- **No emojis:** No violation found.
- **Plain-language output:** Some user-facing output leaks internal identifiers:
  - `describePlan` prints a hash-derived “Plan id.”
  - Download failures are prefixed with Google image IDs.
  - The preview prints raw category identifiers such as `GAME_ROLE_PLAYING`.
  
  Prefer game/locale/position descriptions and humanized category names; put hashes and provider IDs only in an optional diagnostic mode or log.

---

## 4. Minor suggestions

- Validate unique market `(gl, hl)` pairs and require `ourApp.id` to use the same package-ID rule as competitors.
- Validate `pilotCompetitors <= maxCompetitors` and `maxCompetitors <= competitors.length`.
- Include orientation in `DeckSlot`; it is computed and stored in the image database but omitted from deck manifests and views.
- Remove the Codex doctor probe’s temporary output file after reading it.
- Zod-validate the image database, deck manifests, and run manifests when loading instead of relying on type assertions.
## Resolution (by the implementing agent)

### Fixed
| # | Finding | Fix |
|---|---|---|
| Bug 1 | Incomplete download could exit successfully | `download` now fails (exit 1, plain message) when any image, store page or chart could not be read; the preview records an `incomplete` list and warns |
| Bug 2 | Saved plan not integrity-checked | `computePlanHash` over exactly what would be downloaded; `planProblem` recomputes it and checks config hash and age before approval. Test added (`test/plan.test.ts`) |
| Bug 3 | `core.market` ignored | New `coreMarket()`; fit and slot count now read deck lengths from the core market |
| Bug 5 | Taxonomy validated after writes | Loaded and validated before any download or write |
| Bug 6 | Doctor probed the wrong Python | Probes candidates in the PSD-reader priority order and shows the interpreter path |
| Bug 7 | "Possibly same capture" counted as matched | Reported separately as unconfirmed |
| Bug 8 | Claude probe ignored exit code | Requires exit code 0 |
| Spec 2 | Preview not per game and locale | Terminal shows per-game, per-country screenshot counts for ours and named; every store page (incl. chart games) is in `pending/download-preview.md` |
| Spec 3 / 8 | No core-list confirmation | `select` now shows the whole-deck fit and asks for confirmation (`--yes` or typing yes); only a fitting pick (5-8 whole decks within the cap) can be confirmed; the confirmed list, image total and slot count are stored in `run-config.json` |
| Spec 6 | No resolved-id record | Preview writes `pending/resolved-ids.json` (config name vs store title, developer, status) and shows store titles that differ from the config name |
| Spec 9 | Approval boundary untested | Plan tamper/staleness tests added |
| Rules 3 | Internal ids in output | Plan hash removed from output; failures described by game, country and position; category shown as "Role Playing" |
| Minor | Config validation | Unique country/language pairs, package-id rule for our app, pilot count not above max |
| Minor | Orientation missing from deck slots | Added |
| Minor | Codex probe temp file | Removed after reading |

### Declined, with reason
| # | Finding | Reason |
|---|---|---|
| Bug 4 (part) | Slot count should include our deck | Plan-v2 section 6 excludes our game from the pool; the slot count is from competitor decks by design. The "freeze" part is fixed via the confirmed record |
| Spec 1 | Download named competitors and ours only in US English | Kept "all markets" as the default: downloads cost no AI, the core-pilot capture-match test needs Capybara Go's JP/KR/TW decks, and country expansions need per-tier counts before approval. It is a config switch (`download.namedCompetitorMarkets` / `ourMarkets` = `baseline`) and the preview shows the cost. Flagged to the user |
| Spec 4 | Lockfile hash, corrections revision, object-hash map in the run manifest | No lockfile, corrections or analysis objects exist yet at Setup; added when those steps are built (core pilot) |
| Spec 5 | `images/{web,model,crops}`, `data/objects`, `reports/` | Belong to the "optimise images" and analysis steps of later milestones |
| Spec 7 | Refuse an approvable plan when a chart fails | The preview warns and the download reports "incomplete" with exit 1; blocking entirely would stop all downloads on one flaky chart call |
| Minor | Zod-validate internal JSON files | Internal data written by the tool itself; global rule is to validate at system boundaries (config, store data, user selection file are validated) |

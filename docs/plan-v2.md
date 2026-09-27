# Plan V2: store-screenshot competitor analysis tool (Google Play)

Status: **APPROVED by the user on 2026-09-27.** Implementation starts with the Setup milestone.

**Decided (user answers, 2026-09-27):**
- The core competitors are picked (and ordered) by the user in the tool's interface, not fixed in config. The config list is the candidate pool and default order.
- The early-stop rule and review coverage are adjustable parameters. Early stop starts at: at least 5 competitor decks, 2 decks in a row with no change, no share moving more than 10 points. Review coverage is a toggle starting at 100% everywhere.
- Core cap: 100 as the hard stop, aiming for about 85.
- Budget ceiling per expansion: $30, adjustable.
- PSD reader: psd-tools (Python helper), optional.
- Each game project keeps its own image database (content-addressed), so an identical image is stored and analysed only once.
- Supersedes `plan-v1.md`, which stays unchanged for history.
- Authority: `memory/PILLARS.md`, in particular its Product principle, Scale, Expanding-circle workflow, Cost tiers and model constraints.
- Evidence:
  - `docs/research/vision-models-bakeoff.md` (10 images × 5 models);
  - `docs/research/vision-models-public.md`;
  - the Play feasibility spike and own-assets inspection (copied to `docs/evidence/` at setup);
  - `reports/Game store screenshot analysis tools.md`.
- Companion: `docs/product-proposal-v2.md`.

This plan uses plain step names throughout, with no internal codes.

## 0. What changed from v1

| Topic | v1 | v2 |
|---|---|---|
| Scale | ~1,300 images in bulk runs | **Core check capped at 80–100 AI-analysed images in total, including our own**, then user-chosen expansions |
| Workflow | Download everything, analyse everything | **Expanding circle**: core check on 5–8 close competitors in English, then the tool *asks* how to expand (more English competitors and/or countries picked from a checkbox list) |
| Approval | Budget preflight | **Before every AI step the tool shows the image count per cost tier and the estimated cost, and waits for approval.** A hard cap in config |
| Localized pages | Full re-analysis per image | **Cost tiers**: identical image → no AI; same capture with a new marketing layer → only the cropped band/text regions plus the English analysis, returning a diff; truly different screenshot → full analysis |
| Chart games | Analysed in their charting countries | **Downloaded and shown raw at no AI cost**; analysed only if the user picks them |
| Models | Sonnet analysis, Haiku gloss | **Performance first**: Fable 5.1 analysis, Opus 5.5 for adjudication, translation and recommendations, gpt-5.6-sol for GPT reviews (GPT-6 Astra only for special image-review cases), no Sonnet or Haiku |
| Slot count | Fixed input (8) | **Data-driven output**: deck-length distribution per locale, recommended count capped at 8 |
| Philippines | en + fil | en only |
| Feature graphic / video | Downloaded | Out of V1 |

Kept from v1:
- the hybrid runtime;
- local files as the source of truth, with the Artifact as a view;
- content-hash caching, immutable run manifests, and feedback as tracked corrections;
- the build-vs-reuse choices;
- semantic validation and completeness checks;
- enforcement of cross-family review.

## 1. The expanding circle (core product flow)

```
Setup ──► Core check (English, 5–8 competitors + ours, ≤100 images) ──► first recommendation (US English)
                                   │
                        tool ASKS: expand?  ◄───────────────────────────────┐
             ┌─────────────────────┼─────────────────────────┐              │
     more English competitors   countries (checkboxes)   chart games (picked from raw view)
             └─────────── each = one approved increment ────────────────────┘
                                   ▼
                  per-country recommendations + updated English one
```

1. **Setup (no AI).**
   - Resolve package IDs from config.
   - **Download preview first:** the tool shows how many decks and images it will download, the expected disk use, and "0 AI-analysed images", then waits for approval before downloading anything.
   - Download our live deck, the core competitors' US-English decks, and **the top-10 grossing chart decks for every configured country** (all at no AI cost).
   - Detect duplicates and identical images across locales.
   - Publish a raw deck view.
2. **Core check.**
   - Candidates are our deck plus the 5–8 closest named competitors, **picked and ordered by the user in the raw deck view** (decided); the config order is only the default.
   - US English only, with every deck analysed in full.
   - **Whole-deck fit rule (code, at setup):** our live deck is counted first. The tool then adds competitor decks in priority order while the running total of whole decks stays within the cap, and stops at 8. It never plans a partial deck. The resulting set and its exact image count are shown before approval. **If fewer than 5 whole competitor decks fit, it refuses to start** and asks the user to raise the cap or change the list.
   - **Our images:** only our live Play deck (7 images) counts against the cap and is analysed. The 11 local files are matched to it by code (identical or same capture) and kept as reference only; any unmatched local file is listed, not analysed unless the user adds it (shown with its count).
   - **The slot count is fixed at setup** from the downloaded core deck lengths (code only, no AI; §6) and held for the whole core check.
   - The tool shows the count (target ~80–90, hard stop at the configured cap, default 100) and waits for approval.
   - A pilot slice runs first: our deck plus the 2 closest competitors, ~25 images, counted within the cap.
   - Decks are processed in priority order, and the stability check (§5) runs after each one.
3. **First recommendation**, for US English. The user reviews and rates it in the Artifact.
4. **Expansion prompt.** The tool offers three choices, and the user may pick several:
   - more English competitors (a list of the remaining named games with their image counts);
   - countries (a checkbox list of the configured markets, each with its cost-tier breakdown);
   - chart games (picked from the raw view, each with its count).
5. **Each expansion is one approved increment.** Before it runs, the tool shows the per-tier counts and the estimated cost. There is no fixed cap on expansions, but every increment needs approval.
   - **Prerequisites are included automatically.** If a picked country includes an app with no English analysis yet (a non-core competitor or a picked chart game), the increment adds that app's English deck analysis, shown as its own line with its count. Alternatively, when no English deck exists (e.g. the game is not available in the US), its localized images are planned as full analyses. Either way, the prerequisite is part of the same approval.
6. **Budget rule.** If an approved increment would exceed its budget ceiling, the lowest-priority competitor/country pairs are dropped first. Priority = competitor tier weight × market order in config. The dropped list is shown.

**Approval gate mechanism:**
- The **planning command** computes the step's work list and writes a pending plan with:
  - counts per cost tier and per app/locale;
  - **two separate totals:** unique images counted against the cap, and model passes per model (analysis, layer diff, review, settling disagreements, plus an allowance for retries and fallbacks);
  - estimated dollars and GPT tokens per model;
  - a plan hash.
- The Claude Code command shows it in plain language.
- The run command requires `--approve <plan hash>`, and refuses to run if the plan changed or the configured cap would be exceeded.
- Nothing calls a model without an approved plan.

## 2. Cost tiers per image (cheapest first; decided by code)

| Tier | Detected by (code) | AI work | Model |
|---|---|---|---|
| **Identical** | Same Google image id or file hash as an already-analysed image of the same app (usually the English one) | None. Reuse the analysis and mark the screenshot "unchanged from English" | — |
| **Same capture, new marketing layer** | The capture region matches an English image of the same app: mask out that image's analysed band/text/callout regions, then compare the rest (perceptual hash + mean pixel difference) above a threshold | Send only the **cropped band/text regions** (padded) plus a small low-res thumbnail for context and the English analysis. It returns a **layer diff**: local text per text block, band/colour/style changes, callout changes, and a "capture differs" escape flag | Opus 5.5 (lighter but capable; never Haiku; pending the second bake-off, see §3) |
| **Different screenshot** | No identical or capture match; or the match is uncertain; or the layer diff set the escape flag | Full analysis | Fable 5.1 |

- Images are cropped and resized to the model's needs: full images at ≤1568 px on the long edge, and crops at native resolution.
- **A whole deck goes in one call where possible.** Full analysis sends up to ~10 images per call and returns one validated result per image. If the deck call fails validation, the tool falls back to one call per image. Layer diffs are batched per app × locale.
- **Translation and lingo run on text only**, with no images.
- **"Screenshot unchanged from English"** is detected by code only: an identical image in a non-English locale, or a layer diff whose text is detected as English (language detection). It describes the screenshot, never the whole store page (listing text may still be localized). A deck where every screenshot is unchanged is reported as "screenshot deck not localized".

## 3. Models per step (performance first; cost optimisation only after the tool proves itself)

| Step | Model | Why AI is needed | Notes |
|---|---|---|---|
| Full screenshot analysis (screen type, capture description, marketing layer, exact text, approximate regions) | **Fable 5.1** | Judgement on screen type and reading stylized multi-script display text; classic OCR fails on game fonts | The bake-off shows Fable is uniquely good at picking the per-screen band colour behind our grey overlay. No Sonnet (user rule) |
| Marketing-layer diff on crops | **Opus 5.5** (pending) | Reading localized text and describing layer changes | Opus read every Japanese, Korean, Traditional Chinese and Thai headline correctly in the bake-off. Opus vs Fable for this role is in the second bake-off |
| Image-analysis review (cross-family) | **gpt-5.6-sol** (default); **GPT-6 Astra** only for special or high-value cases (e.g. a disputed Korean/Thai reading after Sol) | Independent second reading | Second bake-off screen-type accuracy: Sol 10/10, Luna 8/10, Astra 7/10, Terra 6/10. Astra is expensive on the user's plan, so it stays limited |
| Settling disagreements | **Opus 5.5** | Judges between two readings with both outputs and the image | |
| Translation and genre lingo | **Opus 5.5** (text only) | Meaning-level comparison, genre terms | |
| Per-country recommendations | **Opus 5.5** | Interprets the deterministic statistics | |
| Recommendation review (cross-family) | **gpt-5.6-sol** | | Based on indirect evidence (image-review accuracy), to be confirmed in the pilot. Terra is not used as a reviewer: it systematically mislabels marketing-band screens as promo/feature callout |
| Reviews of plans, prompts, schemas, code and documents (building the tool) | **gpt-5.6-sol** (or gpt-5.6-terra); **never GPT-6 Astra** | | User rule |

- No Haiku anywhere.
- Correction to the first bake-off: the Codex models on this account are gpt-5.5, gpt-5.6-sol, gpt-5.6-luna, gpt-5.6-terra and gpt-6-astra. `gpt-6-sol` does not exist, and the retired `gpt-5.3-codex` fails.
- Token counts per call are similar across the GPT models, but plan cost is not, so Astra stays limited to special image-review cases.

## 4. Runtime and providers

**Hybrid runtime:**
- A TypeScript command-line tool does all deterministic work and makes every AI call itself through a provider interface.
- Claude Code project commands are the operator interface. User-facing wording (shown on screen and in reports) is task-based; the command names appear only in technical docs:
  - "Plan the core check" / "Approve this image batch" (command `analyze`, with approval gates);
  - "Choose an expansion" (command `expand`);
  - "Publish the report page" (command `publish-report`);
  - "Bring in your feedback" (command `import-feedback`);
  - "Get a second opinion" (command `review`).
- They exist because publishing an Artifact and reading its database and comments are Claude Code tools. No agent analyses screenshots by hand.

**Providers:** each provider declares its family (anthropic/openai), resolved model and capabilities. The config validator refuses a reviewer from the same family as the producer.

| Provider | Invocation |
|---|---|
| Claude CLI | `claude -p --model <id> --setting-sources "" --disable-slash-commands --strict-mcp-config --system-prompt-file <prompt> --tools Read --allowedTools Read --output-format json --json-schema <schema> --max-budget-usd <x> "<image paths + context>"` |
| Codex CLI | `codex exec -m <model> -s read-only --skip-git-repo-check --ephemeral -i <img>… --output-schema <strict schema> -o <out> -` with the prompt on stdin |
| Anthropic / OpenAI API | Interface only; built when a key exists |

**Lessons from the spikes:**
1. The custom system prompt file is mandatory. Without it, the default preamble costs $0.05–0.53 before any answer.
2. Codex always needs an explicit `-m`, because the config default `gpt-5.3-codex` is retired.
3. The Windows sandbox blocks the model's file reads, so all text is inlined on stdin and images go via `-i`.
4. OpenAI strict schemas need `additionalProperties: false` and every property listed in `required` at every level. The tool generates this variant from the same Zod source.

**Validation:**
- Every output is checked with Zod, then semantically: image ids exist and match app, locale and position; positions are unique; types come from the taxonomy.
- A failure gets up to 2 repair retries, then the item is marked "failed" and the run continues.
- An `npm run doctor` smoke test makes one tiny structured vision call per configured provider.

## 5. Steps: deterministic vs AI

| Step | D/AI | Output |
|---|---|---|
| Resolve IDs | Code (`search` + `app` verify → lockfile the user confirms) | `configs/<name>.resolved.lock.json` |
| Download chart lists | Code | chart pool per market (deduped, rank) |
| Download decks | Code: base-URL dedup of the triplicated entries; order = store array index; full-res `=s0`; 404 = unavailable; throttled; screenshots only | raw payloads, `data/images/orig/<sha256>` |
| Ingest our local files | Code: all 11 local rasters, matched to our live deck (identical / same capture) with the documented mapping (the misnamed level-up file); reference only, not counted or analysed; unmatched files listed | own-local reference set |
| Identity and device class | Code: sha256 and perceptual hash; phone/tablet/unknown with confidence; every screenshot kept | image records |
| First measurement pass | Code: global palette; simple solid or diagonal bands only, each value with method and confidence, or "unknown" | measurements |
| Optimise images | Code: 240w and 720w WebP; model copies (≤1568 long edge) | web/model images |
| Cost-tier assignment | Code (§2) | per-image tier, shown in the approval plan |
| Full analysis | AI: Fable 5.1, deck per call | analysis records |
| Second measurement pass | Code: pixel measurement inside the regions the analysis named (band hex, height %) | region measurements |
| Layer diff | AI: Opus 5.5 on crops | diff records |
| Image-analysis review | AI: gpt-5.6-sol, blind, deck per call (Astra only for special cases) | reviews and disputes |
| Settle disagreements | AI: Opus 5.5 | adjudications, stored as tracked corrections |
| Aggregate and stability | Code (§6) | slot statistics, deck-length distribution, stability status |
| Translation and lingo | AI: Opus 5.5, text only; pairs aligned by code | glossary per locale |
| Our PSD | Code: psd-tools script → JSON | PSD layers and text |
| Recommendation | AI: Opus 5.5 per locale | recommendation records |
| Recommendation review | AI: gpt-5.6-sol | review notes |
| Reports and site | Code (templates; no AI writes HTML or markdown) | markdown, JSON, site |

**Statuses:** ok / failed / disputed / adjudicated / corrected.
- Statistics use ok, adjudicated and corrected; failed and disputed images count as coverage loss.
- If fewer than 90% of images are usable in a locale, that locale's recommendation is marked "incomplete" and the reports show a banner.

## 6. Consensus, stability and slot count

- **Unit:** one deck = (app, market), in store order. **Our own game is excluded from the pool**; it is only compared against.
- **Pool per market:**
  - analysed named competitors;
  - picked chart games, in their market only.
  - An app in both counts once, at its highest tier weight.
  - US English is its own market for the first recommendation.
- **N** = the slot count, fixed at setup from the downloaded deck lengths (code only) and held constant through each stability window. For each slot k in 1..N:
  - the denominator is the decks with a usable image at k;
  - report raw counts per screen type and the weighted share, Σ weight·[type] / Σ weight.
- **Position-agnostic view:** the share of decks containing each type anywhere in 1..N (denominator: decks with at least one usable image), and the median first position.
- **Slot count (a data-driven output):**
  - per locale: the deck-length distribution with n (min / median / max, named vs chart);
  - recommended count = the median deck length, **capped at 8 as the recommendation cap**. Google Play's per-device limit is 8 phone screenshots, so decks longer than 8 (Capybara Go 10, Archero 2 13) likely mix device types; the scraper doesn't separate them. Full decks of any length are kept and analysed;
  - framed as "what competitors do", not "what converts best".
- **Stability (for early stop):**
  - After each additional competitor deck in the core check, the tool recomputes the top screen type per slot for the fixed slots 1..N and the composition shares, and reports the coverage (decks with a usable image) per slot.
  - "Stable" = at least 5 competitor decks analysed, **no change in any slot's top type over the last 2 decks, and no share moved more than 10 points**. These are adjustable parameters in config (decided); the values here are the initial ones.
  - The tool then proposes stopping, with the images saved. The user decides.
- Named-only vs all-pool statistics are always shown separately.
- Test fixtures cover: unequal deck lengths, unavailable listings, overlapping apps, excluded images and ties.

## 7. Data, cache, snapshots, feedback

- **Per-project image database (decided):** every image is stored once under its sha256 with a perceptual hash; per game/locale/slot manifests point to image ids, so an identical image is never stored or analysed twice.
- **Local project folder = source of truth.** It holds:
  - `data/images/{orig,web,model,crops}`;
  - `data/objects/<step>/<input hash>.json` (never overwritten);
  - `runs/<run id>/manifest.json`: immutable; it references the config hash, lockfile, corrections revision and every object hash, so any past report can be regenerated;
  - `reports/<run id>/`.
- **Cache key** per AI call = hash of:
  - step and prompt/schema/taxonomy versions;
  - the resolved model;
  - the relevant config;
  - the input image or crop hashes;
  - the hashes of upstream outputs;
  - the corrections revision.
- Any upstream change invalidates only what depends on it. An image analysed once is never re-analysed unless one of these changes.
- **Snapshots:** runs are dated. A "compare runs" report shows chart movement, deck changes, and new or removed images.
- **Feedback:**
  - Feedback ids are revision-scoped (recommendation id + content hash; image id + analysis hash).
  - Imported feedback becomes an append-only list of typed corrections: screen type, text, exclude, recommendation verdict, adjudication.
  - Corrections feed the cache key, so a text correction re-runs translation and recommendation only for the affected items.
  - Conflicting corrections are held as "unresolved" and shown to the user, not applied.
- **Git (decided):** the repo holds the **tool only**: code, configs, taxonomy, prompts and schemas.
  - Each user's run data lives in their own gitignored local workspace folder (`workspace/`, configurable): images, analysis objects, run manifests, corrections, reports and the built site. The source-of-truth paths above sit under this workspace.

## 8. Outputs

**Local reports** (markdown with relative image paths, readable offline; JSON alongside):
- an index;
- recommendations per locale;
- one report per competitor deck (every locale, listing order, thumbnails linking to full-res, analysis and cost tier per image);
- one report per locale (pool, statistics, deck-length distribution, glossary);
- our own assets;
- a chart-games raw gallery.

A completeness check fails the build if any collected image is missing or lacks its analysis or status. Raw chart images show "not analysed".

**Artifact:** a private claude.ai page generated by a script from the same data.
- Tabs:
  1. Recommendation per locale, with current vs recommended side by side and the slot-count distribution.
  2. Analysed decks in listing order, with click-through analysis.
  3. Locale comparison aligned by capture match (not position), with the cost tier and "unchanged from English" badges.
  4. Chart games, raw.
  5. Statistics and glossary.
  6. Run info and comparison with the previous run.
- **Feedback:** approve / reject / unsure plus a note per recommendation and per image, stored in the page database, plus general comments. The import-feedback command pulls these into corrections.
- **Hosting:**
  - thumbnails are packed into one sprite sheet per app (≤16,383 px per side);
  - 720w images go to the asset store;
  - full-res stays local.
  - The core plus raw charts come to about 700 thumbnails and roughly 70 sheets, far under the 511-file limit.
  - A publish-plan check enforces ≤255 files / 64 MB per publish, ≤511 files / 256 MB per version, HTML ≤16 MB and assets ≤20 MiB each.
- **The setup step checks that the host can do all of this:** publish privately and open as owner, upload an asset, write and read the database, read comments. **If not, local-only mode:** the same page is built as an offline folder with a local feedback file.

## 9. Config (game-agnostic example)

```jsonc
{ "ourApp": "com.pockethaven.roguelegend", "category": "auto",
  "competitors": [ /* priority order = core order */
    { "id": "com.habby.capybara", "tier": "direct" }, { "name": "Mini Tales", "tier": "direct" },
    { "name": "Heroll", "tier": "direct" }, { "name": "Dicero", "tier": "same_audience" },
    { "name": "Archero 2", "tier": "same_audience" }, { "id": "com.dxx.firenow", "tier": "same_audience" },
    { "id": "com.DoorTeam.BagMaster", "tier": "same_audience" }, "…remaining named games" ],
  "core": { "competitors": 7 /* picked in the UI */, "market": "us", "imageCap": 100, "imageTarget": 85, "pilotCompetitors": 2,
            "stability": { "minDecks": 5, "window": 2, "maxShareShift": 0.10 } },
  "charts": [ { "collection": "GROSSING", "depth": 10, "analyse": "only-if-picked" } ],
  "markets": [ { "gl": "us", "hl": "en" }, { "gl": "jp", "hl": "ja" }, { "gl": "kr", "hl": "ko" }, { "gl": "tw", "hl": "zh-TW" },
               { "gl": "hk", "hl": "zh-TW" }, { "gl": "th", "hl": "th" }, { "gl": "vn", "hl": "vi" }, { "gl": "id", "hl": "id" },
               { "gl": "ph", "hl": "en" } ],
  "tierWeights": { "direct": 3, "same_audience": 2, "reference": 1, "chart": 1 },
  "slotCountCap": 8, "taxonomy": "taxonomies/mobile-rpg.v1.json",
  "ownAssets": { "dir": "rogue-legends_current", "psd": "_APPLE STORE.psd" },
  "models": { "fullAnalysis": "claude:claude-fable-5-1", "layerDiff": "claude:claude-opus-5-5",
              "imageReview": "codex:gpt-5.6-sol", "imageReviewSpecial": "codex:gpt-6-astra", "adjudicate": "claude:claude-opus-5-5",
              "translate": "claude:claude-opus-5-5", "recommend": "claude:claude-opus-5-5",
              "recommendationReview": "codex:gpt-5.6-sol" /* indirect evidence; confirm in pilot */ },
  "review": { "enabled": true, "coreCoverage": 1.0, "expansionCoverage": 1.0 /* decided: toggle, starts at 100% */, "alsoBelowConfidence": 0.7 },
  "budget": { "maxUsdPerIncrement": 30 } }
```

## 10. Taxonomy (draft, in a file, not in code)

**Screen types:**
- **key_art**: title/logo, character showcase, collage, CG scene.
- **gameplay**: battle, boss, victory, defeat, skill select, board/dice, backpack/merge, idle/auto, PvP, dungeon run.
- **metagame**: progression, character roster, character detail, gear, pets, skills/talents, base/town, gacha/summon, idle rewards.
- **map_world**: world map, stage select.
- **social**: guild, arena/leaderboard, co-op, chat.
- **events_rewards**: event, login rewards, battle pass.
- **iap**: shop, offer.
- **promo**: feature callout, social proof, collab/IP, update news.
- **other**: a note is required.

The bake-off exposed a gap: the "board/dice vs world map" boundary needs a written definition. For example, our "maps" screen was read as board/dice by 4 of 5 models.

**Marketing layer:**
- composition;
- bands (type, position, size, colour: measured hex or "unknown");
- text blocks (role, exact text, language, style, fill, stroke, size, approximate region);
- character/item callouts (kind, source, identity, placement, scale, breaks the frame);
- decorations and badges;
- relation to the screen and occlusion %.

Approximate regions (% boxes) are needed for cropping the layer-diff inputs and for the second measurement pass.

## 11. Build vs reuse (unchanged from v1 except where noted)

**Reused:**
- **google-play-scraper** (MIT), with @mradex77 as the fallback;
- **sharp** (Apache-2.0);
- **sharp-phash**, **colorthief**, **franc-min**, **zod**, **p-limit** (all MIT);
- **psd-tools** (MIT; our proven spike script). **Decided:** psd-tools, as an optional Python helper.

**Rejected:**
- AppStoreCat: a Python wrapper of a different scraper in a 5-service monorepo, stale;
- mcp-appstore: wraps an older version of the same library; optional for exploration only;
- Qwen3-VL, Grounded-SAM-2, OmniParser: GPU needs, overkill, or the wrong task;
- classic OCR: game fonts; tesseract.js gets one pilot test.

**Pattern reference only:** Stora, shots (no license), aso-skill (unclear license).

**Future:** rendering via store-screenshots / app-store-screenshots (MIT); App Store; feature graphic and video.

**Custom:** glue, capture-match cost tiering, band measurement, the taxonomy, consensus and stability, and the recommendation.

## 12. Milestones (each shows its image count and waits for approval)

| Milestone | Scope | Images analysed by AI | User checkpoint |
|---|---|---|---|
| 1. Setup | Repo scaffold, config and ID resolution, taxonomy, schemas, prompts, providers, host check. **Download preview (decks, images, disk use, 0 AI images) → approval →** downloads: core decks + ours + all chart decks; raw view published; whole-deck fit rule and slot count computed | 0 | Approve the download preview; then confirm the core competitor list and its exact image count (whole decks only) |
| 2. Core pilot | Ours + 2 closest competitors, full analysis, 100% image review; one deck also compared deck-per-call vs per-image. **Capture-match test (code only, no AI):** a hand-labelled set of ~20 same-capture and different-capture pairs from Capybara Go's already-downloaded Japanese/Korean/Taiwan decks against its English analysis; false-match rate and thresholds published. **Real unit costs measured** | ~25 (within the cap) | Rate accuracy in the page; taxonomy, prompts and match thresholds frozen |
| 3. Core check | Remaining core decks with the stability check (may stop early); first US-English recommendation + review | ~55–65 more → **~80–90 total** | Rate the recommendation; choose expansions |
| 4. Expansions (repeatable) | Each increment: tier counts + cost shown → approve → layer diffs / full analyses → per-country recommendation | per increment (estimates below) | Approve each increment; rate its recommendation |
| 5. Final report | Reports + Artifact, feedback import → next iteration | 0 | Rate; corrections feed the next run |

**Core estimate** (performance-first models). **Provisional:** the bake-off measured single-image calls only, and production sends whole decks. Every approval screen after the pilot recomputes its estimate from the pilot's measured deck-call, fallback, retry and review costs.
- Images: 7 competitors × ~9.5 + our 7 ≈ **74–90**. Capybara Go has 10 and Archero 2 has 13, so exact counts come from setup.

| Item | Estimate |
|---|---|
| Fable full analysis | ~85 × $0.15–0.25 ≈ **$13–21**. The bake-off measured $0.12 per single image with a compact schema; the full schema is larger |
| gpt-5.6-sol review at 100% | ~85 × ~17k input tokens ≈ **1.5M tokens** (subscription; token counts are similar across GPT models) |
| Opus adjudication | ~5–10 disputes ≈ $1 |
| Retries and per-image fallbacks | allowance ~15% of analysis cost ≈ $2–3 |
| Opus English lingo + recommendation | ≈ $1–2 |
| GPT recommendation review | 1–2 calls |
| **Core total** | **≈ $17–28 Claude-side + ~1.5–1.8M gpt-5.6-sol tokens** (provisional) |

Prompt fixes after the pilot re-run the pilot images: up to ~25 × $0.2 ≈ $5 more. Re-runs do not add new images.

**Per-country expansion** (7 competitors + ours ≈ 75 slots, assuming ~40% identical, ~50% same capture, ~10% different):

| Item | Estimate |
|---|---|
| Identical | free |
| Layer diffs | ~38 × $0.03–0.06 |
| Full analyses | ~8 × $0.2 |
| Translation + recommendation | ≈ $1 |
| Review | 25% sample of layer diffs + all full analyses and low-confidence items (gpt-5.6-sol) |
| **Per country** | **≈ $4–6** |

Localization varies by publisher (e.g. Legend of Mushroom uses one set everywhere). The approval screen shows the real tier counts.

## 13. Cross-family review policy

| Target | Coverage |
|---|---|
| Plans, prompts, schemas, code, documents | 100%, gpt-5.6-sol (or gpt-5.6-terra). **Never GPT-6 Astra** |
| Full analyses | 100% in the core check (deck-per-call review with gpt-5.6-sol); in expansions, all full analyses. GPT-6 Astra only for special or high-value cases |
| Layer diffs | Starts at 100% (decided: a toggle/parameter; may later be lowered to e.g. 25% + everything below 0.7 confidence + all Korean/Thai text) |
| Glossary and recommendations | 100%, gpt-5.6-sol (for recommendations, to be confirmed in the pilot) |

- Disagreements are settled by Opus 5.5 with both readings; taxonomy edge cases go to the user.
- Every settlement is stored as a tracked correction.

## 14. Risks and open questions

| Risk | Mitigation |
|---|---|
| 80–100 images may not be enough for a stable pattern | Stability metric shown per deck; the user expands with more English competitors if unstable |
| Capture-match threshold errors (changed gameplay mistaken for a marketing-only change, or vice versa) | Code-only capture-match test on hand-labelled pairs in the pilot, with published false-match rate; uncertain matches go to full analysis; the escape flag in the layer diff |
| Approximate regions miss text in crops | Generous padding + low-res context thumbnail; the escape flag; review sample |
| Deck-per-call attention dilution | Per-image validation, fallback to per-image calls, pilot comparison on one deck |
| Fewer than 5 whole competitor decks fit the cap | Whole-deck fit rule refuses to start; the user raises the cap or changes the list |
| Taxonomy boundary gaps (board/dice vs map) | Written definitions; the pilot rating freezes the taxonomy |
| Chart games are MMO/gacha (different audience) | Shown raw; analysed only if picked; separate statistics |
| Play scraping ToS; chart endpoint fragility | Throttle and cache; manual chart list fallback; private Artifact |
| Artifact host capabilities not available to other users | Setup check; local-only mode |
| Second bake-off may change GPT picks and the layer-diff model | Models are config values; the orchestrator merges the results |

# Plan V1 — Store-screenshot competitor analysis tool (Google Play)

Status: DRAFT v2. It incorporates GPT review 1 (`docs/plan-v1.review-gpt.md`, findings F1–F16) and is awaiting user approval. No implementation yet.
Authority: `memory/PILLARS.md`. Evidence (copied into `docs/evidence/` at M0): `spike-play/FINDINGS.md`, `assets-inspect/ASSETS.md`, `reports/Game store screenshot analysis tools.md`.
Companion: `docs/product-proposal-v1.md`.

## 0. Bottom line

- The deliverable is a **reusable, config-driven, game-agnostic tool**, and Rogue Legend is its first config. New games or competitor sets need no code changes.
- **Hybrid runtime:**
  - a deterministic TypeScript CLI does all the data work and makes the narrow LLM calls itself through a pluggable provider interface;
  - Claude Code project commands are the operator UX: run, checkpoints, Artifact publish, feedback import.
  - Agents never analyse screenshots by hand.
- The **local project folder is the source of truth**: full-res and optimised images, content-addressed JSON, immutable run manifests, and offline markdown reports. The claude.ai Artifact is a published view generated from that data. If the Artifact tools are unavailable, the tool runs local-only (F1).
- LLM surface: **5 narrow steps** (analyse, review-image, translate, recommend, review-recs). Each is Zod-validated, semantically validated, cached by full input hash and budget-capped.
- Reuse first (§2). Custom code covers only glue, band measurement, the taxonomy, correspondence and consensus, and the recommendation.

## 1. Runtime: hybrid

| Option | Verdict |
|---|---|
| A: Claude Code skills/subagents do the AI steps | Rejected for bulk analysis. About 1,300 images would bring context bloat, no per-call validation or retry, no content-hash cache, and runs that can't be reproduced outside a session |
| B: the CLI shells out to `claude -p` / `codex exec` | **Adopted for all AI steps** |
| **Hybrid (chosen)** | B for compute. Claude Code commands for orchestration and for what only a Claude Code session can do: publishing the Artifact and reading its db and comments |

Commands (`.claude/commands/`):
- `/analyze <config>`: runs stages via `npm run pipeline` and stops at checkpoints.
- `/publish-report <runId>`
- `/import-feedback <runId>`
- `/review <target>`

**F1 gate (M0):** `npm run doctor` plus a `/publish-report --probe` checks that the host session exposes Artifact, ArtifactData and ArtifactComments. It also checks that a probe page can be published privately and opened as the owner, and that asset upload, a db write/read and comment reading work.
- If any check fails: **local-only mode.** Markdown reports plus a static `site/<runId>/` that opens offline from disk (same generator, capabilities disabled). Feedback then comes from a local `feedback.json` template.
- The required setup is documented in the README: a logged-in `claude` and `codex` CLI, and a claude.ai account with Artifacts.

## 2. Build vs reuse (licenses checked on npm/GitHub 2026-09-26)

Distribution is an internal/private repo, not redistributed.

| Component | Chosen | License | Obligations | Use | Reason / alternatives |
|---|---|---|---|---|---|
| Play ingest (details, charts, search) | **facundoolano/google-play-scraper** 10.1.3 | MIT | Keep the notice | npm dep behind a `StoreSource` adapter | Proven in the spike. Fallback: **@mradex77/google-play-scraper** 1.3.0 (MIT, Zod-typed, daily contract tests) |
| AppStoreCat | Rejected (pattern reference) | MIT | — | — | Its Android part is a Python wrapper around a *different* scraper (`gplay-scraper`), so it would add a second runtime and a 5-service monorepo for a capability we already have. It has been stale since 2026-05 |
| appreply-co/mcp-appstore | Rejected as a pipeline dependency; optional for ad-hoc exploration in Claude Code | MIT | Keep the notice if used | Optional `.mcp.json` | It wraps the same `google-play-scraper`, at an older version (v9) and without screenshot dedup or `=s0`, so it adds nothing for a CLI. MCP is useful only for interactive exploration |
| Stora (closed SaaS) | Pattern reference | Proprietary | None (idea only) | — | Borrowed pattern: one vision call per image → a Zod-structured label with evidence |
| hypersocialinc/shots | Pattern reference | **None** (all rights reserved) | Copy no code or prompt text | Read only | |
| furkancingoz/aso-skill | Pattern reference | NOASSERTION | Copy nothing | Read only | |
| LeeHueeng/store-screenshots, ParthJadhav/app-store-screenshots | **Future** (V2 rendering) | MIT | Keep the notice | — | V1 has no image generation |
| Image resize/encode/pixels | **sharp** 0.35 | Apache-2.0 | Keep NOTICE/license | npm | |
| Perceptual hash | **sharp-phash** 2.2 | MIT | Keep the notice | npm (vendor if it breaks) | Built on sharp. Alt: `imghash` (MIT); `blockhash-core` is stale |
| Palette | **colorthief** 3.5 | MIT | Keep the notice | npm | `node-vibrant`'s GitHub repo has no license file |
| Text language detection (F6) | **franc-min** 6.2 + Unicode-script check | MIT | Keep the notice | npm | Deterministic language of the text the LLM read |
| Band measurement | **Custom** | — | — | — | No library exists for this (limited scope, §3/F11) |
| PSD text/layers | **psd-tools** (Python) | MIT | Keep the notice | Reuse our spike script `psd_dump2.py` → JSON | Proven on this PSD. Alt: `ag-psd` (npm MIT, TS) |
| OCR | **None in V1**; `tesseract.js` (Apache-2.0) as an M2 experiment | — | — | — | VLM 70.9% vs PaddleOCR 51.6% on game text (research). Adopt only if it wins on pilot band crops |
| Schemas | **zod** 4 (`z.toJSONSchema`) | MIT | Keep the notice | npm | Instructor is Python-only |
| Concurrency | **p-limit** | MIT | Keep the notice | npm | |
| Qwen3-VL / Grounded-SAM-2 / OmniParser | Rejected for V1 | Apache / Apache / partly AGPL | — | — | Qwen3-VL needs a GPU and has a non-square bbox bug. SAM2 is only for cut-outs. OmniParser handles GUI clickables, not marketing layers, and has AGPL parts |
| Taxonomy, correspondence, consensus, recommendation | **Custom** | — | — | — | The novel part |

## 3. What's deterministic vs AI, and why

| Concern | How | Why |
|---|---|---|
| Resolve IDs | D: `search()` + `app()`, ranked → `resolved.lock.json` for the user to confirm | Ambiguity goes to a human |
| Charts, ingest, listing order | D | Order = store array index after base-URL dedup (PILLARS) |
| **Identity/dedup (F6)** | D: Google image id → sha256. Only exact identity reuses an analysis. pHash only *proposes* variant links and never merges | Text-only variants must not merge |
| **Localization status (F6)** | D, from the language of the text L1 read (franc-min + Unicode script) vs the target language: `localized` / `baseline_language` / `mixed` / `text_free` / `unknown` / `unavailable`. "Identical to baseline image" is a separate flag | Equal images are not the same thing as unlocalized |
| **Cross-locale correspondence (F7)** | D: per app, exact identity → pHash variant (distance ≤ θ₁ = matched; θ₁–θ₂ = `uncertain`) → otherwise `unmatched`. `uncertain` pairs go to verification: a cross-family pair check in the L2 review queue, or the user in the site. They are not used for translation until they are confirmed. Position is **never** used for alignment | Publishers reorder and replace scenes |
| **Device class (F3)** | D: `phone` / `tablet` / `unknown` + confidence, from aspect ratio. **Every screenshot is kept.** The class is verified against the live page at M1 | Not proven that images beyond the 8th are tablet shots |
| **Measurements (F11)** | D, limited to validated cases: solid or near-solid horizontal/diagonal bands (height %, mean hex, angle) and the global palette. Each value carries `method`, `confidence`, or `unknown`. Ribbons, gradients, bubbles and opacity are **not** measured. S4 does a first pass (global palette, simple bands); **S6b** does a second pass after L1 that measures pixels only inside the band and text regions L1 named | Flattened pixels can't recover layer colour or opacity |
| Consensus counts (§4.1), weights, run diffs, reports, HTML | D | Arithmetic and templates |
| **L1 analyse-image** | Sonnet vision | Judgement (e.g. pets vs gacha) and reading stylized multi-script display text, where OCR fails |
| **L2 review-image** | Other-family model, blind (F14) | Cross-family check |
| **L3 translate** | Haiku per matched pair set (gloss, genre terms); Sonnet per locale (lingo synthesis) | Meaning-level comparison. Pairing is deterministic (F7) |
| **L4 recommend** | Opus per locale + 1 cross-locale | Interpretation of the deterministic statistics |
| **L5 review-recs** | Other-family model | Cross-family review |

**Semantic validation (F13)** runs after Zod on every LLM output:
- evidence imageIds exist in the run manifest and match the stated app, locale and position;
- positions are 1..N and unique;
- locale and screen type are in config and the taxonomy.

A failure triggers a repair retry and then the `failed` status.

**Analysis status (F13):** `ok` / `failed` / `disputed` (L2 disagreement, unresolved) / `adjudicated` / `overridden`.
- Statistics use `ok`, `adjudicated` and `overridden`; `failed` and `disputed` are excluded and counted as coverage loss.
- Completeness threshold (config, default 90% usable images in the included decks per market): below it, that locale's recommendations are marked `incomplete`, and the report and site show a banner. `--strict` blocks publishing.

**Budget (F10):**
- Config `budget: { maxUsdPerRun, maxCallsPerStep: {…} }`. Each `claude -p` call also gets `--max-budget-usd`.
- **Preflight estimate before every run:**
  - uncached items × unit cost × (1 + an assumed 10% retry rate);
  - plus review at the worst-case escalation (50% in escalated strata);
  - plus adjudication at 1 Opus call per 10 disputes;
  - plus glossary review;
  - plus the M2 pilot's own cost (~150 L1 + ~150 L2 at 100% review + retries ≈ $5–10 + Codex), counted separately and logged against the pilot run.
- The run stops resumably when a ceiling is hit.

Unit costs are **assumptions** until the M2 pilot measures them. One Haiku vision call was measured on 2026-09-26: $0.008 with the minimal flags vs $0.08 without them.

| Step | First run (est.) | Incremental | Assumed unit cost |
|---|---|---|---|
| L1 Sonnet | ~1,300 + ~10% retries | new or changed inputs only | $0.03–0.05 |
| L2 other family | ~300 at 20%; up to ~650 worst case | same policy | subscription (Codex) |
| Adjudication (Opus) | ~30 | as needed | ~$0.3 |
| L3 Haiku / Sonnet | ~180 / ~10 | changed pairs | <$0.01 / ~$0.05 |
| L4 Opus + L5 | 10 + 1–2 | when inputs change | ~$0.5–1 |
| **Total** | **≈ $60–100 + Codex** | ≈ $5–25 | |

**Providers (F14)** (`src/llm/providers/`):
- Each provider declares `{ family: "anthropic" | "openai", resolvedModel, capabilities: { vision, jsonSchema } }`.
- The config validator **rejects a reviewer of the same family as the producer**.
- `npm run doctor` makes a tiny structured vision call per configured provider (smoke test).

| Provider | Mechanism |
|---|---|
| `claude-cli` (default producer) | `claude -p --model <m> --setting-sources "" --disable-slash-commands --strict-mcp-config --system-prompt-file <p> --tools Read --allowedTools Read --output-format json --json-schema <s> --max-budget-usd <x> "<image path + hints>"` → `structured_output` |
| `codex-cli` (default reviewer) | `codex exec -m <model> -s read-only --skip-git-repo-check --ephemeral -i <img> --output-schema <strict.json> -o <out> -` with the prompt on stdin |
| `anthropic-api` / `openai-api` | Interface only in V1 |

**Codex gotchas (observed 2026-09-26):**
1. Always pass an explicit `-m`. The user's `~/.codex/config.toml` default `gpt-5.3-codex` is rejected on a ChatGPT account. `gpt-6-astra` works.
2. On Windows the read-only sandbox blocked the model's file reads. **Inline all text inputs in the prompt (stdin)** and pass images via `-i`. Never rely on the model reading the repo.

**Cache (F4).** Every step declares its inputs. `inputHash = sha256(canonical JSON of {step, stepVersion, promptVer, schemaVer, taxonomyVer, preprocessingVer, resolvedModel, relevant config slice, override revision for the item, hashes of upstream outputs, image sha256 where relevant})`.
- Outputs are stored at `data/objects/<step>/<inputHash>.json` and never overwritten.
- Upstream output hashes are inputs, so any upstream change invalidates downstream steps automatically. The step DAG lives in `src/pipeline/dag.ts`.

## 4. Pipeline stages (`npm run <stage> -- --config <file> [--run <id>]`)

| # | Stage | D/L | Output |
|---|---|---|---|
| S0 | `resolve` | D | `configs/<name>.resolved.lock.json` (category = our `genreId` unless overridden) |
| S1 | `charts` | D | chart objects + `chart_pool` (deduped, rank, countries) |
| S2 | `ingest` | D | Raw payload objects; `data/images/orig/<sha256>.<ext>` (`=s0`); `unavailable` on 404; ≤2 concurrent with jitter. Screenshots only (feature graphic and video are future) |
| S2b | `ingest-local` (F12) | D | Own local rasters (all 11 files) → the same image store, as deck `own:local`, with the documented mapping (incl. the misnamed `battle_regular_w_marketing` = level_up) and the unmatched files listed |
| S3 | `identity` | D | Image objects (sha256, pHash, deviceClass); decks (app × locale → ordered imageIds) |
| S4 | `measure` | D | Measurement objects (F11 scope) |
| S5 | `optimise` | D | `images/web/<id>_t.webp` 240w, `_m.webp` 720w; `images/llm/<id>.png` (long edge ≤1568) |
| S6 | `analyse` | L1 | Analysis objects (status per F13) |
| S6b | `measure-regions` | D | Second measurement pass inside the regions L1 named (F11) → region measurement objects; hex values merged into the analysis view |
| S7 | `review` | L2 | Review objects, disputes, adjudications; verification of `uncertain` correspondence pairs |
| S8 | `correspond` | D | Cross-locale correspondence (F7), localization status (F6) |
| S9 | `aggregate` | D | Slot statistics per §4.1 |
| S10 | `translate` | L3 | Glossary objects |
| S11 | `own` | D | PSD JSON (psd-tools); mapping of the live `own` deck to `own:local` |
| S12 | `recommend` | L4 | Recommendation objects (+ semantic validation) |
| S13 | `review-recs` | L5 | Review markdown |
| S14 | `report` | D | Markdown + JSON (§6) |
| S15 | `site` | D | `site/<runId>/` + publish plan (§6, F2) |
| — | `diff-runs`, `apply-feedback`, `doctor` | D | |

- Own assets (the live deck via S2 and the local files via S2b) pass through S3–S7 like any competitor (F12).
- **Run manifest (F5):** `runs/<runId>/manifest.json` is immutable. It records the config hash, lockfile, override revision, and every object hash per stage and item. Objects are never deleted while a manifest references them, so any past report can be regenerated exactly.

### 4.1 Consensus definition (F8)

- **Observation unit:** one deck = (appId, market `gl`), screenshots in store order, positions 1..P (P = deck length; all device classes kept, and statistics are also reported for phone+unknown only).
- **Pool per market:**
  - named competitors in every market where the listing is available. **Our own game is excluded from the consensus pool**; it is only the comparison subject (`vsCurrent`);
  - chart games only in the markets where they chart.
  - An app in both pools counts once, at its highest tier weight. US is the baseline and is reported separately, not mixed into Asian markets.
- **PH (two `hl`):** the deck in the market's report language (`en`) is the observation. `fil` is used only for translation, and only if it differs.
- **Exclusions:** unavailable listings; images with status `failed` or `disputed`. Both are reported as coverage.
- **N** = the `positions` config value (default 8). Statistics cover positions 1..N.
- **Per slot k (1..N):**
  - n_k = the number of decks with a usable image at k (the denominator);
  - raw counts per screen type;
  - weighted share = Σ w_app·[type] / Σ w_app over those decks.
- **Per deck, position-agnostic:** the share of decks containing the type anywhere in positions 1..N, and the median first position. The denominator is the decks with at least one usable image in 1..N.
- **Always reported:** n, raw counts and weighted % for **named-only** and **all-pool** separately.
- `tests/fixtures/consensus/` covers: unequal deck lengths, unavailable, an overlapping app, PH dual language, excluded images and ties.

## 5. Config (game-agnostic)

```jsonc
{ "ourApp": "com.pockethaven.roguelegend", "category": "auto",
  "competitors": [ { "id": "com.habby.capybara", "tier": "direct" }, { "name": "Mini Tales", "tier": "direct" }, "…" ],
  "charts": [ { "collection": "GROSSING", "depth": 10, "tier": "chart" } ],
  "markets": [ { "gl": "us", "hl": ["en"], "baseline": true }, { "gl": "jp", "hl": ["ja"] }, { "gl": "kr", "hl": ["ko"] },
    { "gl": "tw", "hl": ["zh-TW"] }, { "gl": "hk", "hl": ["zh-TW"] }, { "gl": "th", "hl": ["th"] }, { "gl": "vn", "hl": ["vi"] },
    { "gl": "id", "hl": ["id"] }, { "gl": "ph", "hl": ["en", "fil"], "reportHl": "en" } ],
  "chartGameLocales": "charting+baseline", "tierWeights": { "direct": 3, "same_audience": 2, "reference": 1, "chart": 1 },
  "taxonomy": "taxonomies/mobile-rpg.v1.json", "ownAssets": { "dir": "rogue-legends_current", "psd": "_APPLE STORE.psd" },
  "positions": 8,                         // recommended slots; independent of source deck length (F3)
  "providers": { "analyse": "claude-cli:sonnet", "review": "codex-cli:gpt-6-astra", "translateGloss": "claude-cli:haiku",
                 "translateLocale": "claude-cli:sonnet", "recommend": "claude-cli:opus", "adjudicate": "claude-cli:opus" },
  "review": { "sampleRate": 0.2, "confidenceBelow": 0.7, "escalateIfDisagreeAbove": 0.15, "escalatedRate": 0.5 },
  "completeness": { "minUsableShare": 0.9, "strict": false },
  "budget": { "maxUsdPerRun": 120, "maxCallsPerStep": { "analyse": 2000, "review": 800, "recommend": 20 } } }
```

All Rogue Legend competitors are resolved and confirmed (incl. Survivor.io `com.dxx.firenow` and BagMaster Isekai `com.DoorTeam.BagMaster`).

## 6. Taxonomy, schemas, outputs, feedback

**Screen types (DRAFT, in the taxonomy file):**
- `key_art`: title_logo, character_showcase, collage, cg_scene
- `gameplay`: battle, boss, victory, defeat, skill_select, board_dice, backpack_merge, idle_auto, pvp_battle, dungeon_run
- `metagame`: progression, characters, character_detail, gear, pets, skills_talents, base_town, gacha_summon, idle_rewards
- `map_world`: world_map, stage_select
- `social`: guild, arena_leaderboard, coop, chat
- `events_rewards`: event, login_rewards, battle_pass
- `iap`: shop, offer
- `promo`: feature_callout, social_proof, collab_ip, update_news
- `other` (a note is required)

**Marketing-layer vocabulary (DRAFT):**
- Composition: full_bleed_capture, capture_in_device_frame, capture_inset_on_art_bg, multi_capture_split, panorama_continuous, collage, pure_art, raw_capture_no_layer.
- Band: type solid_bar / gradient_fade / diagonal_slash / ribbon_banner / brush_torn / shaped_panel / speech_bubble, plus position, size, colour name, and measured hex or unknown (F11).
- Text: role headline / subheadline / feature_label / callout_bubble / badge_text / logo_wordmark / cta / legal, plus exact text, style, fill, stroke and size.
- Callout: hero / enemy_boss / pet / item_gear / currency / mascot; cutout_overlay vs in_capture; identity, placement, scale, breaksFrame.
- Decorations: badges, frame_border, arrow_pointer, vfx_sparkle, zoom_inset, logo.
- Relation to the screen, plus occlusion %.

**Schemas (Zod; enums built from the taxonomy):**
- `ImageAnalysis`: `{ imageId, inputHash, status, screenType, secondaryType|null, captureDescription, composition, bands[], texts[], callouts[], decorations[], relationToScreen, occlusionPct, hasMarketingLayer, isRealCapture, confidence{screenType,text,overall}, notes }`.
- `Recommendation`: `{ recId, runId, locale, position, capture{screenType,instruction,sourceHint}, marketingLayer{…, texts[+enGloss]}, translationNotes[], evidence[{appId,locale,position,imageId}], vsCurrent{currentImageId|null, verdict: keep|modify|replace|new, diff}, confidence, completeness: complete|incomplete }`.
- `slotStats` is rendered from §4.1 data, never written by the LLM.

Example:
- ja-JP #1: capture `gameplay:boss`, "boss vs two-headed ogre, mid-cast max VFX, HP ~40%".
- Layer: full-bleed; bottom diagonal_slash 22%, measured `#B3122E`; headline "ボスを倒せ！" (gloss "Defeat the boss!"), outlined; oversized enemy_boss cut-out breaking the frame.
- vsCurrent: modify, because "our slot 1 is skill_select with an English headline; JP decks with Japanese text 9/11 (n=11)".

**Local outputs (source of truth; relative image paths, offline):**
- `reports/<runId>/index.md`
- `recommendations/<locale>.md|json`
- `decks/<appId>.md` (every locale, listing order, thumbnails linking to full-res originals, analyses)
- `locales/<locale>.md`
- `own.md`

**Completeness check (F12):** S14/S15 fail if any image in the run manifest (competitor, own-live or own-local) is missing from the reports and site, or appears without its analysis or failure status.

**Artifact site (deterministic generator):**
- Tabs:
  1. Recommendations per locale, current vs recommended.
  2. Deck grids in listing order with click-through analysis.
  3. Locale comparison aligned by **correspondence**, not position, with unmatched images shown separately.
  4. Statistics (n, raw, weighted) and glossary.
  5. Run info and diff.
- Capabilities: `db` + `user` + `comments {composer_only}` + `assets`.

**Hosting and limits (F2):**

| Item | Packing | Files | Size |
|---|---|---|---|
| Thumbnails 240w | One **grid sprite sheet per app** (all locales; ≤16,383 px per side, the WebP maximum; split into 2 sheets if exceeded) | ~80–100 | ~26 MB |
| Display 720w | Asset store (25 per upload call; ids in `site/<runId>/assets.json`) | 0 site files | ~120 MB |
| Display fallback (asset store unavailable or quota too small) | One 720w grid sheet per app (split as needed) | ~100–130 | ~120 MB |
| HTML + data JSON (per locale and app, ≤2 MB each) | files | ~40 | <10 MB |
| **Totals** | primary ≈ 140 files; fallback ≈ 270 files | | |

- **Publish plan (preflight, F2):** the `site` stage emits `publish-plan.json`, which splits the files into publishes of ≤255 files and ≤64 MB each and asserts ≤511 files and ≤256 MB per version, HTML ≤16 MB, and each asset ≤20 MiB.
- It **fails** if any limit would be exceeded. Update semantics (files persist across publishes to the same URL) are verified by the M0/M1 probe.
- Full-res originals stay local only.

**Feedback (F9):**
- Item ids are revision-scoped: `rec__<runId>__<locale>__<pos>__<recHash8>`, `img__<imageId>__<analysisHash8>`.
- A db doc holds `{verdict: approve|reject|unsure, correction?: {field, value}, note, by, at}`.
- `/import-feedback` → `data/feedback/<runId>.json` → `apply-feedback` → an append-only `overrides/overrides.jsonl` of typed entries, `{id, rev, kind: screenType|text|exclude|recVerdict|adjudication, target, value, source, at}`.
- Overrides are inputs to the input hash (F4), so a text correction invalidates translate → recommend for the affected items only.
- Conflicting overrides for the same target become `unresolved`. They are not applied and are listed in the next run's index for the user.

**Future (not V1):** feature graphic and video; App Store; rendering via the MIT generators.

## 7. Repo layout

```
configs/  taxonomies/  prompts/ (<step>.v<N>.md)  overrides/ (overrides.jsonl)
src/ cli.ts · pipeline/{dag,manifest,hash}.ts · stages/*.ts · schemas/*.ts · validate/semantic.ts
     llm/{provider,cache,budget}.ts · llm/providers/{claude-cli,codex-cli}.ts · store/{source,gplay}.ts
     img/{phash,palette,bands,optimise,sprite}.ts · lang/detect.ts · report/{md,site,publish-plan}/*.ts
site-src/   tools/psd/ (psd_dump.py, requirements.txt)   .claude/commands/ (analyze, publish-report, import-feedback, review)
data/ images/{orig,web,llm}/ · objects/<step>/<inputHash>.json · feedback/
runs/<runId>/manifest.json   reports/<runId>/   site/<runId>/   docs/   memory/   tests/ (vitest + fixtures)
```

- Node 22, TS strict, Biome, `tsx`, Vitest. Every file stays at or under 300 lines. Git init at M0 with conventional commits.
- Git tracks code, configs, taxonomies, prompts, overrides, run manifests, reports and docs.
- `data/images`, raw payload objects and `site/` are gitignored (size, copyright) but kept on disk in the project. `rogue-legends_current/` stays read-only.

## 8. Milestones and volume

| M | Scope | User checkpoint |
|---|---|---|
| M0 | Scaffold, config/resolve, taxonomy, schemas, prompts v1, providers, `doctor`; **F1 Artifact-capability probe** (publish, asset, db, comments, multi-publish semantics); Codex review of prompts and schemas | Approve the proposal and taxonomy; learn whether the Artifact works or the tool falls back to local-only |
| M1 | S0–S5, S2b, deck markdown, raw deck-grid site. Probes: HK/PH charts, zh-HK, asset quota, device class vs the live page | Browse the decks; prune chart games |
| M2 | Pilot S6–S8 on ours + Capybara Go + Legend of Mushroom, all locales (~150 images), 100% review, Haiku vs Sonnet, tesseract.js test, **unit costs measured** | Rate accuracy; taxonomy frozen |
| M3 | Full S6–S11 with the budget preflight | Spot-check disputes |
| M4 | S12–S15, final report + site | Rate; import feedback → next run |

Volume: about 2,300 screenshot slots → **~1,100–1,500 unique images** (named ~450, chart ~750).

## 9. Cross-family review policy

| Target | Coverage |
|---|---|
| Plan, prompts/schemas, code per milestone | 100% by the other family (Codex, per the gotchas in §3) |
| L1 per image | Pilot 100%. Then 20% stratified (tier × market × script) + confidence < 0.7 + repairs; a stratum escalates to 50% if disagreement > 15% |
| Glossary, recommendations | 100% |

- Disputes are adjudicated: text by Opus with both readings, taxonomy by the user. Every adjudication is stored as an override (F9).
- The reviewer family must differ from the producer family, enforced in config (F14).

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Asia RPG top-grossing is MMO/gacha, not our audience | Tier weights; named-only vs all-pool statistics; prune at M1 |
| R2 | `list()` is fragile; HK/PH untested | M1 probe; cached per run; manual list fallback |
| R3 | Device class uncertain (F3) | Keep all; confidence; verify at M1 |
| R4 | Text-only variants (F6) | Exact identity only for reuse; pHash only proposes links |
| R5 | Subscription quota and throughput | Budget preflight, ceilings, resumable runs |
| R6 | OCR errors on stylized Thai/VN/CJK | Cross-family review, confidence gating, M2 check |
| R7 | Play ToS / copyright | Private org-internal Artifact; images gitignored |
| R8 | "Most common" ≠ "converts best" | A/B framing; n and statistics shown with each recommendation |
| R9 | Own assets are inconsistent (7 live vs 5 local marketed; PSD lacks pets; misnamed file) | S2b mapping; live = current |
| R10 | Artifact tools or quota unavailable (F1/F2) | M0 probe; local-only mode; sprite fallback |

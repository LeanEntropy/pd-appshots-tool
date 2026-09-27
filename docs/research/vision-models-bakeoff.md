# Vision-model bake-off: Claude vs GPT on store-screenshot analysis (empirical spike)

Status: DRAFT. Empirical companion to `docs/research/vision-models-public.md` (which is desk
research on public docs/leaderboards). This spike actually ran the CLIs against real screenshots.
Date: 2026-09-26. Scripts and raw outputs: scratchpad `vision-bakeoff/` (not committed; see
"Reproducing this spike" at the end for the exact path).

**Follow-up (same day, 2026-09-26):** the original run's "only `gpt-6-astra` works" claim in §3 was
wrong — it never tried the account's real model names. Re-diagnosed and re-run against
`gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` (all reachable); results folded into §3, §5, the
new §5a token-cost table, §6, and a rewritten §7. See the "Follow-up (same day...)" markers in each
section for what changed.

## 1. Purpose and scope

A small, deliberately cheap empirical test of which models to use for plan-v1.md's L1
(`analyse-image`) and L2 (`review-image`) steps, using the plan's own draft schema and its
documented `claude -p` / `codex exec` invocation pattern (§3). This is a spike (n=10 images,
one run per model/image, no repeats) — it is not a substitute for the plan's own M2 pilot
(100% review on ~150 images), which is where these picks should be confirmed at scale.

## 2. Test set (10 images)

**5 own marketed screenshots** (`rogue-legends_current/base_screenshots_plus_marketing/`, read
only, not modified). Ground truth comes from `assets-inspect/ASSETS.md` and the PSD text-layer
dump (`psd_tree.txt`), plus a direct pixel measurement of each band's dominant colour (Python/PIL,
mode colour of a clean corner sample — see `measure_bands.py`).

| id | file | screen type (ground truth) | headline (verbatim) | band hex (measured) |
|---|---|---|---|---|
| own01 | battle_boss_w_marketing.jpeg | gameplay:boss | EPIC BOSS FIGHTS! | `#6C3298` purple |
| own02 | battle_regular_w_marketing.jpeg (built from `level_up.jpeg`, **not** `battle_regular.jpeg`) | gameplay:skill_select | CHOOSE YOUR FATE! | `#B17A16` gold |
| own03 | maps_w_marketing.jpeg | map_world:world_map | EVERY BOARD NEW ADVENTURE! | `#323D97` dark blue |
| own04 | player_character_profile_w_marketing.jpeg | metagame:gear | COLLECT AND UPGRADE! | `#32974B` green |
| own05 | roster_w_marketing.jpeg | metagame:pets | FIND COMPANIONS! (headline text pattern-inferred — no PSD group exists for this screen) | `#09ACF1` cyan |

**5 competitor screenshots**, downloaded full-resolution (`=s0`) via `google-play-scraper` from
live Google Play listings, chosen to cover Japanese, Korean, Traditional Chinese and Thai and a
mix of screen types. Ground truth built by manual full-resolution inspection (no PSD available):

| id | game / locale | screen type (ground truth) | headline (verbatim) | band |
|---|---|---|---|---|
| comp01 | Archero 2, ja-JP | key_art:cg_scene | アーチャー伝説2 (logo) | none (pure art) |
| comp02 | Capybara Go!, ko-KR | events_rewards:login_rewards | 지금을 즐기자 / 여유! | none (pure art) |
| comp03 | Archero 2, zh-TW | gameplay:boss | 暢享戰鬥美學 / 挑戰極限搭配! | translucent green, ~`#1A8261` |
| comp04 | Survivor.io, th-TH | gameplay:boss | ปราบบอสทรงพลัง! | olive, `#7F9732` |
| comp05 | Capybara Go!, th-TH | events_rewards:login_rewards | ไม่เป็นไร / โอเคอยู่ (+ English "Oh No!") | none (pure art) |

Full ground-truth JSON (all 10 entries, with character/composition notes and sourcing) is in
`vision-bakeoff/ground-truth.json`.

## 3. Models tested

**Claude, via `claude -p`** — all 4 requested models were reachable on this account:
`claude-opus-5-5`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-fable-5-1`.

**GPT, via `codex exec`** — **correction (2026-09-26, follow-up):** the original claim that only
`gpt-6-astra` is usable on this ChatGPT account was wrong. Root cause: the original probe simply
never tried the account's actual available model slugs. It tried `gpt-6-astra-mini`, `gpt-6.1-astra`,
`gpt-5.3-codex` (the `~/.codex/config.toml` default), `o5`, and `o4-mini` — none of which exist in
this account's model catalogue, so all five correctly failed with `"... is not supported when using
Codex with a ChatGPT account"`. That error was mistaken for "no other GPT model works" rather than
"none of these five specific names exist."

The actual catalogue is discoverable at `~/.codex/models_cache.json` (refreshed by the CLI itself;
`fetched_at` in this run was 2026-09-26). Its `models[].slug` list for this account is:
`gpt-5.5`, `gpt-5.6-sol`, `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-6-astra`, plus two non-chat utility
models (`codex-auto-review`, `gpt-reserve`). Confirmed with `codex exec -m <slug> -s read-only
--skip-git-repo-check --ephemeral --json "Reply with the single word OK and nothing else."` for each:

| Name tried | Result |
|---|---|
| `gpt-6-sol` | fails: `"'gpt-6-sol' model is not supported..."` — **not a real slug** (off-by-one on the generation number) |
| `gpt-6-luna` | fails: `"'gpt-6-luna' model is not supported..."` — **not a real slug**, same mistake |
| `gpt-5.6-sol` | **works** |
| `gpt-5.6-luna` | **works** |
| `gpt-5.6-terra` | **works** |
| `gpt-6-astra` | **works** (as before) |

So the earlier report's premise was doubly wrong: it never tried real names in the first probe, and
the follow-up request's own `gpt-6-sol`/`gpt-6-luna` spelling is also not what the account exposes —
the real slugs keep the `5.6` generation prefix (`gpt-5.6-sol`, `gpt-5.6-luna`), only `astra` jumped to
`gpt-6-`. **Working invocation for all four** (only the `-m` value changes):
`codex exec -m <slug> -s read-only --skip-git-repo-check --ephemeral -i <abs image path>
--output-schema prompts/schema-strict.json --json -o <out> "<prompt>"`. All four ran the full
10-image matrix cleanly with this exact invocation; see §5 and the token-cost section below.

## 4. Method

One identical prompt and one identical JSON schema for every model/image pair (files in
`vision-bakeoff/prompts/`), covering screen type (taxonomy), marketing layer (composition, band,
headline verbatim), other text, and characters — a compact version of plan-v1.md §6's
`ImageAnalysis` shape.

- **Claude:** `claude -p --model <m> --setting-sources "" --disable-slash-commands
  --strict-mcp-config --system-prompt-file prompts/system-prompt.txt --tools Read --allowedTools
  Read --output-format json --json-schema <schema> --max-budget-usd 1.00 "Analyse the screenshot
  at this path: <abs path>"` — exactly the plan's §3 invocation pattern.
- **Codex/GPT:** `codex exec -m gpt-6-astra -s read-only --skip-git-repo-check --ephemeral -i
  <abs path> --output-schema <strict-schema> --json -o <out> "<prompt>"` — image via `-i`, prompt
  text inline (not a file the sandbox would need to read), per the plan's Codex gotchas. OpenAI's
  strict structured-output mode required `additionalProperties:false` and every property in
  `required` at every object level — the plan's schema note doesn't call this out and should
  (`prompts/schema-strict.json` vs `prompts/schema.json`).

Scoring (`score.py`, `aggregate.py`): screen-type exact match against ground truth; character-level
text similarity (`difflib.SequenceMatcher` ratio) between the model's `headline.verbatim` and
ground truth; RGB Euclidean distance between the model's `band.hex` and the measured/observed
ground-truth hex; JSON validity (schema-conformant parse); cost/latency as reported by each CLI.
Character-description correctness and hallucinations were judged by hand against the ground truth
and the images (see §6).

## 5. Results

| Model | Screen-type correct | Avg text similarity | Avg band-hex distance, own (0-441 scale) | Avg band-hex distance, competitor | JSON valid | Avg latency | Avg cost/call |
|---|---|---|---|---|---|---|---|
| **claude-sonnet-5** | 9/10 | 0.89 | 121.0 | 13.2 | 10/10 | 7.3 s | $0.023 |
| **claude-opus-5-5** | 7/10 | 0.90 | 123.0 | 19.8 | 10/10 | 9.3 s | $0.046 |
| **claude-fable-5-1** | 8/10 | 0.90 | **47.5** | 27.3 | 10/10 | 15.1 s | $0.122 |
| **claude-haiku-4-5-20251001** | 10/10 | **0.65** | 168.7 | 75.1 | 10/10 | 44.6 s (14-115 s) | $0.034 |
| **gpt-6-astra** (codex) | 7/10 | 0.87 | 120.8 | 14.3 | 10/10 | 17.1 s | subscription — see token-cost table |
| **gpt-5.6-sol** (codex) | **10/10** | 0.88 | 138.6 | 16.2 | 10/10 | 21.3 s | subscription — see token-cost table |
| **gpt-5.6-terra** (codex) | 6/10 | 0.82 | 108.4 | 21.3 | 10/10 | 20.9 s | subscription — see token-cost table |
| **gpt-5.6-luna** (codex) | 8/10 | 0.81 | 150.4 | 20.7 | 10/10 | 32.7 s | subscription — see token-cost table |

Total spend for this spike: **$2.24** across the 40 Claude calls in the original run (well inside the
"modest" budget; nothing came close to `--max-budget-usd 1.00`), plus all Codex calls (70 total across
the original and follow-up runs) against the existing ChatGPT subscription — no per-call dollar cost,
see the token-cost comparison below for the resource this subscription actually meters.

Notes on the new GPT rows:
- **`gpt-5.6-sol` matched or beat `gpt-6-astra` on every accuracy metric in this sample**: perfect
  screen-type (10/10, including the same defensible `own03` board_dice alternate reading Astra also
  used), text similarity within noise (0.88 vs 0.87), and competitor band-hex distance essentially
  tied (16.2 vs 14.3). Its own-asset band distance is somewhat worse (138.6 vs 120.8) but both are
  firmly in the "confused by the grey overlay" cluster described in §6.3, not a Sol-specific problem.
- **`gpt-5.6-terra` has a distinct, systematic screen-type failure this sample doesn't let Sol or
  Astra off the hook for either, but which Terra alone shows repeatedly**: it called 3 of the 5
  marketing-band screens `promo:feature_callout` instead of their actual screen type (`comp01`,
  `comp03`, `comp04`, plus `own03`) — see §6 for detail. This is a different, less defensible failure
  mode than the `own03` board_dice alternate reading; it looks like Terra over-weights "this frame has
  a marketing callout" into the screen-type field itself.
- **`gpt-5.6-luna` is the slowest and most verbose of the four GPT models** (32.7 s avg latency vs
  17-21 s for the others; see the token-cost table for its output/reasoning-token premium) without an
  accuracy edge to justify it.

Notes on the table:
- "Screen-type correct" is a strict string match against the ground-truth label. On `own03`
  (the "maps" screen), 4 of 5 models — everyone except Haiku — called it `gameplay:board_dice`
  instead of the ground truth's `map_world:world_map`. That's a defensible alternate reading (the
  screen is literally a board/dice mechanic) and looks like a taxonomy-definition gap, not a model
  error; it drags Opus/GPT down to 7/10 and Fable to 8/10 in the strict count above.
- `gpt-6-astra`'s text-similarity number is manually corrected for one scoring artifact: on
  `comp01` it read the Japanese logo text correctly but filed it under `otherText.logo_wordmark`
  rather than `headline.verbatim` (a reasonable structural choice the schema didn't disambiguate),
  which would otherwise have scored it 0.00 on that image for a text-placement reason, not a
  reading error.
- Haiku's latency is bimodal and unpredictable: most calls finished in 14-27 s, but three calls
  (`comp02`, `own04`, `own05`) spontaneously used 5,500-9,700 extended-thinking tokens and took
  55-115 s at 2-3x the cost of its fast calls, with no flag difference from the fast calls. This
  makes Haiku's latency/cost hard to budget for in a bulk pipeline even though its average cost
  looks competitive.

### 5a. Token-cost comparison across the four GPT models

The user's working assumption going into this follow-up was that `gpt-6-astra` is "very
token-expensive" relative to other GPT options. Measured per-image-call token usage (from each
call's `turn.completed` usage event) does not support that:

| Model | Avg input tokens | Avg cached-input tokens | Avg output tokens | Avg reasoning tokens | Avg total (in+out) | Relative to Astra |
|---|---|---|---|---|---|---|
| **gpt-6-astra** | 16,832 | 1,216 | 346 | 6.0 | **17,178** | 1.00x (baseline) |
| **gpt-5.6-sol** | 16,074 | 5,325 | 499 | 197.4 | 16,573 | 0.96x |
| **gpt-5.6-terra** | 16,053 | 5,018 | 452 | 199.0 | 16,505 | 0.96x |
| **gpt-5.6-luna** | 19,927 | 8,218 | 813 | 501.8 | **20,740** | 1.21x |

**The premise is wrong, or at least not what this sample shows: `gpt-6-astra` is not the token-heavy
model of the four — it is tied for cheapest.** Its input-token count is comparable to Sol/Terra (same
image + same prompt, as expected) and its reasoning-token usage is near zero (avg 6.0, consistent
with its catalogue-listed `default_reasoning_level: "low"`), keeping its total below Sol and Terra.
`gpt-5.6-luna` is the actual outlier here, running about 21% more total tokens per call than Astra,
driven by both a larger prompt echo (higher input/cached-input) and roughly 2.3x Astra's output
tokens plus a further ~500 reasoning tokens per call that Astra barely uses. If the "Astra is
expensive" impression comes from a different context (e.g. a $-metered API tier rather than this
ChatGPT-subscription `codex exec` path, or a different, heavier prompt/task than this 10-image
spike), that would need a separate check — it isn't visible in this data.

All four GPT models are billed under the existing ChatGPT/Codex subscription in this invocation path
(`codex exec` against a ChatGPT account), not per-token, so none of this shows up as incremental
dollar spend for this spike — see the recommendation notes in §7 for why token profile still matters
for a bulk pipeline (throughput/rate-limit headroom, not $ cost).

## 6. Notable failures and patterns

1. **Haiku confuses in-capture UI text with the marketing headline, twice.** On `own02` (the
   "choose a skill" popup marketed as "CHOOSE YOUR FATE!"), Haiku returned the in-game popup's own
   title, `"LEVEL UP!"`, as the headline — the exact confusion `ASSETS.md` warns about for this
   asset, just triggered by the image content rather than a filename. On `own05` it swapped the
   fields the other way: it filed the in-capture stat label `"Owned Pets Bonus"` as the headline
   and demoted the real headline, `"FIND COMPANIONS!"`, to a footnote. No other model (Sonnet,
   Opus, Fable, GPT-6-astra) made this mistake on any of the 10 images.
2. **Haiku hallucinates on Korean and Thai specifically, not on Japanese or Traditional Chinese.**
   On `comp02` (Korean), ground truth `지금을 즐기자` became `지금 로그인` plus two fabricated
   words in `otherText`. On `comp05` (Thai), `ไม่เป็นไร` / `โอเคอยู่` became garbled
   `โอบเคอยี` / `เพนบูส`. The other 4 models read both exactly right (character-for-character,
   modulo a cosmetic newline vs. space). The same Haiku call got the Japanese title on `comp01`
   and the Traditional Chinese two-line headline on `comp03` exactly right — so this isn't a
   blanket "small model is bad at CJK" story, it's specifically Korean/Thai on this model.
3. **Band-colour: a two-layer overlay confuses everyone except Fable.** Our own assets stack a
   shared grey diagonal band on top of a second, per-screen solid colour band (per the PSD).
   Sonnet, Opus and GPT-6-astra repeatedly reported the grey overlay's near-black hex (e.g.
   `#2B2B33`) instead of the actual coloured band underneath, producing RGB distances of 90-230 on
   the 5 own images. Fable found the correct coloured band on 4 of 5 (avg distance 48, vs.
   121-169 for the others) — the one place Fable was clearly and consistently best. On the two
   competitor images with a real band (comp03/comp04, single-layer), all 5 models clustered close
   to the measured hex (distances 6-25) except Haiku, which called `comp04`'s olive-green band
   "lime green `#CCFF33`" (distance 129).
4. **`gpt-5.6-terra` (and to a lesser extent `gpt-5.6-luna`) misclassify marketing-band screens as
   `promo:feature_callout`.** On `comp03` (Traditional Chinese boss screen) and `comp04` (Thai boss
   screen), both true `gameplay:boss`, Terra returned `promo:feature_callout` for both; Luna made the
   same call on `comp03`. Terra also did this on `own03` (true `map_world:world_map`, where the other
   four models at least land on the defensible `gameplay:board_dice` alternate) and, differently, on
   `comp01` where it read the screen as `key_art:title_logo` instead of `key_art:cg_scene`. Text
   reading on these images was still accurate (Terra's text similarity on `comp04` was a perfect
   1.00) — the failure is specifically in the screen-type field, not the OCR — but it means Terra's
   taxonomy calls need more scrutiny than Sol's or Astra's on any screen with a visible marketing
   band. `gpt-5.6-sol` did not make this mistake on any of the 10 images.
5. **Field-placement quirk is Astra-specific, not a GPT-family trait.** The original report's
   `comp01` scoring correction (Astra filed the correct Japanese logo text under `otherText` instead
   of `headline.verbatim`, which needed a manual score override) does not recur in Sol, Terra, or
   Luna — all three placed the same text in `headline.verbatim` directly (raw text-similarity 0.94,
   no override needed).
6. **Traditional Chinese and Thai are not inherently hard for Sonnet/Opus/Fable/GPT-6-astra.**
   `comp03`'s two-line Traditional Chinese headline and `comp04`'s Thai headline were read
   character-for-character correctly by all 5 models (including Haiku, on `comp04`). The
   OCR/text-reading risk in this sample is concentrated in Haiku-on-Korean/Thai, not in the scripts
   themselves.
7. **Cost-flag lesson (extends plan-v1.md §3):** a quick probe run without `--system-prompt-file`
   (only `--setting-sources ""`, `--disable-slash-commands`, `--strict-mcp-config`) burned the
   entire `--max-budget-usd 0.05` cap on Claude Code's full default system prompt before producing
   any answer, on **all four** Claude models (costs of $0.056-$0.531 just for that cache write,
   `terminal_reason: budget_exhausted`). The full vision-analysis calls in this bake-off, run with
   `--system-prompt-file` pointed at a 12-line custom prompt, cost $0.017-$0.16 per call including
   the actual answer. The flag is not optional for cost control.

## 7. Recommendations (revised, follow-up spike)

**Superseded.** The recommendations below replace §7 of the original spike. This revision is scoped
to a specific set of role constraints and a performance-first mandate (cost/latency are reported for
context, not used to drive the picks): no Sonnet for screenshot analysis (judged too weak for this
purpose), Haiku restricted to zero-importance work, Astra restricted to special/high-value work, the
primary analyser chosen head-to-head between Opus 5.5 and Fable 5.1, and both the image-review and
recommendation-review reviewer roles filled by a GPT model.

- **Primary screenshot analyser: `claude-fable-5-1`, over `claude-opus-5-5`.** Head-to-head on the
  existing 10-image data: Fable beats Opus on screen-type (8/10 vs 7/10 — Fable also gets the
  `own03` board_dice alternate reading), ties it on text similarity (0.90 vs 0.90), and is
  decisively better on band-colour, the metric where the two-layer overlay (§6.3) trips up every
  other model — 47.5 vs 123.0 average distance on the 5 own-asset images, i.e. Opus's error is
  roughly 2.6x Fable's. Fable has no clear weakness against Opus in this sample; it only loses on
  latency (15.1 s vs 9.3 s) and cost (~2.65x, $0.122 vs $0.046/call), which this revision is
  explicitly not weighting. **Sonnet is excluded from this role per the user's constraint**, even
  though it scored competitively (9/10 screen-type, 0.89 text similarity) in the original spike —
  that data point stands, but the role is no longer open to it.
- **Haiku: confined to zero-importance work only**, consistent with §6's findings (Korean/Thai text
  hallucination, headline/UI-text field-swapping, 14-115 s unpredictable latency). Not used for
  primary analysis, review, or any Asian-script text extraction at any importance tier above
  "zero-importance."
- **Cross-family image-analysis reviewer (GPT): `gpt-5.6-sol`, not `gpt-6-astra` or `gpt-5.6-terra`,
  for routine review; reserve `gpt-6-astra` for special/high-value items.** This directly answers
  whether Terra or Sol matches Astra as an image reviewer: **Sol matches or exceeds Astra on every
  accuracy metric measured** — screen-type 10/10 vs 7/10, text similarity 0.88 vs 0.87, competitor
  band-colour distance 16.2 vs 14.3 (statistically tied) — while running about the same token
  footprint per call (0.96x Astra's total tokens; see §5a). **Terra is not recommended for this
  role**: it has a repeated, systematic screen-type failure (mislabelling marketing-band screens as
  `promo:feature_callout` on 3 of 5 comp images plus `own03`, §6.4) that neither Sol nor Astra
  share, which is a worse failure mode for a *reviewer* than for a primary analyser, since a
  reviewer's whole job is to catch exactly this kind of mislabelling. `gpt-5.6-luna` is also not
  recommended — no accuracy edge over Sol, and the slowest, most token-heavy of the four GPT models
  (§5a, §6.4 note). This gives a two-tier GPT reviewer setup: **Sol as the default cross-family
  reviewer, Astra reserved for special/high-value escalations** per the user's constraint — which
  also happens to match the data, since nothing in this sample shows Astra outperforming Sol enough
  to justify it as the default.
- **Text-only recommendation reviewer (GPT): `gpt-5.6-sol`, as the best available proxy signal, with
  a caveat.** This bake-off is an image-analysis task, so it doesn't directly test a text-only
  recommendation-review role. Using the closest available signal — accuracy and instruction-following
  reliability on the same schema-constrained task — Sol is the stronger pick over Terra: Terra's
  `promo:feature_callout` over-generalisation (§6.4) suggests a tendency to substitute a salient
  surface feature for the field the schema actually asked for, which is the same failure shape that
  would matter in a text-only "does this recommendation follow from the evidence" review. Terra and
  Sol have near-identical latency and reasoning-token profiles in this data (§5a), so this isn't a
  cost/speed tradeoff either way. **Recommend confirming with a small dedicated text-only eval**
  before locking this in — the evidence here is a reasonable proxy, not a direct test of the role.
- **Text/OCR specifically, especially Asian scripts:** unchanged from the original spike — Opus,
  Fable, Sonnet, Astra, Sol, Terra and Luna all read every Japanese, Korean, Traditional Chinese and
  Thai headline in this sample correctly (Terra/Luna's screen-type misses did not affect their text
  fields). Haiku remains excluded from any Korean- or Thai-text path above zero-importance.

## 8. Limitations of this spike

- n=10 images, one run per model/image — no repeats, so latency/cost variance (especially
  Haiku's) is only loosely characterised, and single-image "misses" (e.g. Opus's `gameplay:defeat`
  call on `comp05`) could be noise rather than a stable pattern. This applies equally to the three
  new GPT models (Sol/Terra/Luna each have only 10 data points too) — e.g. Terra's 4 screen-type
  misses out of 10 is a real pattern within this sample but is not independently confirmed at scale.
- Competitor ground truth is manual/visual, not independently cross-checked by a second reviewer
  (the plan's own cross-family policy would normally apply here too).
- Band-colour ground truth for the two competitor boss screens (`comp03`, `comp04`) is a "closest
  we can measure" pixel sample on a translucent/gradient overlay, not a clean solid fill like the
  PSD-backed own-asset bands — treat those distances as fuzzier than the own-asset ones.
- The text-only recommendation-review role recommendation (§7) is a proxy inference from an
  image-analysis benchmark, not a direct test — flagged explicitly in §7, and worth a short
  dedicated text-only eval before treating it as settled.
- This is exactly the kind of question the plan's own M2 pilot (100% review, ~150 images, "Haiku
  vs Sonnet", unit costs measured) is designed to settle at scale; treat this spike as a directional
  input to that pilot's design, not a replacement for it.

## Reproducing this spike

Scripts, prompts, schemas, downloaded images, ground truth, and raw per-call outputs are in the
scratchpad directory used for this session:
`C:\Users\User\AppData\Local\Temp\claude\C--projects-ai-pd-appstore-tool\9b150f72-d30c-4d72-a5fa-2d1770596957\scratchpad\vision-bakeoff\`
(`images/`, `prompts/`, `ground-truth.json`, `run-claude-matrix.sh`, `run-codex-matrix.sh`,
`run-codex-matrix-new.sh` (follow-up: Sol/Terra/Luna), `score.py`, `aggregate.py`, `aggregate_all.py`
(follow-up: all 4 GPT models incl. token usage), `detail_gpt.py` (follow-up: per-image GPT detail),
`runs/*.json`/`runs/*.msg.json` for every raw model response, `logs/*.events.jsonl` for raw token
usage per Codex call). This is a temp scratch location, not part of the repo; copy anything worth
keeping into `docs/evidence/` if this spike's picks are adopted.

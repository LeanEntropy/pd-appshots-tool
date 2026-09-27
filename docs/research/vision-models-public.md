# Vision / Image-Analysis Capabilities of Current Claude & GPT Models (as of 2026-09-26)

Purpose: pick models for analysing mobile game store screenshots — screen-type classification,
exact stylised game-font text extraction (incl. CJK, Thai, Vietnamese), marketing-overlay
description (bands, colours, character art, composition), and optional bounding boxes.

All claims below are sourced from official docs, model cards, and third-party leaderboards
found via web search on 2026-09-26. Anything not directly verifiable is flagged **[UNVERIFIED]**.

---

## 1. Model roster covered

### Anthropic (via `claude-api` skill cache + platform.claude.com docs)

| Model | ID | Context | Input/Output $ per MTok | Resolution tier |
|---|---|---|---|---|
| Claude Fable 5.1 | `claude-fable-5-1` | 1M | $10 / $50 | High-resolution |
| Claude Opus 5.5 | `claude-opus-5-5` | 1M | $4 / $20 | High-resolution |
| Claude Sonnet 5 | `claude-sonnet-5` | 1M | $2 / $10 | High-resolution |
| Claude Haiku 4.5 | `claude-haiku-4-5` | 200K | $1 / $5 | Standard |

Resolution tier per Anthropic's vision docs: "High-resolution: Claude 4.7 and later models… Standard:
all other models." Fable 5.1, Opus 5.5 and Sonnet 5 all post-date 4.7 → high-resolution tier.
Haiku 4.5 pre-dates the 4.6/4.7 generation → standard tier. This is an inference from the
documented rule, not a per-model line item in the docs — flagged **[INFERRED, high confidence]**.

### OpenAI, via Codex CLI

`codex --help` / `codex doctor` on this machine show: CLI accepts any model string via `-m` /
`--model` (no fixed enum — validity is checked server-side). The account's `~/.codex/config.toml`
had `model = "gpt-5.3-codex"`, with a recorded migration note `"gpt-5.2-codex" -> "gpt-5.3-codex"`.
Per OpenAI's own model docs (`learn.chatgpt.com/docs/models`, `developers.openai.com/api/docs/models/*`):

- **GPT-5.2** and **GPT-5.3-codex**: already deprecated — this matches the user's report that
  `gpt-5.3-codex` fails on this account.
- **GPT-5.4 / GPT-5.4-mini**: retired from Codex (ChatGPT sign-in) on 2026-08-31.
- **GPT-5.5**: scheduled to retire from ChatGPT/Codex on 2026-10-14.
- **GPT-5.6 Terra / Sol** (previewed mid-2026) are being superseded: **GPT-6 Sol** and **GPT-6
  Luna** shipped 2026-09-22/23 at ~50% lower API prices than their GPT-5.6 counterparts.
  **[UNVERIFIED]** whether a "GPT-6 Terra" exists — one source speculates OpenAI is collapsing
  to a 3-tier Terra/Sol/Astra naming scheme, but the only confirmed Terra model ID found is
  `gpt-5.6-terra` (GPT-5.6 generation), not GPT-6.
- **GPT-6 Astra** (`gpt-6-astra`): flagship, released to approved users 2026-09-03, GA 2026-09-04.
  Confirmed available in Codex CLI, ChatGPT app/web, IDE extension, Codex cloud.

**Currently recommended/available Codex CLI models (as of 2026-09-26):** `gpt-6-astra`,
`gpt-6-sol`, `gpt-6-luna`, and `gpt-5.6-terra` (still current-gen; not yet replaced by a GPT-6
Terra). `gpt-5.3-codex` (the account's configured default) is deprecated and expected to fail,
consistent with the reported failure — **recommend updating `~/.codex/config.toml`'s
`model = "gpt-5.3-codex"` to `gpt-6-astra` or `gpt-6-sol`** (not done here — this is a research
task only).

| Model | ID | Context | Input/Output $ per MTok |
|---|---|---|---|
| GPT-6 Astra | `gpt-6-astra` | ~1.05M | $10 / $50 |
| GPT-6 Sol | `gpt-6-sol` | [UNVERIFIED exact] | $2 / $10 |
| GPT-6 Luna | `gpt-6-luna` | [UNVERIFIED exact] | $0.10 / $0.50 |
| GPT-5.6 Terra | `gpt-5.6-terra` | [UNVERIFIED exact] | [UNVERIFIED — priced below Sol] |

---

## 2. Official vision documentation

### 2.1 Anthropic (platform.claude.com/docs/en/build-with-claude/vision + vision-coordinates)

- **Input methods:** base64, hosted URL, or Files API `file_id`. Multiple images per request are
  explicitly supported and jointly reasoned over ("Image 1:", "Image 2:" labelling recommended).
  Images work best placed *before* text in the prompt.
- **Formats:** JPEG, PNG, GIF, WebP. No animation support (first frame only).
- **Request limits:** 100 images/request on 200K-context models (Haiku 4.5), 600/request on all
  others (Sonnet 5, Opus 5.5, Fable 5.1); 20 images/turn on claude.ai. Max image size 10 MB
  (base64) via direct API; hard pixel ceiling 8000×8000 px. **Caveat**: if a single request has
  >20 images total (including resent history and tool-result screenshots), a stricter per-image
  size limit kicks in — resize to ≤2000 px per side to stay safe.
- **Resolution/token cost — the core mechanic:** Claude tiles images into 28×28 px patches
  ("visual tokens"): cost = `⌈w/28⌉ × ⌈h/28⌉`.
  - **Standard tier** (Haiku 4.5 and pre-4.7 models): max long edge 1568 px, max 1568 visual
    tokens. A 1920×1080 screenshot is downscaled to 1456×819 (1560 tokens).
  - **High-resolution tier** (Sonnet 5, Opus 5.5, Fable 5.1 — "Claude 4.7 and later"): max long
    edge 2576 px, max 4784 visual tokens. A 1920×1080 screenshot is **not** downscaled (2691
    tokens) — up to ~3x more visual tokens than standard tier for the same image, which is the
    main reason to prefer these for small stylised text.
  - Full deterministic resize algorithm (with reference code in 7 languages) is published — useful
    if pre-resizing screenshots to control cost/precision.
- **Bounding boxes / spatial grounding:** Officially supported. Ask explicitly for **absolute pixel
  coordinates** `[x1,y1,x2,y2]` — Anthropic's docs explicitly say normalized 0–1000 coordinates
  perform worse. Coordinates are returned relative to the *resized* image Claude actually sees, not
  the original; docs provide exact rescale formulas to map back. Structured outputs
  (`output_config.format`) can constrain the bbox response to strict JSON. Padding (added to
  bottom/right only, multiples of 28px) never shifts the origin. For small UI elements that survive
  downscaling, the docs recommend cropping the region of interest and re-sending the crop, or using
  a high-resolution-tier model.
- **Structured output:** Fully supported via `output_config.format` (JSON Schema) — works
  alongside vision input, with the one exception that citations and structured output are mutually
  exclusive on document blocks (not relevant to plain images).
- **Documented limitations (official "Limitations" section):**
  - Hallucination/mistakes on low-quality, rotated, or very small (<200px) images.
  - Spatial/coordinate outputs are "approximate" — verify before relying on them at scale.
  - **Counting** is explicitly called out as approximate, especially with many small objects.
  - Cannot reliably detect AI-generated images.
  - No image generation/editing (understanding only).

### 2.2 OpenAI (developers.openai.com/api/docs/guides/images-vision)

- **Tokenization:** 32×32 px patches (vs. Anthropic's 28×28). Detail levels: `low` (fixed 85
  tokens regardless of size — coarse only), `high` (up to 2500-patch budget on GPT-6 Astra),
  `original` (up to 30,000-patch budget on some models, hard-rejects above that), `auto` (model
  picks). GPT-6 Astra/GPT-5.6/5.5/5.4 models apply a **1.2× token multiplier** on top of the raw
  patch count (e.g. 1024×1024 → 1024 patches × 1.2 ≈ 1229 billable tokens).
- **Limits:** max image dimension 65,535 px (very high — no practical screenshot hits this);
  images not enlarged if smaller; up to 1,500 images per request; 512 MB total request payload.
- **OCR / non-Latin scripts — explicit official caveat:** *"The model may not perform optimally
  when handling images with text of non-Latin alphabets, such as Japanese or Korean."* This is a
  direct documented weakness relevant to CJK/Thai/Vietnamese extraction. Docs recommend enlarging
  text and using `detail: "original"` for small/dense text.
- **Bounding boxes / spatial grounding:** No dedicated bbox/coordinate feature documented for the
  general vision API (unlike Anthropic's dedicated vision-coordinates guide). Docs explicitly warn:
  *"The model struggles with tasks requiring precise spatial localization, such as identifying
  chess positions."* Users are told to resize images and manually map coordinates back — no
  first-party guarantee of accuracy. OpenAI does have a separate `computer-use-preview` /
  computer-use agent model line for GUI coordinate-grounded interaction, but this is a distinct
  model from the general vision-capable chat models named above; **[UNVERIFIED]** whether GPT-6
  Astra/Sol/Luna specifically expose the same coordinate-grounding quality as that dedicated line.
- **Structured outputs:** Supported and explicitly documented as compatible with vision input
  ("Structured Outputs with function calling is compatible with vision inputs").
- **Per-model vision support:** GPT-6 Astra confirmed vision-capable with full detail-level
  support. GPT-6 Sol is confirmed tested on the same vision leaderboard/ScreenSpot-Pro benchmark
  (see §3), implying vision support. GPT-6 Luna and GPT-5.6 Terra's vision support/token budgets
  are **[UNVERIFIED]** in the sources found — current-generation OpenAI chat models are vision-
  capable by default, but no explicit per-model doc page for Luna/Terra vision limits was found.

---

## 3. Benchmarks

Public, model-specific OCRBench / ChartQA / DocVQA / CC-OCR / MMMU scores for these exact model
names were **not found** in searchable sources as of 2026-09-26 — these academic benchmarks lag
model releases and/or the labs did not publish per-benchmark tables for this generation in the
sources searched. What *was* found:

### 3.1 Roboflow "Vision Evals" (third-party, aggregate leaderboard; low-effort settings unless noted)

| Model | Overall rank/score | Object Detection | Counting | Identification | OCR | Data Extraction | Reasoning |
|---|---|---|---|---|---|---|---|
| GPT-6 Astra | #1 of 59 — 86.6% | 82.1% (#1) | 80.2% (#4) | 89.6% (#16) | 91.9% (#14) | 88.7% (#14) | 87.2% (#1) |
| Claude Opus 5.5 | #3 of 59 — 85.5% | 74.4% (#3) | 80.6% (#2) | 93.8% (#8) | 87.8% (#38) | 93.5% (#7) | 83.0% (#2) |
| Claude Fable 5.1 | #9 of 59 — 81.3% | 61.4% (#11) | 69.4% (#15) | 97.9% (#5) | 94.0% (#2) | 93.1% (#8) | 72.0% (#13) |
| Claude Sonnet 5 | #32 of 53 — 66.4% | [not itemised] | | | | | |
| Claude Haiku 4.5 | not yet evaluated on this leaderboard | — | — | — | — | — | — |

Notes on this table:
- This is a generic vision benchmark (not game-screenshot-specific, not CJK/Thai/Vietnamese OCR
  specific) — treat the OCR column as English-centric, general OCR ability, not stylised-font or
  non-Latin-script accuracy.
- Fable 5.1's OCR rank (#2 of 59, 94.0%) is notably strong relative to its weaker
  detection/counting/reasoning ranks — consistent with it being tuned for dense document/text
  reading.
- Opus 5.5's OCR rank (#38 of 59) is surprisingly weak for a flagship model despite strong
  detection/counting/data-extraction — Roboflow's write-up notes "extended thinking improves most
  tasks but **hurts OCR performance**" on this model, a concrete, model-specific caveat worth
  testing against your own screenshots before trusting Opus 5.5 for pure text transcription.
- Astra leads overall and specifically leads object detection and reasoning; it is competitive but
  not dominant on OCR (#14) and identification (#16) — Fable 5.1 and several other models score
  higher OCR than Astra on this leaderboard despite Astra's #1 overall rank.

### 3.2 ScreenSpot-Pro (UI element grounding — most relevant proxy for "find/locate an overlay
element and give a bounding box")

- GPT-6 Astra: 92.7%
- GPT-6 Sol: 76.9%
- No equivalent published ScreenSpot-Pro numbers were found for any Claude model in the sources
  searched — **[UNVERIFIED for Claude]**. Anthropic's own docs assert Opus 5.5 is "the best Opus
  model for vision and computer use" but do not cite ScreenSpot-Pro or an equivalent number.

### 3.3 Document/OCR-adjacent findings

- GPT-6 Astra: 91.3% accuracy on a 1,500-question scanned-contract document-parsing eval (per one
  reviewed source) — a real-document OCR/extraction proxy, not game-screenshot-specific.
- GPT-6 Astra: reported comparatively **weak** in Polish, Japanese, and Thai on a *translation*
  quality benchmark (Slator) — not the same task as OCR, but a signal that Astra's non-Latin
  script handling may be less reliable than its English-centric benchmark scores suggest.
  **[flag: proxy signal, not a direct OCR score]**.
- Claude Sonnet 4.6 (predecessor to Sonnet 5) reportedly scored 94.2% vs GPT-5.4's 91.8% on a Thai
  OCR comparison, and had a lower hallucination rate (0.09% vs 0.15%) — from a third-party
  comparison site, **[UNVERIFIED, not the current model generation]**. No equivalent Sonnet 5 /
  Haiku 4.5 / Fable 5.1 / Opus 5.5 vs. GPT-6 Astra head-to-head Thai/Vietnamese/CJK OCR numbers
  were found for the current generation.
- Dedicated academic benchmarks exist for Thai (ThaiOCRBench) and general OCR (OCRBench,
  CC-OCR/CCOCR) but the top scores found in search results were for specialized OCR-only models
  (e.g. Qianfan-OCR, PaddleOCR-VL), not for any of the six general-purpose chat models covered
  here — **no current-generation Claude/GPT scores on these specific leaderboards were located.**

**Bottom line on benchmarks:** there is no clean, current, apples-to-apples MMMU/OCRBench/
ChartQA/DocVQA/CC-OCR table across all six named models. The best available proxy is the Roboflow
Vision Evals aggregate (§3.1) plus ScreenSpot-Pro for grounding (§3.2, GPT-side only). Anything
claiming precise non-Latin OCR accuracy for the *current* model generation should be treated as
unverified until tested directly on your own screenshot corpus.

---

## 4. Known weaknesses (from official docs + benchmark commentary)

| Weakness | Anthropic (Claude) | OpenAI (GPT) |
|---|---|---|
| Hallucinated/invented text | Documented risk on low-quality, rotated, or <200px images | Not explicitly quantified in docs found; general small-text degradation implied |
| Non-Latin OCR | No official blanket caveat, but no current-gen non-Latin benchmark confirms strength either; Sonnet 4.6-era third-party data suggested Claude was competitive on Thai | **Explicit official doc warning**: "may not perform optimally... non-Latin alphabets, such as Japanese or Korean" |
| Counting | Explicitly documented as "approximate," worse with many small objects | Not specifically called out in the docs fetched, but Astra's Roboflow counting rank (#4, 80.2%) is below its detection/reasoning ranks |
| Colour naming | Not documented either way — **[UNVERIFIED]**, worth a direct test | Not documented either way — **[UNVERIFIED]** |
| Small text after downscaling | Explicitly documented; mitigation = pre-resize/crop or use high-res tier (Opus 5.5/Sonnet 5/Fable 5.1) | Explicitly documented; mitigation = `detail: "original"` / enlarge text before sending |
| Spatial/bbox precision | "Approximate," verify before use at scale; dedicated coordinate-remapping guide provided | Explicit doc warning re: precise spatial localization (chess-position example); no dedicated bbox guide for general chat-vision models |
| Extended thinking hurting a specific task | Opus 5.5: extended thinking **hurts OCR** per Roboflow (helps other tasks) | Not found in sources searched |

---

## 5. Cost per image at 1080×1920 (typical portrait mobile screenshot, ~2.07 MP)

Using each provider's own token formula, at each model's *default/enabled* resolution handling
(no manual downscaling applied), input-token pricing only:

| Model | Tier/detail | Tokens for ~1080×1920 | Input $/MTok | Cost per image | Cost per 1,000 images |
|---|---|---|---|---|---|
| Claude Fable 5.1 | High-res, not downscaled | ~2,691 | $10 | $0.0269 | ~$26.90 |
| Claude Opus 5.5 | High-res, not downscaled | ~2,691 | $4 | $0.0108 | ~$10.80 |
| Claude Sonnet 5 | High-res, not downscaled | ~2,691 | $2 | $0.0054 | ~$5.40 |
| Claude Haiku 4.5 | Standard, downscaled to ~819×1456 | ~1,560 | $1 | $0.0016 | ~$1.60 |
| GPT-6 Astra | `detail: high`, patches under 2500-budget | ~2,448 | $10 | $0.0245 | ~$24.50 |
| GPT-6 Sol | same formula assumed | ~2,448 | $2 | $0.0049 | ~$4.90 |
| GPT-6 Luna | same formula assumed **[UNVERIFIED — token multiplier/budget not confirmed for Luna]** | ~2,448 (est.) | $0.10 | ~$0.0002 | ~$0.25 |

Notes:
- The 1920×1080 row in Anthropic's own docs table is used directly (2691 tokens high-res / 1560
  tokens standard); portrait 1080×1920 has the same total pixel count so the token math is
  essentially identical (patch count differs negligibly with aspect ratio).
- GPT-6 Astra token estimate: patches = `⌈1080/32⌉ × ⌈1920/32⌉` = 34 × 60 = 2,040 patches (under
  the 2,500-patch `high`-detail budget, so not resized), ×1.2 multiplier ≈ 2,448 tokens. This is a
  derived calculation from the documented formula, not a quoted number — **[CALCULATED, not
  officially published for this exact resolution]**.
- Output tokens (the actual analysis text) are not included above and will typically dominate
  total cost for a detailed screenshot description — these are input-image-only figures for
  relative comparison.
- Haiku 4.5 is cheapest per image by a wide margin but loses ~42% of the pixel budget to
  downscaling (1456×819 equivalent), which will cost it on small stylised text and CJK/Thai glyphs.

---

## 6. Invocation from `claude -p` and `codex exec` with image input

- **`claude -p`** (Claude Code non-interactive/print mode): supported. Claude Code's built-in
  `Read` tool explicitly supports reading image files from disk and presenting them to the model
  visually (not just as raw bytes) — confirmed via this tool's own description. In practice:
  `claude -p "Analyze the screenshot at ./shot.png and classify the screen type" --model
  claude-opus-5-5` (or `claude-sonnet-5`, `claude-haiku-4-5`, `claude-fable-5-1`) works, with the
  agent invoking `Read` on the path itself. This applies to all four Claude models in scope — none
  are text-only.
- **`codex exec`**: supported via the explicit `-i, --image <FILE>...` flag documented in
  `codex exec --help` on this machine (`codex exec -m gpt-6-astra -i ./shot.png "..."`). Vision
  support is confirmed for `gpt-6-astra` (flagship, extensively benchmarked as vision-capable) and
  strongly implied for `gpt-6-sol` (tested on the same ScreenSpot-Pro/vision leaderboards as
  Astra). `gpt-6-luna` and `gpt-5.6-terra` vision-token behaviour is **[UNVERIFIED]** in the
  sources found, though current-generation OpenAI chat models are vision-capable by default —
  worth a smoke test (`codex exec -m gpt-6-luna -i shot.png "describe this"`) before relying on
  it for production use.
- **`gpt-5.3-codex`** (the account's configured default in `~/.codex/config.toml`): confirmed
  **deprecated** per OpenAI's own model-status pages, consistent with the reported failure on this
  account. Recommend switching the config's `model` value to `gpt-6-astra` or `gpt-6-sol`.

---

## 7. Recommendation summary (see final response for the ranked list + cost note)

# Analysis implementation plan (2026-09-27)

Target: `docs/analysis-requirements-user-2026-09-27.md`, on top of the existing pilot code
(plan → approval → run → records → report). Reuse, extend, no rewrite.

## A. Windows root-cause fix and loud failures

**Cause.** `run("claude", …)` did not end in `.exe`, so it went through `cmd.exe` with `shell:true`
and a hand-made quoter. The inline `--json-schema` JSON (containing `"#1f6fd0"`) was mangled.
Checked: the same JSON passed to the real `claude.exe` with `shell:false` parses fine.
`--json-schema` does not accept a file path, so the fix is to avoid `cmd.exe`, not to use a file.

1. `src/util/proc.ts` gets `resolveCommand(cmd)`:
   - on Windows, search `PATH` × `PATHEXT` for the real file;
   - `.exe`/`.com` → spawn directly, `shell:false`, array args (libuv quotes correctly);
   - npm `.cmd` shim (e.g. `codex.cmd`) → parse the shim for its `node_modules\…\*.js` target and
     run `node <script> …args` with `shell:false`;
   - any other `.cmd`/`.bat` → `cmd.exe` only if every arg is "plain" (no quotes, `%`, `^`, `&`, `|`,
     `<`, `>`, newlines, and under 2 KB); otherwise throw a clear error. Never silently mangle.
   - Large text (prompts) stays on stdin.
2. Regression tests: (a) a JSON arg with `\"#1f6fd0\"` round-trips byte-for-byte through `run()`
   using `node.exe`; (b) a fake npm shim in a temp dir is resolved to `node script.js` and receives
   the same JSON intact; (c) the `.cmd` guard refuses a JSON arg.
3. Loud failures:
   - A provider error (not a validation problem) is retried once, not three times, when the
     error text repeats.
   - `runAnalysis` counts consecutive failed images whose error text (normalised) is identical.
     After `analysis.stopAfterSameErrors` (default 3) it aborts the batch: "Stopped: 3 images in a
     row failed with the same error: …".
   - Job state keeps `errors[]` (image, game, position, message), `phase`, `startedAt`,
     `finishedAt`, `aborted`. The last state is also written to `pending/analysis-status.json`, so
     it survives a server restart and the page is never blank.
   - The page no longer auto-reloads. When a run ends it fetches the new analyses and the report
     and re-renders in place; errors stay on screen.
   - Failed records never block a retry: only `ok/adjudicated/corrected` records of the current
     schema version count as done (plan tiers, in-run skip, cache). Test included.

## B. The user's spec

### B1. Two-layer analysis per image (schema v2, prompt v2)
- `analysis-schema.v2`, `full-analysis.v2.md`, `adjudicate.v2.md`, taxonomy `mobile-rpg.v2.json`.
- Taxonomy v2 adds: gameplay `travel_exploration`, `board`; metagame `inventory`,
  `player_profile`, `evolution_upgrade`, `level_progression`, `game_pass`; key art stays.
- Per image (strict, all fields required, empty instead of optional):
  - `screenshot`: orientation (portrait|landscape), screenType, subtype, description, action,
    atmosphere, mainColours [{name, hex}], captureAreaPercent (how much of the image is the
    in-game capture), framing (full_bleed | framed | tilted_device | multiple | none).
  - `marketingLayer`: present, coveragePercent, backgroundMasks [{shape, colourName, colourHex,
    location, region}], texts [{role, text, language, colour, strokeColour, fontStyle, size,
    position, region}], elements [{kind, what, position, pose, colours, scale, breaksFrame,
    region}], mainColours [{name, hex}], relationToScreen. `present:false` = "no marketing layer",
    empty arrays.
  - top level: imageRef, headline (for cross-checking), confidence, notes.
- Producer Fable 5.1, reviewer gpt-5.6-sol at 100 %, Opus 5.5 settles disputes on: screen type,
  orientation, marketing layer present/absent, headline. When the adjudicator picks the second
  reading, that reading becomes the base (today the producer's is always used).

### B2. Saved immediately, keyed by content hash, resumable
- `imagesPerCall` default becomes 1: produce → review → settle → write `analysis/<sha256>.json` per
  image, before the next image starts. (Deck calls stay supported for later, when cost matters.)
- Before each image, the run re-reads the record and skips it if it is usable for this schema
  version. Model answers are also cached by content in `objects/`.
- Interrupted run: pressing Start analysis again shows only the images still missing.

### B3. Store order per game per date
- `orders/<appId>/<gl>-<hl>/<YYYY-MM-DD>.json`: date = the deck's fetch date; positions →
  imageId, screen type, subtype, orientation, marketing layer present. Written at the end of each
  run for every game in the batch (same date is overwritten with the latest).
- `compareOrders(a, b)` lists moved, added, removed and re-typed positions; the report shows
  "Changes since <date>" when an older snapshot exists.

### B4. Patterns across competitors (deterministic code, `src/analysis/patterns.ts`)
Over the competitors' usable records in the batch's market (ours excluded):
- per position: screen-type counts and the most common type with its share;
- screen types used at all: games using each type, images per type;
- orientation counts; marketing layer present share (overall and per position);
- proportion buckets from captureAreaPercent/coveragePercent: "full screenshot, small layer"
  (capture ≥ 80 %), "screenshot with a large layer" (50–80 %), "small screenshot inside a
  marketing image" (< 50 %), "no marketing layer";
- main colour families (hex → hue family by code; name as fallback) for screenshots and layers;
- co-occurrence per screen type: mask colour families, text colours, text positions, element kinds.
- Opus 5.5 gets only the computed JSON and writes a short interpretation (schema-validated,
  cached by input hash). No images in that call.

### B5. Our game vs the patterns (deterministic, `src/analysis/ours-vs.ts`)
- Per position: following (our type is the most common there, or ≥ 25 % share), slightly different
  (used by competitors at a neighbouring position or ≥ 10 % overall), very different (otherwise);
  each with a plain-language reason. Also layer presence and proportion per position.
- Overall: orientation, marketing-layer share, proportion bucket, deck length vs median, common
  screen types we do not use at all. Same three-level verdict with reasons.

### B6. Recommendations
- Opus 5.5 gets patterns + interpretation + ours-vs + our readings + short competitor readings
  (text only) → schema: overall rationale, and per recommended position: screen type, what to
  capture in-game (orientation, action, atmosphere, main colours), full marketing-layer spec
  (mask shape/colour/location, each text with content/colour/font style/size/position, each extra
  element with what/position/pose/colour), proportion, and why (evidence).
- gpt-5.6-sol reviews it against the patterns (findings with severity). If there are major
  findings, Opus revises once with them. The review and revision are saved and shown.
- Cached by input hash, so re-running with the same data never pays again.

### B7. Reports and data
- `reports/<runId>/`: `report.md` (per-image table, patterns, ours vs patterns, recommendations,
  review), `patterns.json`, `ours-vs.json`, `recommendations.json`, `review.json`.
- `reports/latest-<stage>.json` points to the latest one. The gallery shows the final report
  (server renders our own markdown subset to escaped HTML) at the end of a run and on page load.

### B8. Progress UX
- Always-visible status box at the top of the side panel, polled every 1.5 s:
  "Analysing image 5 / 18 — Capybara Go #3", "Checking…" (second opinion), "Settling…",
  "Finding patterns…", "Writing recommendations…", "Checking recommendations…".
- Elapsed time (ticks in the page), cost so far, error list. Idle shows the last run's outcome, or
  "No analysis has run yet". Never blank.

### B9. (i) icon
- Every image with a usable analysis (grid, deck rows, report) gets an `(i)` button. Hover or
  keyboard focus opens a popover with both layers (screen type, orientation, action, atmosphere,
  colours as swatches; masks, texts, elements; status and differences). Escape closes it.
- The analyses are sent once as a map by image id (also refreshable via `GET /api/analyses`).

### Approval and cost
- The approval screen and plan hash also include the synthesis passes (pattern summary,
  recommendations, recommendation review, possible revision) with a provisional cost.
- A batch with no new images is allowed when the synthesis for the current data is missing
  (resume after an interruption during the synthesis).

## C/D. Process
Sol reviews this plan → apply findings → implement → tests (fake providers) + Sol code review →
one real image end to end (about $0.25) as the smoke test. The full pilot is left to the user.

## Review outcome (gpt-5.6-sol, `docs/reviews/analysis-plan-review-gpt.md`)
Applied:
1. Store order: the raw order is saved before any model call; screen types are added afterwards in
   a separate `derived` block with its own schema version and a `complete` flag.
2. No partial synthesis: patterns and recommendations run only when every screenshot in the batch
   has a usable analysis; otherwise the report says which are missing and a new Start analysis
   retries only those.
3. Budget: the synthesis passes are in the estimate and the batch limit, and every call (including
   retries and the revision) is checked against what is left.
6. Ours vs patterns also compares marketing layer presence, layout (proportion) and mask colour per
   position, and layer colours overall.
7. Verdicts need at least 2 competitor screenshots at a position ("not enough data" otherwise).
8. Two orientations: the image canvas (by code, from pixel size) and the capture (by the model).
9. The prompt defines both percentages against the whole image, with examples.
11. Shim parsing only accepts the npm template (`"%dp0%\...\x.js"`); anything else goes through
    cmd.exe only with plain arguments, or fails with a clear message.
12. Status writes are atomic (temp file + rename); one job at a time is enforced in-process.
14. Recommendations are validated: positions 1..N without gaps, N within the allowed range.
15. The (i) button is a real button: hover, focus, click to pin, Escape returns focus, click outside
    closes, `aria-expanded`/`aria-controls`.

Not applied (reasons):
4. Cache keys already include step, model, prompt hash, schema version, taxonomy hash and image ids.
5. Same-date overwrite keeps the derived data only when the raw order is unchanged; good enough.
10. Adjudicating every field would multiply Opus cost; the four fields that drive patterns are
    settled, all other differences are recorded on the record and shown in the (i) popover.
13. "unknown"/"n/a"/"none" values are already explicit in the prompt and schema descriptions.

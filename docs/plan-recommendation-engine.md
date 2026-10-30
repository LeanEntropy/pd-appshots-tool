# Plan: a deterministic recommendation engine ("gap engine")

Status: draft, 2026-10-30. Author: Claude (Opus). Review: gpt-5.6-sol (one round; see section 12).
Scope: how the tool analyses, compares and concludes, for screenshots AND store metadata.
Nothing in `src/` changes until the user approves this plan.

## 0. Bottom line

The tool's failures are not a few bad rules. Three things are wrong with how it is built:

- Code measures a lot, but it only turns "competitor majority patterns we miss" into findings.
  - It never asks the reverse question: what do we show that nobody shows?
  - It compares at a level too coarse to see the difference: top screen type only, deck-wide orientation.
- The AI decides the strategy. It chooses keep, drop, add, deck length and order, and it explains its own choices.
  - Nothing checks those choices or the numbers it quotes against the code's facts.
  - A reviewer prompt then pushed it toward a shorter deck: it treated "we have not seen that screen" as "do not recommend it".
- Store metadata (tags, category, keywords, title, short description) is shown as tables and never turned into recommendations.

The fix is a code "gap engine":
- It turns facts into a ranked list of directives: COPY, DROP, ADD, REORDER, RESIZE, RE-LAYER, MESSAGE, KEEP, plus metadata directives.
- Each directive carries its evidence ("N of M competitors, leaders x of y, which ones") and a full target spec.
- The AI only words, specifies and localises those directives and proposes A/B tests on them.
- The AI can object, with a reason, but it cannot overturn a directive. Code validates the output against the directives.

## 1. The pipeline today (traced 2026-10-30)

| Stage | Decides | Who decides | Gets | Does not get / not checked |
|---|---|---|---|---|
| Image analysis (`full-analysis.v10`/lean `v11`, `schema.ts`) | Composition, captures, screen type + subtype, layer (masks, texts, elements), headline, notes | AI, with code consistency checks (`schema.ts:203-298`) | One image | Its pixel size/orientation, the game's other images. Lean has no element scale, so `all_art` is never set except for banners |
| Pixel facts (`image-facts.ts`, `colour-measure.ts`) | Orientation, ratio, size, dominant colours | Code | Pixels | Board density, tile size, HUD visibility, people/hands/devices |
| Categories (`categories.ts`, `banner.ts`, `layer-structure.ts`) | Category, promo banner, layer structure | Code | AI type + pixel orientation + the game's play orientation | **Subtype is dropped**: Victory = Board = "Gameplay". No lifestyle/in-context type. No "content showcase" type |
| Device sets (`play/screenshots.ts`) | Phone vs tablet; only phone analysed | Code | Sizes and runs | Tablet sets are not compared at all |
| Patterns (`patterns.ts`, `pattern-fit*.ts`) | position-N top type, before-X-Y, uses-X, deck orientation, layer, layout, mask place, colours, deck length, art message/logo | Code. Pattern ≥ 0.8, partial ≥ 0.5 | Competitor decks | **No "ours-only" check**, no per-position orientation, no subtype, no headline themes, no leader weight |
| Ours vs position (`ours-vs-position.ts`) | following / slightly / very different | Code | Per-position stats | "Same type" when ours has **≥ 25 %** share (l. 69): 2 of 8 = "following". Mask colour difference never changes the verdict |
| Bottom line (`pattern-fit-parts.ts:34-63`, `reports/summary.ts`, `bottom-points.ts`) | Verdict word from weighted points; "What differs" / "Do first" | Code score; **AI writes the bullets** | Fit summary | A 2-of-2 opener difference weighs the same as a mask colour. The AI bullets are only de-duplicated, never checked |
| Interpretation (`patterns.v5`) | Summary, key patterns with strength | AI | Patterns, ours-vs, fit | Its "strength: weak" labels hid strong per-position signals (landscape at 7–8, 2 of 2) |
| Recommendation (`recommend.v5`, `synthesis.ts`) | Whole target deck: types, keep/recapture/new, length, order, specs, "why" | **AI** | Patterns, verdicts, briefs, interpretation, length range | No directives. Code checks only the format (length range, keep keeps its type, no event lines). The AI may keep a type nobody uses, pick any length in range, and quote wrong counts |
| Review (`recommend-review.v4`) | ok / changes | AI (other family) | Same facts + recommendation | Its checklist "screens our game actually has" made it demand "verified" levels, which cut Comfy's deck from 8 to 6 |
| A/B tests (`ab-tests.ts`, `reports/ab-candidates.ts`) | Tests | AI on code gaps; code checks ids, n/of, one variable, leverage order | Misfit patterns only | Gaps never include ours-only types. A test may move AWAY from the pattern (Comfy test 2) |
| Country reports (`country-advice*.ts`, `country-facts.ts`) | Per-country deck changes, actions | AI on code facts (C-ids) | Country misfits, localisation, terminology | Per-position verdicts are not passed. "Why" counts are not checked |
| Store text (`store-compare.ts`, `keywords.ts`) | Keyword gaps | Code | Title, short/long description, tags, genre | **Tags are tokenised into keywords**: hence "hearted", "light". No tag, category, title or length directives. Descriptive only |
| Store data (`play/answers.ts`, `client.ts`) | — | — | Installs and score fetched (US details) | **Never used in analysis.** Ratings count not stored. Chart rank only sorts suggestions |

## 2. Comfy Mahjong Pilot (US): what a senior UA/CMO concludes vs what the tool said

Data:
- Competitors analysed: Vita Mahjong (100M+ installs, 4.85) and Mahjong Blast (50M+, 4.84), 8 phone images each.
- Ours: 500+ installs, 4 phone images; positions 5–8 are the same 4 images at tablet size.
- Mahjong Club (10M+) and Mahjong Master (10M+) were not analysed in the Pilot, but their store text is on disk.
- Both analysed competitors are category leaders, and we are a new entrant. Copying them is the default; differing needs a reason.

| # | Item | Tool said | Correct conclusion (directive, evidence) |
|---|---|---|---|
| C1 | Position 1 | "Replace **or A/B test**" a banner. The table says "Title screen / full-screen art … recapture our position 1", i.e. rebuild our title art | **COPY**, strong: a new marketing-only 1920x1080 landscape banner, no screenshot, no band. 2 of 2 (Vita #1, Blast #1), leaders 2 of 2. Spec: dark green background; logo plus a benefit/genre line in the left ~40 %; a hero 3D mahjong-tile structure on the right (Vita: tile tower; Blast: tile temple); gold/white serif or heavy display text; all drawn as one artwork. Production source: marketing art, not an in-game capture |
| C2 | Our victory screen (pos 4) | "following", "keep"; the AI praised it as a differentiator | **DROP**: "Level completed / results" is used by 0 of 2 games and 0 of 16 images. Its headline "NO TIMERS" also mismatches its focus (a reward screen), a focus mismatch on ours that the rules say to report. **Replacement:** a full-board gameplay image with large tiles and the benefit "Big tiles, easy on the eyes" (Vita #2 "Large Tiles", #4 "Eye-Friendly"; our own short description already says "big tiles"); "No timers" moves to a board image |
| C3 | Our portrait title art | Kept at position 6, "like the full-screen art at image 6 in 1 of 2 decks" | **DROP**: portrait title/full-screen art is used by 0 of 2. **The AI's claim is false**: Blast #6 is a landscape "New Themes Await" tile showcase. Its logo moves into the C1 banner. Replacement: C6/C7 |
| C4 | Deck length | "Grow to 8", but the deck stops at 6 because "readings confirm no other levels" | **ADD to 8**: 2 of 2 use 8. The team can capture any screen (PILLARS), so "unverified" means "capture it", never "omit it" |
| C5 | Positions 7–8 | "Image orientation: portrait 9 of 16, fits"; the interpretation called the mix "weak" | **COPY**: landscape 16:9 at 7 and 8 in 2 of 2 (Vita: landscape boards "Better Sleep", "Offline Play"; Blast: lifestyle scenes "Your Daily Escape", "Mahjong for Better Sleep") |
| C6 | Headline themes | Not analysed. The AI kept "MATCH & CLEAR" (a mechanic) | **MESSAGE**: competitors' lines are audience benefits. Offline 2 of 2, relax/sleep 2 of 2, daily 2 of 2, brain training 1 of 2 in images (3 of 4 in short descriptions), large tiles 1 of 2, level count 1 of 2, new themes 1 of 2. Ours lacks brain, daily, large tiles, sleep and level count. Replace "MATCH & CLEAR" with a missing benefit |
| C7 | Board shown (pos 2) | "following" | **RECAPTURE**: competitors show a dense, iconic full layout (pyramid, heart, symmetrical) with big tiles filling the frame and little HUD. Ours shows Level 1 with 4 sparse clusters, an empty tray and a full HUD, which reads as a tutorial. The attribute is missing from the analysis |
| C8 | Lifestyle / in-context images | Blast #7 (hand, tablet, coffee, cat) labelled "Gameplay / Board"; Blast #8 (sleeping person) a "banner" | **Missing category** "lifestyle / in context" (people, hands, a device in a scene). It is 2 of 8 of Blast's images, the "relax / sleep" story. ADD candidate for position 8 (1 of 2, so a test, not a directive) |
| C9 | Marketing layer | Colour "fits" (partial), then "following" with "mask colour blue …" listed; the AI kept blue "to stand out" | **RE-LAYER**, at test strength only: dark green/gold on 2 of 2, no hard band on Vita. Two games are too few to force a colour change. Brand colour is a user decision (D5). The AI must not claim "stand out" without evidence |
| C10 | Verdict | "SLIGHTLY DIFFERENT (17 of 23)"; the earlier run said "OPTIMISED (27 of 29)" | **VERY DIFFERENT, rebuild**: 1 strong COPY at position 1, 2 DROPs, 4 ADDs, landscape 7–8 |
| C11 | "Do first" | "Keep images 2 to 4 as they are" | Wrong: it keeps the victory screen and the weak board |
| C12 | A/B test 2 | Open on gameplay and move the art to the end | **Contradicts the evidence** (0 of 2 open on gameplay). Test the banner (C1), then the 8-image rebuilt deck (C2–C6) |
| C13 | Tablet set | "not analysed (tablet-shaped)" rows | Not a directive: tablet sets are not analysed. Note only: our tablet set is the old phone set resized; rebuild it after the phone deck (Vita has its own 6-image tablet set) |
| C14 | Tags | Our tags cell is empty. Nothing recommended | **ADD tags** (candidates until D9 is verified): 4 of 4 competitor games carry Mahjong solitaire, Pair matching, Single player, Light-hearted and Offline. This is app-level data, the same set translated in every country, so it is counted once per game. Stylized is on 3 of 4 and Casual on 2 of 4. Ours: none |
| C15 | Category | Shown, not discussed | **Decision for the user**: 3 of 4 (both leaders) are Board, ours is Puzzle. It changes charts and neighbours and cannot be A/B tested (D4) |
| C16 | Keyword gaps | "hearted", "light", "joka", "tila", "tarjoaa", "pair matching", "hors connexion", "Paare zuordnen" | Mostly **artifacts**: tag names tokenised into keywords, plus missing stopwords. The real gaps are tag gaps (C14) and the theme gaps (C6). Real text gaps: DE competitors keep "Mahjong Solitaire" (2 of 2) where we say "Solitär"; brain benefit missing in the short description (3 of 4 in EN) |
| C17 | Short description | Not discussed | Ours is good (big tiles, offline). ADD brain/daily, within 80 characters. Example (counted by script): "Relaxing mahjong solitaire: big tiles, no timers, offline. Train your brain!" (76). DE: "Mahjong Solitaire mit großen Steinen: kein Zeitlimit, offline, Gehirntraining." (78). A natural FR draft came out at 83, which is why the length check must be code |
| C18 | Title | Not discussed | "Comfy Mahjong Solitaire" (23 of 30) already has the core term. KEEP in EN. DE: test "Solitaire" in the title vs "Solitär" (2 of 2 DE competitors use "Solitaire") |
| C19 | Market weight | None | Vita and Blast are 100M+/50M+ vs our 500+. The report should say "both category leaders do this" and rank such items first |

## 3. Rogue Legend, US Full check (lighter)

| # | Item | Tool said | Correct conclusion |
|---|---|---|---|
| R1 | Image 2: menus/progression | Top action, "4 of 8" | **Weak, test only.** The 4 are Overgeared Hero (1M), Sword x Staff (1M), Clash of Critters (5M) and Path of Kings (1M). The leaders do otherwise: Survivor.io (50M) and Archero 2 (5M) show Gameplay at 2; Capybara Go (10M) and Legend of Mushroom (5M) show event art. Leader weighting would demote this from "most important" |
| R2 | Image 2 verdict | "following" (2 of 8 Gameplay) while the key point says "different" | Contradiction caused by the ≥ 25 % "same type" rule (`ours-vs-position.ts:69`). It is still on master |
| R3 | Opening line | "4 of 5 competitors' opening art carries a line" | Inflated: 2 of those are event lines (not to copy), so a lasting line is 2 of 8 (both 1M games). Archero 2 is logo-only. Test, not directive |
| R4 | Sword x Staff #1 | Title art | Landscape banner (fixed on 2026-10-30) |
| R5 | Positions 6–8 | "following 2 of 3" / "2 of 5" | Tablet exclusion leaves 2–5 games there. Positions below the small-sample floor must not produce directives |
| R6 | Dice board | (fine) | Our core mechanic. A naive "drop types nobody uses" rule would drop it. The engine needs a **core-loop exemption** (Survivor.io's slot board is 1 of 8 anyway) |
| R7 | Verdict | "OPTIMISED 22 of 24" | Roughly right ("on par"). The deck is close, and the open items are tests. With leader weighting the top action changes (R1) |
| R8 | Tags | Not discussed | Ours: Roguelike, Single player, Stylized, Monster, Immersive. Competitors: Idle RPG 4 of 8 (Capybara Go, Legend of Mushroom, Sword x Staff, Path of Kings) and Fantasy 4 of 8. KEEP Roguelike (our genre, shared with Archero 2 and Survivor.io). **Consider** Fantasy in place of Monster (1 of 8). Not a strong directive |

## 4. Systemic causes

1. **One-directional comparison.**
   - Findings exist only for "competitor majority we miss".
   - Nothing finds "we show X, nobody does" (C2, C3) or "everybody shows X at position p, in orientation o" at the deck level (C5).
   - `abCandidates` inherits the same blind spot.
2. **Wrong comparison grain.** The top-level type only, with subtype discarded, so Victory = Board. Orientation is deck-wide, not per position. Headline meaning is not compared at all.
3. **The AI owns strategy.**
   - `recommend.v5` says "follow strong patterns unless there is a clear reason". The AI chooses keep, drop, length and order.
   - Its "why" counts are never checked, so it invented "1 of 2 at image 6".
   - The reviewer's "screens our game actually has" check contradicts the rule that any screen can be captured, and it truncated the deck.
4. **Soft scoring and wording hide strong signals.**
   - The weighted-points verdict treats an opener difference like a colour difference.
   - "Partial ≥ 0.5" and the AI's "weak/moderate" labels are not tied to per-position unanimity.
   - "Replace or A/B test" hedges a 2-of-2 leader signal.
5. **"Following" is too coarse.** The ≥ 25 % share rule, plus colour and layout differences that never affect the verdict.
6. **No market-leader weight.**
   - Installs and score are fetched but unused, and the ratings count is not stored.
   - Every competitor counts the same: a 1M game outvotes a 50M game.
7. **Classification is trusted without pixel cross-checks.**
   - Only the banner has one (landscape art in a portrait game).
   - Lifestyle scenes become "gameplay", and a tile showcase becomes a "banner".
8. **Missing attributes:**
   - board density and tile size;
   - HUD visible;
   - people, hands or a device in the scene;
   - headline theme;
   - production source (capture / capture + layer / marketing art);
   - focus-vs-headline mismatch on ours.
9. **Small samples are not handled explicitly.**
   - n = 2 positions become "patterns", with no leader tie-break.
   - Tablet exclusion thins later positions without lowering their weight.
10. **Store metadata is descriptive only.**
    - Tags are mixed into keyword counts, producing junk tokens.
    - There are no tag, category, title or short-description directives, and no length or rule checks.

## 5. The redesigned method

### 5.1 Facts layer (code; cheap additions)
For each image, it adds the following to what exists today:
- **Kind**: a comparison family between category and subtype. It is decided by a code table from the subtype:
  - `core_play` (board, battle, run…);
  - `result_reward` (victory, defeat, level complete, rewards);
  - `progression`;
  - `collection`;
  - `social`;
  - `map`;
  - `title_art`;
  - `promo_banner`;
  - `content_showcase`;
  - `lifestyle`.
- **Production source**:
  - `capture` / `capture_layer` / `marketing_art`, from the layer structure;
  - a banner is always `marketing_art`.
- **Headline themes**: a per-language lexicon (offline, relax, sleep, brain, large_tiles, levels, daily, no_timer, themes, collect, battle, upgrade…). It runs on the saved text at no cost; unmatched lines get one cheap text-only tagging call, which is cached.
- **New analysis fields** (prompt v12, new images only; backfill optional, D6): `boardDensity` (sparse/medium/full), `hudVisible`, `people` (none/hands/person), `deviceInScene`.

**Pixel and logic validators** (code). Each produces a flag; the report shows the flag, and a flagged image never drives a directive alone:
- Landscape art in a portrait game is a banner (exists).
- An image with `people` or `deviceInScene` that is labelled gameplay is relabelled `lifestyle`.
- An art image with several tile sets and no UI is `content_showcase`.
- Ours: a focus that conflicts with the headline theme raises a MESSAGE item.

### 5.2 Competitor weighting and signal strength (code)
- **Leaders** are defined within the analysed competitor set, never relative to us. Against a 500-install app, every competitor would be "10x ours".
  - Rank each competitor by its installs bucket, then by `realInstalls` / `ratings` count, then by grossing chart rank.
  - **Leader**: a game whose real installs (or bucket floor) are ≥ 20 % of the set's top game, plus any game in the category's grossing top 10.
    - Comfy: Vita (100M) and Blast (50M) are leaders; Club and Master (10M) are not.
    - Rogue Legend: Survivor.io (50M) and Capybara Go (10M).
  - The top game is always a leader. With no install data at all, leader weighting is off and the report says so.
  - Data: installs and score are already in `details` (US). Add `ratings` and `realInstalls` from the same scraper call (free). Installs are global, so one read per game is enough.
  - Shown as "2 of 2 games, both leaders" or "4 of 8 games, 0 of 2 leaders".
- **One leader policy everywhere** (screenshots and metadata):
  - "Leaders agree": every leader that has the data does it.
  - "Leaders against": a majority of the leaders do something else.
  - Leaders never add votes. They only cap or confirm strength (table below), and they break ties only when all leaders agree.
- **Strength**, per signal, from n of M **unique games** (not images, not repeated country rows):

| Strength | Rule | Can produce |
|---|---|---|
| unanimous | n = M, M ≥ 3; or M = 2 with both leaders | directive |
| unanimous-provisional | n = M = 2, not both leaders | directive marked "provisional: confirm with the Full check" |
| strong | n/M ≥ 0.75, M ≥ 3, leaders agree | directive |
| majority | n/M > 0.5 and leaders not against | directive at positions ≥ 4 and for metadata; at positions 1–3, an A/B test first |
| split / tie / leaders against | otherwise | test idea only |
| none (0 of M) | M ≥ 2 | DROP evidence (provisional when M = 2 and not both leaders) |

- **Small samples**:
  - M = 1 gives "consider" only.
  - A position reached by fewer than 2 analysed games never produces a directive. This covers short decks and tablet thinning.
  - The report always names M and the games.

### 5.3 Directive rules (pure functions, `src/engine/`)
Each rule returns `Directive { id, kind, target (positions | deck | metadata field), evidence: {n, M, leaders: {n, of}, games[], imageIds[], countries[]}, strength, spec, replacement?, rank }`.

1. **COPY-AT-POSITION**: unanimous or strong kind (or orientation, or layer structure) at position p, and ours differs.
   - The spec is built by code from the exemplars. Each field carries where it came from (pixels, code or AI reading) and how many exemplars agree.
   - **Required fields**, which the validator enforces:
     - kind;
     - canvas size and orientation (pixels);
     - production source;
     - logo yes/no;
     - theme(s);
     - exemplar ids.
   - **Optional fields**, carried as "x of n exemplars" and marked "not measured" when old analyses lack them:
     - layer structure;
     - logo place and text positions;
     - colour families;
     - element list.
   - The spec never invents precision: the AI's wording must stay inside these fields.
2. **DROP**: our kind is used by 0 of M ≥ 2 games anywhere in their phone decks.
   - Exempt:
     - our `core_play` kind (the game's own loop, R6);
     - any screen or message the user marks **protected** in the project (a USP, accessibility, brand). Protection is shown as "kept by your choice".
   - The DROP itself names only "needs a replacement". The **deck builder** (5.4) allocates the replacements, for all DROPs together. Each replacement is unique, fits the target position (an opener-only COPY never goes to slot 6), and has a full spec. A DROP that is left without a replacement is invalid and turns into a test.
   - Declined review point: "require a second condition such as low strategic value". The user's rule is that a type no competitor uses goes. The protected list and the mandatory, better-evidenced replacement are the safeguards.
3. **ADD-KIND**: a kind used by a majority of games, including the leaders, and absent from our deck. Placed at the competitors' median position.
4. **LENGTH**:
   - **Target** = the median of the competitors' phone deck lengths after removing repeats. An even count's median rounds up, with a maximum of 8.
   - It fires when ours is ≤ target − 2, or below the competitor minimum. New slots are filled by the deck builder from ADD, COPY and ORIENT items in rank order. If none are left, the slot gets the competitors' most-used kind at that position, with evidence.
   - If ours is longer than the maximum, it trims from the end after the DROPs.
5. **REORDER**: we have the kind, but outside the band where the competitors put it (their min–max position for that kind). A majority of the decks must reach both positions.
6. **RESIZE / ORIENT**: unanimous or strong orientation or aspect at p (C5).
7. **RE-LAYER**: layer structure, band versus no band, or mask/text colour family. Colour stays at test strength unless strong with M ≥ 3 (D5).
8. **MESSAGE**:
   - Theme coverage: a theme that a majority of games use, and that we lack, is added.
   - Our mechanic-only or focus-mismatched lines are replaced.
9. **RECAPTURE**: same kind, but a measurable attribute differs (board density, HUD) with strong evidence (C7).
10. **KEEP**, in three forms:
    - `KEEP_SUPPORTED`: a fact backs it, e.g. "Gameplay at image 2: 2 of 2".
    - `KEEP_NO_SIGNAL`: a tie, too few games, or a missing attribute. It is said plainly as "no evidence either way".
    - `REVIEW`: a flagged classification or a failed validation.

**Rank** = position weight (3 / 2 / 1.5 / 1) × strength (unanimous 1, strong 0.8, majority 0.6; provisional × 0.8) × kind weight (COPY / DROP / LENGTH 1.0, ADD / ORIENT 0.9, MESSAGE / RECAPTURE 0.8, RE-LAYER 0.5).

The bottom line is derived from the screenshot directives only; metadata and test ideas never count:
- **VERY DIFFERENT**: a structural trigger. That is a COPY, DROP or ORIENT at positions 1–3, a LENGTH gap of ≥ 3, or ≥ 2 DROPs.
- **SLIGHTLY DIFFERENT**: any other directive with a summed rank ≥ 1.5.
- **ON PAR**: lower directives or tests only.
- **OPTIMISED**: no directive, and no strong test.

The weighted-points score stays as a detail.

### 5.4 Deck builder (code)
It applies the directives to our deck to produce the **target skeleton**: slots 1..N, each with:
- kind;
- orientation;
- size;
- production source;
- logo;
- required elements;
- theme;
- action (copy / keep / recapture / new capture / new marketing art / moved from p);
- the directive ids behind it.

Conflicts are resolved in rank order.

### 5.5 What the AI does (wording, specifics, localisation)
- **Recommendation prompt v6**: "Here is the target skeleton and its directives. Fill in each slot's concrete content: which screen to capture, the exact text in English, colours with hex, and the element details. Write each 'why' only from the directive's evidence ids."
- The AI **may object**: `{directiveId, reason, evidence}`.
  - An objection is shown next to the directive; it never changes the deck.
  - The user can accept it (feedback loop).
- **Review prompt v5**:
  - It checks completeness, concreteness and wording.
  - "Unverified screen" becomes a capture note, never a reason to drop a slot.
  - It may flag an objection-worthy directive, but not rewrite the deck.
- **A/B prompt**: every test cites directive ids and returns a **structured delta** per changed slot: old and new kind, orientation, source, theme, layer structure and position. Code compares the delta to the directive; a delta that moves away from a directive (C12) is rejected.
- **Interpretation**: the strength words come from code (5.2), and the AI only phrases them.

### 5.6 Validators after the AI (code; failures go to the existing single repair retry, then are dropped or replaced by code text)
1. Skeleton fidelity: each slot's kind, orientation, source, logo and position match the skeleton.
2. Every DROP is absent from the output, and its replacement is present with a full spec (mask, texts, elements, capture or art brief).
3. Every COPY slot carries every field of the code spec (size, orientation, layer structure, source, logo, element list).
4. Number claims: every "N of M" in user-facing text must match an evidence id, using the existing gap-id check generalised to all AI text. A free count with no id is rejected.
5. Bottom-line bullets are generated by code from the top directives. The AI may only reword them, and the claim check applies.
6. Banned moves:
   - "keep" on a DROP target;
   - a portrait spec on a COPY-landscape slot;
   - "recapture" for a marketing-art slot;
   - a deck shorter than the LENGTH target.
7. **Metadata checks**:
   - Lengths are counted by code, never typed by hand: Play title 30, short description 80, full description 4000; Apple name 30, subtitle 30, keywords 100 bytes (UTF-8), promotional text 170. Character counts are grapheme-aware, and whitespace is normalised.
   - Enforced rules (official KB entries) apply: no ranking or price claims, no emoji or caps spam, no competitor names or trademarks, and no keyword repetition.
   - Platform vocabularies apply: only Play's tag list and category ids.
8. **Grounding of the AI's specifics**:
   - Headline length per line: a safe-zone character budget by size and orientation, with localisation overflow checked per language.
   - Every element named must exist in our readings or in the spec's asset list (logo, tiles, key art).
   - The headline theme must match the slot's theme and focus.
   - Colour contrast check: later (needs measured layer colours).

### 5.7 Metadata directives (same engine, per country-language)
Inputs, all on disk at no cost: title, short and long description, genre, tag chips, content rating and recent changes, for every competitor and country fetched.

How evidence is counted:
- **Unique games**. Tags and category are app-level: the same chip set shows in every country, translated. They are counted once per game and shown once ("all countries: same tags, localised names"), never once per country.
- Text (title, short and long description) is per country-language: a custom listing can differ by country.
- Image text and store text are separate evidence lines, never added together.

Metadata uses the same leader policy as screenshots (5.2).

| Parameter | Directive | Rule | Concrete value (by code; AI localises wording) |
|---|---|---|---|
| Tags | **Candidates** until D9 is verified, then ADD / REPLACE | A tag on a majority of games that we lack. Tags are matched by their English name (the US listing) across languages. When our slots are full: replace our tag with the lowest evidence (0 of M first), never the genre tag | Ranked tag list with N of M, e.g. Comfy: Mahjong solitaire, Pair matching, Offline, Single player, Light-hearted (4 of 4 games each) |
| Category | Decision card only | Our genre differs from the majority **and** from the leaders. The card also shows chart neighbours and genre fit, and notes that competitor selection may be category-biased | Never changes the skeleton or the verdict (D4) |
| Title | KEEP / ADD-ASO | Core term coverage: the majority's title terms (after the brand part) that are missing from ours; length ≤ 30 | Suggested titles with character counts, in the local language plus an English back-translation |
| Short description | ADD-THEME | A theme on the majority of games' short descriptions that is missing from ours (theme lexicon per language) | 1–2 variants ≤ 80 with counts, local plus English meaning |
| Long description | ADD-TERM | A term in ≥ majority of competitors' descriptions that is missing from ours, after removing tag names and stopwords | A term list plus one suggested sentence per missing theme |
| Keywords (derived) | (feeds the above) | **Fix:** tags are no longer tokenised into keyword counts; per-language stopwords; hyphenated names stay whole | — |
| Terminology / "Words to use" | REPLACE | Already per country; becomes directives with N of M | Local word, English meaning |
| Recent changes | none | Not a ranking or conversion lever | — |
| Apple | name, subtitle, keywords, promotional text | Competitors' subtitle, keyword field and promotional text are **not available** (the API has none; scraping is forbidden). Directives use our own values (typed in by the user) against the competitors' name and description terms | Suggestions with byte and character counts |

### 5.8 Data that is missing, and what it costs to get

| Missing | Effect | Fix | Cost |
|---|---|---|---|
| Ratings count, real installs | Leader weight is coarse (buckets) | Keep `ratings`, `realInstalls` from the same details call | Free (re-fetch details: one throttled read per game) |
| Installs per country | Installs are global; that is fine | none | — |
| Pilot competitors not analysed (Club, Master) | M = 2 for screenshots | Full check: 15 new images, $5.41 to $8.81 (estimate already shown in the tool, 4 competitors) | Already offered |
| Tags/text for countries not in the project | none for Comfy (all 12 fetched) | Fetch on country add | Free |
| Apple subtitle, keywords, promotional text of competitors | Apple metadata directives are partial | Not obtainable within Apple's terms. Use our own values only | — |
| New image attributes (density, HUD, people) | C7, C8 rely on them | Prompt v12 for new images; optional backfill | See section 9 |

## 6. Judging the three rules being added now (another agent)
- **"Copy the dominant pattern"**: right direction. To be safe it needs:
  - (a) a definition of dominant: unanimous or strong per 5.2, counted per game, not per image;
  - (b) a leader check, otherwise R1 happens (a 1M-game majority beats the 50M leader);
  - (c) a full spec from the exemplars, not just a type name;
  - (d) a small-sample floor (M ≥ 2 at that position).
- **"Drop image types no competitor uses"**: right, but it fails silently on Comfy's victory screen if it compares top-level screen types, because victory is "Gameplay". It needs:
  - the **kind** grain (5.1);
  - a deck-wide, not per-position, check;
  - the core-loop exemption (R6);
  - M ≥ 2;
  - a mandatory **replacement** with a full spec (user directive, 2026-10-30).
- **"A promotional banner is a marketing-only image"**: right, and it should be generalised. Every slot gets a production source, and a `marketing_art` slot can never be "recapture our position N" or "new capture". The spec must ask for art built from assets (logo, tiles, key art), not a screenshot.
- Where the three rules sit:
  - Recommended: inside the engine, as COPY, DROP and the production source.
  - Not recommended: as prompt text, which the AI can still ignore.
  - If they ship as prompt rules now, the validators in 5.6 (2, 3, 6) are what make them stick.

## 7. Validation checks that would have caught each failure

| Failure | Check |
|---|---|
| Position 1 as title art / "rebuild title art" | 5.6-1 skeleton fidelity (source = marketing_art, landscape) + 5.6-6 banned "recapture" |
| Victory "keep" | DROP rule at the kind grain + 5.6-2 |
| Portrait art kept at 6 with a false "1 of 2" | DROP + 5.6-4 claim check |
| Deck stopped at 6 | LENGTH + 5.6-6 + review v5 rule |
| Landscape 7–8 missed | ORIENT rule per position |
| "Slightly different" / "Optimised" | Verdict from directives (5.3) |
| A/B test away from the pattern | 5.5 "toward" check |
| Title/feature confusion, duplicates (Rogue Legend) | Existing single art category + `deck-repeats`; kept as regression cases |
| Image-2 "following" at 2 of 8 | Remove the 0.25 rule; same kind = top kind with ≥ majority, else "different (minority)" |
| No tags recommended | Metadata TAG-ADD |
| "hearted", "light" keywords | Tag names excluded from tokenising; test |

## 8. Regression set (from the user's corrections)

New `test/fixtures/engine/`:
- small JSON copies of the saved analyses, decks and store text, for Comfy (US, plus DE and FR store text) and Rogue Legend (US);
- no images, since pixel facts are saved in the identity.

The tests are `node:test` and use no AI.

Comfy:
1. Position 1 is COPY, kind `promo_banner`, landscape 1920x1080, source `marketing_art`, evidence 2 of 2 (Vita Mahjong, Mahjong Blast), leaders 2 of 2.
2. The victory screen (pos 4) is DROP, 0 of 2 games, with a replacement that has a full spec.
3. The portrait title art is DROP, 0 of 2.
4. LENGTH has a target of 8.
5. Positions 7–8 are ORIENT landscape, 2 of 2.
6. The verdict is "very different".
7. No KEEP is placed on positions 1 or 4.
8. TAG-ADD includes Mahjong solitaire, Pair matching, Offline (4 of 4).
9. The keyword gaps exclude "hearted" and "light".
10. A fake AI output that keeps the victory screen fails validation.
11. A fake AI output quoting "1 of 2 at image 6" for full-screen art fails the claim check.
12. A fake A/B test opening on gameplay is rejected.

Synthetic edge cases (built from the fixtures by editing their facts):
- A. M = 1, which gives "consider" only.
- B. Unanimous non-leaders against a leader minority, which gives a test, not a directive.
- C. No install data, so leader weighting is off and the report says so.
- D. A tie at a position, which gives no directive.
- E. Uneven deck lengths, where position 7 is reached by 1 game, which gives no directive.
- F. Two DROPs competing for one replacement, which the deck builder resolves into unique, position-compatible replacements.
- G. A protected USP screen, which is never dropped.
- H. Old analyses without the new fields, where optional spec fields read "not measured" and the validator still passes.
- I. Directives that conflict (COPY and REORDER on the same slot), which are resolved by rank.
- J. Our 5 tag slots already full, where the replacement order holds.
- K. The same tags in 12 countries, which count as 1 game each.
- L. UTF-8 and grapheme limits (Japanese, Thai, emoji), plus localisation overflow of a headline.
- M. Repair failure, where code text replaces the AI's text and the directives are still shown.

Rogue Legend:

13. Sword x Staff #1 is a banner, while landscape gameplay composites are not.
14. Image 2 is not "following" at 2 of 8.
15. The dice board is never DROPped (core-loop exemption).
16. Image 2 Menus is test-strength, not a directive, once leaders are weighted.
17. Title art and feature art stay one category.
18. The duplicate-screen pairs found earlier stay counted once.

## 9. Cost impact on paid runs
- The engine, validators and metadata directives are code: **$0**. Reports rebuild for free.
- The recommendation and review prompts get a skeleton plus directive specs instead of all the raw patterns. Input is about the same size; output grows by roughly 20 to 40 %, because every COPY and replacement needs a full production spec.
  - A text-only re-run of the AI parts: about **$1 to $3** per report (today's estimate is $0.75 to $2.25).
- Repair retries happen only on validation failures, so expect +0 to 30 % on those calls in the first weeks.
- Operational scope, not money: a taxonomy or kind change makes saved AI parts "out of date" (the existing stale marking), so reports need a text-only refresh. Twelve-country metadata output adds QA reading time, which the "open by default = clean" rule keeps behind folds.
- **Headline themes**: the lexicon costs $0. Unmatched lines get one cached text-only call per run, about $0.05 to $0.20 (estimate).
- **Metadata wording, per language** (Comfy has 6: en, es-419, de, fr, fi, it): one text-only call each, about $0.10 to $0.30 per language (estimate), so **~$0.60 to $1.80** for all countries. It is optional; the code-only values are free.
- **New image fields (prompt v12)** add a few output tokens per new image, about +3 to 5 %.
- Optional backfill: Comfy's 20 images about $1 to $2, and Rogue Legend's 57 about $4 to $7 (estimates). They must be approved before running (cost gate).
- Leader data: the details re-fetch is free.

## 10. Implementation outline (after approval)
1. `src/engine/` with these modules, each under 300 lines:
   - `kinds.ts`: the subtype-to-kind table;
   - `leaders.ts`;
   - `strength.ts`;
   - `rules-deck.ts`;
   - `rules-position.ts`;
   - `rules-message.ts`;
   - `rules-meta.ts`;
   - `skeleton.ts`;
   - `validate.ts`;
   - `directives.ts`: types and rank.
2. `keywords.ts`: stop tokenising tags; add per-language stopwords. `store-compare.ts`: the tag, category and title comparisons.
3. Wire-up: `abCandidates` becomes a view of the directives. The bottom line, key points and "Do first" come from the directives.
4. Prompts: `recommend.v6` with the skeleton contract, `recommend-review.v5`, `ab-tests.v3` with directive ids, `patterns.v6` with strength words from code, `full-analysis.v12` with the new fields.
5. Report: a new "What to change" block at the top, one row per directive with its evidence chip ("2 of 2 · both leaders") and its spec, plus a "Store listing" block per country.
6. Regression set (section 8) green, then a cross-family review of the implementation.

## 11. Open decisions for the user
- **D1 Leader definition** (proposed): a game is a leader at ≥ 20 % of the top competitor's installs, or in the grossing top 10. Leaders cap or confirm strength; they never add votes.
- **D2 DROP at 0 of 2**: a directive (proposed, per your instruction). It is marked "provisional" unless both games are leaders. M = 1 stays "consider".
- **D3 Core-loop exemption and protected screens**: should the core loop be found automatically (our main gameplay kind) or declared per project? Protected screens are always declared by you.
- **D4 Category switch** (Comfy Puzzle to Board): recommend it, or only flag it?
- **D5 Brand colour**: is our band colour protected from RE-LAYER, unless the evidence is strong with 3 or more games?
- **D6 Backfill new attributes**: pay the estimate above, or new images only?
- **D7 Tablet sets**: analyse them, or just issue "mirror the phone deck"?
- **D8 AI objections**: shown only (proposed), or auto-applied when the reviewer agrees?
- **D9 Tags**: confirm the Play Console tag limit and which chips are developer-selected before tag directives go live.

## 12. Review (gpt-5.6-sol, one round, 2026-10-30)

20 findings were returned. 19 were applied, in full or in part; 1 part was declined.

Applied:
1. M = 2 unanimity without both leaders is "provisional" (5.2).
2. Leaders are defined within the competitor set, at ≥ 20 % of the top game's installs or in the grossing top 10, not relative to ours (5.2).
3. One leader policy for screenshots and metadata, plus the no-data case (5.2).
4. **Partly**: a user-declared protected list was added to DROP. **Declined**: a "low strategic value" second condition, because the user's rule is that unused types go, and the safeguards are the protected list and the mandatory replacement (5.3-2).
5. The deck builder allocates replacements together, uniquely and position-compatibly (5.3-2).
6. COPY spec fields are required or optional, each with its source and agreement count, and "not measured" is allowed (5.3-1).
7. KEEP is split into supported / no signal / review (5.3-10).
8. The verdict uses structural triggers and weighted rank; metadata and tests are excluded (5.3).
9. Metadata counts unique games; tags are app-level; image and text evidence are kept apart (5.7).
10. Tags are candidates until D9 is verified, and a replacement order for full tag slots was added (5.7).
11. Category is a decision card with confound notes and never touches the skeleton (5.7).
12. Grounding checks: safe-zone text budget, localisation overflow, elements that exist, and theme/focus consistency. Contrast comes later (5.6-8).
13. A/B tests return a structured delta, which code checks (5.5).
14. REORDER uses position bands (5.3-5).
15. The LENGTH rule is explicit about the median, rounding and filling (5.3-4).
16. The tablet item is a note, not a directive (C13).
17. Metadata checks are byte- and grapheme-aware, with vocabularies, repetition and trademarks (5.6-7).
18. 13 synthetic edge cases were added to the regression set (section 8).
19. C14 is counted per game; C17 counts are made by script.
20. The cost estimate was raised for full specs, and the operational scope was noted (section 9).

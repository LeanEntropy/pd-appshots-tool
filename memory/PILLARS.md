# Pillars — long-term facts and directives

Evergreen only. Session-by-session notes go in `memory/YYYY-MM-DD.md`.
Update this file when a fact or directive changes; don't append history here.

## Goal (V1)
A tool that pulls competitors' Google Play screenshots per country, analyses them in depth, and recommends
exactly which screenshots Rogue Legends should use per locale.

Output per locale:
- the screenshot order;
- the exact in-game screen to capture for each position;
- a full marketing-layer spec for each position;
- translation and genre-lingo notes;
- a comparison against our current images.

## Product principle
- We are building a reusable, config-driven TOOL, not doing the research by hand.
  - It may run as a repo operated with Claude Code: deterministic scripts plus Claude Code skills, commands and agents for the AI steps. A fully standalone CLI is not required. Claude Code agents build the tool; the tool does the research.
- It must be game-agnostic: game ID, competitors, countries, charts, category and taxonomy all come from config. Rogue Legends is the first config.
- Deterministic code wherever possible. The LLM is used only where judgement is truly needed, called by the tool through a pluggable provider (Claude or OpenAI) with versioned prompts and Zod-validated output.
- Don't reinvent the wheel. Reuse existing projects and libraries wherever they fit, respecting licenses.
  - The candidates are in `reports/Game store screenshot analysis tools.md`.
  - Custom code only for the glue and the novel parts: the taxonomy, deck and consensus analysis, and the recommendations.
- Re-runnable and incremental: a content-addressed cache, snapshots over time, and user feedback fed back in.

- **Scale:**
  - The CORE check is capped at 80–100 AI-analysed images, total, including our own. It must produce good recommendations within that. If it can't, the tool is useless.
  - Expansions beyond the core are the user's choice, with no fixed cap.
  - Before processing any step, the tool MUST show the user how many images it will process, and get approval.
- **Expanding-circle workflow**, the core product design, set by the user on 2026-09-26:
  1. **Core check:** 5–8 competitors in English only (plus our own). Establish the pattern and give a first recommendation.
  2. **The tool then ASKS the user how to expand:**
     - more English competitors; and/or
     - other countries, which the user picks with checkboxes.
  3. **Each expansion is a separate, user-approved increment** within the budget.
- Competitors mostly reuse the same screenshots across countries, changing only the marketing layer (text).
  - Localisation analysis = compare the marketing layer and text against the English version of the same screenshot, found deterministically. Never re-analyse the whole image from scratch.
- **Cost tiers per image**, checked cheapest first:
  1. Identical to English (file or hash match, by code): no AI; reuse the English analysis.
  2. Same capture, different marketing layer (by code): send only the cropped band/text regions plus the English analysis, and ask for the diff. A lighter model is OK here.
  3. Different screenshot: full analysis with the strong model.
  - Also:
    - crop and resize to the model's needs;
    - analyse a whole deck in one call where possible;
    - stop the core check early once the pattern is stable;
    - translation and lingo work on text only.
  - Before each step, show the count per tier and wait for approval.
- **Plan v2 approved** (2026-09-27, `docs/plan-v2.md`), with these settings:
  - The user picks the core competitors in the tool's interface; they are not fixed in config.
  - Early-stop rule and review coverage are adjustable parameters. Early stop after ≥5 decks, when 2 decks in a row change nothing and no share moves more than 10 points. Image review by GPT is currently PAUSED by the user (coverage 0) until they say resume.
  - Core cap: 100 hard stop, aiming for ~85. Budget ceiling per expansion: $30, adjustable.
  - The PSD reader is psd-tools. It's optional; it gives exact facts about our current marketing layer.
  - Each game project keeps its own image database, so an identical image is never analysed twice.
- When the budget runs out, drop the lowest-priority competitor/country combinations first.
  - Cheap, deterministic steps come first: dedup across locales, and detecting identical images. Localised variants only need their text read.
  - Chart games are shown raw and not analysed unless the user picks them.
  - The cap is enforced in config as a hard stop.

## Our game
- Rogue Legends: `com.pockethaven.roguelegend` (Google Play).
- Own assets: `rogue-legends_current/` contains screenshots and a layered PSD. Read-only source material.
  - The same PSD and screenshots are used on both Google Play and the App Store. The PSD's `_APPLE STORE` name is irrelevant.
  - The "no_marketing_layer" images still contain text and bands. The user can capture any in-game screen on request.
- V1 output is text and instructions for the user to review: which screen to capture and a marketing-layer spec per position.
  - Delivered as a Claude Artifact: a rich HTML page with text and images.
    - It includes ALL collected and analysed screenshots as references.
    - It has feedback built in: per-item ratings and notes in the artifact db, plus comments. That feedback feeds the next iteration.
    - The HTML is built by a deterministic generator script from the analysis JSON.
  - Local copies are first-class and the source of truth. Everything stays on disk in the project: all images, all analysis JSON, and markdown reports that reference local images by relative path. The Artifact is a published view built from the local data.
  - No image generation in V1.
  - No integration with the Unity game project.

## Scope
- Google Play only in V1. App Store deferred.
- Markets: Asia, with localized store pages per country. Taiwan represents China.
  - Default set: JP, KR, TW, HK, TH, VN, ID, PH, with US-English as the baseline.
  - HK uses zh-TW (zh-HK probed at M1). PH uses en only.
- Competitor pool:
  - the named competitors below;
  - the **top 10 grossing** games in our Play category per target country, deduplicated.

## Competitors
- Direct competitors (not very successful yet): Capybara Go, Mini Tales, Heroll.
- Same audience: Archero 2, Survivor.io (`com.dxx.firenow`), Dicero, BagMaster Isekai (`com.DoorTeam.BagMaster`), Overgeared Hero, Legend of Mushroom (parent of Capybara Go), Legend of Slime.
- Large reference games: Clash of Critters, Sword x Staff, Whoa Adventure, Path of Kings.

## Analysis requirements
- Screenshot order comes from the store data. The AI never infers it.
- Screen type uses a detailed taxonomy, e.g. title/key art, gameplay: battle, gameplay: victory, metagame: progression, metagame: character list.
- For each screenshot's marketing layer, record:
  - band colour, size and style;
  - the exact text;
  - any adjacent character or item and what it is;
  - how the layer relates to the underlying screen.
- Translation analysis: compare English and local text, capture genre terms and lingo, and flag unlocalized pages.

## Working directives
- The main session is an orchestrator only. It delegates all task work to subagents and stays available to the user.
- Right-size the model per task:
  - Haiku for mechanical work;
  - Sonnet for research, tooling and moderate analysis;
  - Opus for planning, architecture and final synthesis;
  - Codex CLI (OpenAI) for GPT-family work and cross-family reviews.
    - Exact model names: gpt-5.5, gpt-5.6-sol, gpt-5.6-luna, gpt-5.6-terra, gpt-6-astra. The catalogue is in `~/.codex/models_cache.json`.
    - Invocation: `codex exec -m <slug> -s read-only --skip-git-repo-check --ephemeral -i <img> --output-schema <schema> --json -o <out> "<prompt>"`.
    - Plan, code and document reviews: gpt-5.6-sol or gpt-5.6-terra ONLY. NEVER gpt-6-astra (user directive).
    - Screenshot review: gpt-5.6-sol (10/10 on screen type in the test). Astra only for special cases. Terra is unsuitable as a reviewer (it mislabels banded screens).
- User's model constraints (2026-09-26):
  - NO Sonnet for screenshot analysis; the user considers it the weakest Claude model.
  - Haiku only for tasks of zero importance.
  - GPT-6 Astra is very token-expensive: use it only for special or high-value tasks, e.g. image-analysis review.
- Repeating technical tasks become deterministic scripts or tools, with no LLM involved. LLM effort only where judgment is needed.
- Stack follows the global rules: TypeScript strict, Biome, 300 lines max per file.
- The analysis spec is `docs/analysis-requirements-user-2026-09-27.md` (authoritative):
  - each image analysed on 2 layers and saved immediately;
  - store order saved per game per date;
  - patterns across competitors, and ours compared against them;
  - full recommendations.
- Store images can be composites: a landscape marketing image containing portrait captures, or several captures in one image (common in Asian decks). The analysis supports 0..N captures per image plus a composition type.
- Anything measurable from pixels (orientation, size, aspect ratio, dominant colours) is computed by code for EVERY image and never marked "not applicable".
- Before any AI step, the UI shows exactly which images will be analysed, per game, visually marked, with counts. The approval panel must be unmistakable: highlighted, scrolled into view and focused.
- UI is split into separate pages or tabs with a clear, colourful menu (Overview, Competitors, Screenshots, Analysis, Report), not one long page.
- Report format: `docs/report-requirements-user-2026-09-28.md` (authoritative):
  - a table of contents;
  - the verdict and key optimisation points first;
  - patterns (including order), each marked as fits or different;
  - a position table: row N = everyone's Nth image, ours first;
  - recommendations.
- Title screen / full-screen art is ONE category (user, 2026-09-28): the difference is often unclear, so never split by logo. Studios upload the title screen clean (no "Tap to start", no loading bars). Logo presence is NOT a category but IS a first-class attribute tracked on every image (per position and deck) that drives patterns and recommendations, so we know whether our images should carry the logo; images in this category are compared by message (logo only, headline or benefit, event or offer, character showcase).
- NEVER claim an image is "not from the game" or has "no in-game screenshot". Any art screen may be the game's title, loading or splash screen. Describe what is visible instead.
- The report ALWAYS includes the deterministic content (exact store order per game, position-by-position comparison, pattern stats with n, ours vs patterns), even if AI synthesis is missing.
- EVERY button or action gives immediate on-screen feedback:
  - a busy state (disabled button, spinner, "Working…" text);
  - progress for anything longer than a second;
  - a clear success or error message;
  - the view updates when it's done;
  - never silent.
- UX rules:
  - always show live progress ("Analyzing image 5 / 80");
  - runs are resumable and never re-analyse;
  - a final report at the end;
  - an (i) icon with hover details on every analysed image.
- The image and analysis database is SHARED ACROSS PROJECTS: the same image is never downloaded or analysed twice, even for different games' projects.
- Project-setup plan approved on 2026-09-27 (`docs/plan-project-setup.md`, D1–D6 as proposed).
- Store history per game (future):
  - When a game's store images or order change, keep the old images in an ARCHIVED state with all their analysis data, their position, and the deck they belonged to (the other image IDs, in order).
  - Update to the new images and order, and keep a CHANGE LOG per game (added / removed / moved / replaced, with dates).
  - Store data is refreshed ONLY inside a user-triggered project action. Never automatically or in the background.
- For every game processed, store its category, tags and store text (title, short and full description) per country-language per date, plus keywords derived deterministically from that text. Google Play has no official keywords, so derived keywords are labelled as such.
- Terminology per country: compare the exact local words games use for the same concepts ("battle", "play", "hero", "upgrade"…) in their marketing layers and store text, per country, and show where our wording differs from the common term.
- Report voice: every report is written as a Chief Marketing Officer who is expert in optimising game store pages for discoverability, ASO and page-view-to-install conversion. Every report ends with concrete A/B tests to run next: hypothesis, the evidence behind it, the exact variant (image order and internal structure of each image, e.g. a landscape composite for Asia), the metric, and priority.
- Bottom line first, in every report and communication: the top summary holds the TL;DR, key recommendations and the A/B tests to run; the details follow.
- A SETTINGS page inside the tool lets the user control the parameters: review on/off per AI step, early-stop values, suggestion thresholds, budget limits, models, etc. No config-file editing.
- Main country: user-selectable per project (default US). The Pilot always runs on the main country. After the Pilot, EVERY report type is open. A Full check of the main country is HIGHLY recommended (a builder warning with its cost) but not a blocker; reports built on Pilot-only data say so.
- Priorities: reports and analysis quality come FIRST. PDF export is low priority (basic version only for now).
- Report quality bar (user, 2026-09-28): every report must be meaningful, to the point, actionable and insightful. Neither bloated nor too thin on details. Each claim ties to evidence and to a concrete action. Judge every report change against this bar before PDF or other polish.
- Explain every classification (user, 2026-09-28): any image type or category a report uses (e.g. title image vs feature image) must be explained where it appears: a one-line plain definition, what sets it apart, and an example thumbnail, plus a short "How we sort images" part in each report. A difference the user cannot see explained must not drive a finding.
- Store titles (user, 2026-09-28): a two-part store title "[game name] - [ASO words]" or "[game name]: [ASO words]" (also full-width ：, –, |) means the second part is ASO keywords, very likely NOT in the in-game logo. Match logos/brand against the first part only; treat the second part as keyword data for the store-text/keyword analysis per country.
- Multiple reports per project: pilot, full, single-country, and multi-country comparison (chosen countries and competitors). All are listed folded in the Report tab, and each can be exported to PDF. Planned in `docs/plan-reports.md`.
- Sharing without a website (planned milestone 3b): "Share project" exports one zip (Full / Core only / Light / Report only, with the size shown first; Light carries analysis-sized copies, D7 decided 2026-09-28), and the friend uses "Import project" (incremental). No live shared sync folders.
- Web-readiness rule (not building web now): keep AI providers, storage and jobs each behind one interface, so a hosted website is cheap later. No direct filesystem calls from feature code.
- Multi-project: the user creates projects in the UI (own game plus competitors, Google Play only in V1), can work on several games, and can resume any project mid-work.
- The tool must never make the user move or handle files. Every choice made in its UI is saved by the tool automatically (e.g. a local server with autosave).
- User-facing text (chat, pages, reports) uses plain descriptive names, never internal codes like S6, L1 or F8.
- Plan first. Only small or obvious tasks skip planning. Everything else follows this flow:
  1. Plan.
  2. Cross-family review of the plan.
  3. User approval.
  4. Implement.
  5. Cross-family review of the implementation.
- Plans are always AUTHORED by Claude models (Opus). GPT models only REVIEW plans; they never write the initial plan.
- Cross-family reviews:
  - Claude's output is reviewed by a GPT-family model via Codex CLI; GPT output is reviewed by Claude.
  - Avoid same-family reviews.
  - Reviews cover plans, code, prompts/schemas and analysis outputs (e.g. screenshot classifications and the final recommendation).
  - The reviewer gets the artifact plus the requirements, and returns concrete findings. The orchestrator decides on fixes, and asks the user when there is a disagreement that matters.

## Repo
- GitHub: https://github.com/LeanEntropy/pd-appshots-tool (private), remote `origin`, branch `master`.
- Commit AND push after every major stage (a milestone merged, a plan finalised, a significant fix), with tests passing. Standing instruction from the user, 2026-09-28.

## Key references
- Tool landscape research: `reports/Game store screenshot analysis tools.md`, with notes in `research_notes/`.
- UI layout (user, 2026-09-29): optional panels (e.g. Suggested next research) start folded. Offer/suggestion cards are light-background boxes laid out side by side as width permits. Flags ONLY next to a country name in titles/headings, never in running text (real flag images; Windows can't render flag emojis). Cards must not be packed: title, one short line, a cost/status chip, one main button; details behind a disclosure. Offering a multi-country report lets the user add countries from a list; added countries are saved to the project and their images are fetched (free, with a confirm step).
- Games library (user, 2026-09-29): a directory page (every game's list and details only) plus a game page (screenshots, store text, analysis). A nice-to-have, scheduled LAST, after everything else. Plan: docs/plan-games-library.md.
- Reports tab visual style (user, 2026-09-29): style "A · Tinted bands" — no side bands, no nested boxed cards; sections as full-width soft-tinted bands by kind, open report with a dark teal header band, verdict as big coloured word, items as rows with dividers. Top bar and tabs of the tool stay unchanged. Mockup: artifact https://claude.ai/artifact/XpWWEUZj5GHz7LDc9X8nCj

# Plan: AI brief download (BRIEF.md + reference images zip)

Status: plan v2 (2026-10-30), after one gpt-5.6-sol review. Author: Claude Opus. Awaiting the
user's approval; nothing is implemented.
Sample built from real data: Comfy Mahjong Pilot (see "Sample" at the end).

## Goal
One click on a report's recommendations downloads a zip that an image-generating AI agent (for
example one driving gpt-image) can work from without the tool. The zip holds `BRIEF.md`, with
everything to fix and every image to deliver, plus `refs/NN-<slug>/` reference pictures per image.
- It is built by code from the saved report data: no AI call, no cost, the same bytes for the same
  version.
- Missing data is stated in the brief, never invented.

## Buttons
- **Report > Recommendations** (Pilot, Full check, App Store Full check): **Download AI brief
  (.zip)** and **Download BRIEF.md only**, next to "Copy all prompts" in `recsHtml`
  (`src/view/gallery-report-parts.ts`).
- **Country decks** (`adviceOne` in `src/view/report-country.ts`, in country and compare reports):
  the same two buttons after the deck's prompt buttons. They cover that country.
- Not on the print page.
- Feedback: the button shows "Building the brief...", fetches the file, then saves it through a
  blob link and shows "Saved <name> (4.1 MB)", or the server's error. A failed or partial response
  is never reported as saved.

## Server
- Two GET routes, matched next to `PROMPTS` in `src/server/routes-reports.ts`, with the same
  id regexes:
  - `.../reports/<rid>/versions/<vid>/ai-brief.zip?gl=xx`
  - `.../reports/<rid>/versions/<vid>/ai-brief.md?gl=xx`
  - `gl` must be `^[a-z]{2}$` or empty. No path or file name ever comes from the request.
- `pick` and `VersionBody` move from `image-prompt-api.ts` into a small shared module
  `src/server/report-pick.ts`, used by both features. This is a pure move.
- Links:
  - `withPromptLinks` adds `aiBrief` (the base address) next to `imagePrompts`.
  - The main deck's link sits on `data`.
  - A country deck's link sits on its `advice[]` entry only, which is where `adviceOne` reads it.
  - Tests cover the main country, a second country, a compare report and a country without advice.
- The zip uses `yazl`, already a dependency (Share project uses it). No new package.
  - The zip is built in memory (a few MB) and checked before any header is sent.
  - Pictures are stored uncompressed; the text is deflated.
  - Entries are in a fixed order, and every entry gets a fixed mtime: the version's `generatedAt`.
- Response headers:
  - `Content-Type`: `application/zip` or `text/markdown; charset=utf-8`;
  - `Content-Length`;
  - `X-Content-Type-Options: nosniff`;
  - `Cache-Control: no-store`;
  - `Content-Disposition: attachment` with an ASCII file name: slug + date, no quotes or CR/LF, for
    example `comfy-mahjong-solitaire-play-us-ai-brief-2026-10-29.zip`.
- Reading image bytes:
  - Every picture is resolved from an image id taken from the report rows on the server.
  - Library projects go through `libraryImageKey` (`src/library/serve.ts`), which checks that the
    project's `refs.json` / `refs-appstore.json` holds the image.
  - Projects not on the library go through the project image db (`images/db.json` `file` entry)
    under `projectKey(..., "images", ...)`.
  - All reads go through `Storage`, never raw fs. An unknown id is skipped and listed as a gap.

## Code (each file under 300 lines; extend, don't duplicate)
- `src/reports/image-prompt-facts.ts` (extended): `sourcePosition(rec)`, a typed resolver.
  - Main recommendations: it reads only the known source phrases, "keep our current position K",
    "recapture our position K" and "moved from K".
  - Country decks: it uses the typed `fromMainPosition`.
  - Anything else gives `null`, and the brief lists it as "source image not identified".
  - `promptSlots` also skips our rows outside the analysed set (`state: "excluded"`, e.g. tablet
    pictures) as "current image".
- `src/reports/ai-brief.ts`: gathers `BriefInput` from the slots and the version, picks the
  references, and decides the work type per image.
- `src/reports/ai-brief-md.ts`: renders BRIEF.md, including the image-model prompt. It reuses
  `countLine`, `storeRules` and the slot facts.
- `src/server/ai-brief-api.ts`: the routes and the zip.
- `src/view/image-prompt-ui.ts` (extended): the two buttons and the download handler, next to the
  prompt buttons.

## Work type per image (decided by code, drives the whole section)
| Type | When | What the agent does |
|---|---|---|
| keep | source is our current image at the same position | deliver our file unchanged |
| move | source is our image K, and the spec's headline equals its current headline | deliver our file K unchanged |
| edit | source is our image K, with a different headline or band | new marketing layer on our image |
| rebuild | "recapture our position K" | our own art, new composition or orientation |
| new | "new capture" | blocked until the team supplies the capture; the prompt is for the marketing layer over it |

The summary counts them ("6 images: 2 to make, 4 reused unchanged"). Keep and move images get no
generation prompt, only "deliver `refs/...` as `NN.png`".

## BRIEF.md (one country and language per brief)
1. **Header**:
   - game and package id, store, country, page language;
   - the source report and its version date (a live view says "live view, recommendations from
     run <runId>");
   - store and analysis dates;
   - competitor count, marked as a small sample when it is under 5;
   - the zip size;
   - "made by code, no AI".
2. **Read this first**:
   - Use our real screens and art.
   - Never invent gameplay, levels, UI, characters or features.
   - Competitor images are style references only. Never copy their art, characters, logos or
     wording.
   - If a capture is missing, ask for it.
   - The only added text is the given headline.
3. **Summary**:
   - the bottom line (`summary.shortAnswer`, `fit.keyPoints`, the worst `oursVs` positions);
   - images needed, by work type, with the output name, orientation, exact pixels and aspect for
     each;
   - what is NOT covered: excluded device sets with our current counts and sizes (for example 4
     tablet images at 1600 x 2560), iPad, and other countries;
   - why the deck stops where it does, when the recommendation says so.
4. **Recommended order**: a table of position, purpose (screen type and subtype), category, what
   the screen shows, source, work type, headline (local), English meaning and logo.
5. **One section per image**:
   - **(a) Screenshot layer**: the base file, what it must show and the action. Also our current
     image at that position and what is wrong with it (the `oursVs` reasons, format gaps and focus
     mismatch). A tablet or unanalysed image is named as such and not used.
   - **(b) Marketing layer**:
     - band or mask shape, colour and place;
     - the headline exactly, in the page language, with its English meaning (country line), style,
       fill and outline;
     - extra elements with their place and pose;
     - character and pose, only when the spec or capture names one;
     - logo yes or no, and why;
     - colours, mood and feel;
     - a **wireframe in words**: the measured boxes (as % of the canvas) of the base image's saved
       layout when the layout is kept, else the spec's placement in words, marked "not measured".
   - **(c) Format**: orientation, exact pixels, aspect, layer structure, file format, safe areas.
     On the App Store, positions 1–3 must read at search-result size, and title art carries the
     note on guideline 2.3.3.
   - **(d) Generation prompt**: one fenced block for the image model, covering:
     - size and orientation;
     - the base file to edit;
     - the scene, mood and palette;
     - the marketing layer with the exact text;
     - per-type rules: "rebuild" removes the old band and extends only scenery already in our art;
       "new" means "do not draw the game screen";
     - what to avoid.
   - **(e) Reference images**: a table of relative path, role, what to take from it and what NOT to
     copy, each line built by code from the image's facts.
   - **(f) Checklist**: size and format, real base, exact headline, logo rule, banned words, focus
     reinforced, consistent set.
6. **Keywords and language**:
   - Words to use with their status, from the country advice `words` block. When a report has
     none, the brief says "not in this report type".
   - The headlines per position.
   - Our store title, split into the name and ASO words.
   - The short description and category.
   - The derived keywords (labelled "derived; Google Play has no official keywords").
   - Each competitor's title and keywords.
   - The terms competitors use that we don't (`storeText.missing`).
   - Store text comes from the selected version only. For a live view it comes from the latest
     saved version of the same report, with that version's date. When neither exists, the section
     says "not available".
7. **Store rules**: the hard rules and review risks from `storeRules`, with the knowledge base's
   wording when it is present. The brief names the knowledge-base check date, because that wording
   can change. Snapshotting it is declined; see the review notes.
8. **Data gaps**: every fact the brief could not fill, with the reason.

Multi-country (compare) reports: one brief per country deck, from that deck's buttons.

## Reference pictures (`refs/NN-<slug>/`, at most 7 per image)
Priority order, with duplicates removed by image id:
1. The base and deliverable: `ours-base-pK` or `ours-current-pNN` at **full size** (the original),
   because its pixels become the output. It is missing only when the work type is "new".
2. `ours-screen-pK`: for "new" and "rebuild" only.
   - Rogue Legend's own clean captures matched to a live position (`own/own-assets.json`, match
     other than "no-match"), read through the tool root.
   - Otherwise up to 2 of our analysed store images of the same screen type, as model-size copies,
     marked "real UI look only, never a new board state".
3. `comp-<game>-pNN`: for images to make only (edit, rebuild, new), up to 3. Ranked by: same
   position, same orientation as the target, same screen type, then the report's `examples`. One
   per game; excluded rows never.

File variants:
- Competitor and screen references use the model-size copy (long edge 1568 px): in the library
  `model/<sha>-1568.jpg`, else `model/<sha>.jpg`, else the original.
- A thumbnail is used only when nothing else exists. It is then named `*-preview-lowres.webp` and
  flagged.

Entry names:
- `refs/NN-<slug>/<role>-<gameSlug>-pNN.<ext>`.
- Slugs are `[a-z0-9-]`, at most 40 characters. The extension comes from the stored file type.
- Name collisions get `-2`, `-3`.
- Every entry is asserted to sit under `refs/`.

## Stores
- **Google Play**: 1080 x 1920 or 1920 x 1080; PNG or JPEG; no alpha.
- **App Store**: 1290 x 2796 or 2796 x 1290 (iPhone 6.9-inch).
- **Tablet and iPad sets**: listed under "not covered", with our current counts.

## Tests
- Markdown from fixtures for each work type, with a country line (local headline and English) and
  a missing spec. Every gap gives a "not available" line.
- `sourcePosition` for each known phrase, and `null` for prose it doesn't recognise. Excluded
  tablet rows are never used as current or base.
- Refs: priority, the cap of 7, full size for the base, model copies for the others, the preview
  flag, the ownership check, collisions, and slug safety (`..`, `/`, non-ASCII game names).
- Play and App Store differ in size and rules, including the 2.3.3 note.
- A zip round trip with `yauzl`: entry order, fixed mtimes, the same bytes on two builds, every
  listed reference present.
- Routes: 404 for an unknown report or country, 405 for anything but GET, and the headers.

## Checks before done
- Typecheck, `npx biome check .` and `npm test`.
- Rogue Legend Full check and Comfy Mahjong Pilot built on a workspace copy, with a server on a
  spare port.
- Read each BRIEF.md as the image agent would.
- New routes need a server restart.

## Review notes (one gpt-5.6-sol review, processed)
Applied:
1. Determinism: fixed mtimes and order; dates from the version.
2. Store text from the version only. No live library fallback.
3. A typed source-position resolver, and "not identified" otherwise.
4. Excluded tablet rows are never used as current or base images.
5. The cap is raised to 7, with an explicit priority order.
6. Bytes are read only through the refs/db ownership check.
7. Zip entry-name safety.
8. Full headers, and the zip is built before sending.
9. `pick` moves to a shared module.
10. One canonical link per deck, with tests.
11. Each field's source is named, with a gap line when it is missing.
12. Fewer new files: 3 new and 2 extended instead of 7.

Declined in part (finding 1): snapshotting the knowledge base's wording. The existing prompts use
the same live official wording, and a rules change should reach the brief. The brief names the
knowledge-base check date instead.

Added after reading the sample as the image agent:
- the work types, so that reused images get no generation;
- the base image at full size, since it is the output's pixels;
- no competitor references for reused images;
- references ranked by orientation;
- the "rebuild" rules, which remove the old band and extend only existing scenery.

## Open questions for the user
1. Multi-country: one brief per country deck (as planned), or also one "all countries" zip?
2. Tablet and iPad: list them as "not covered" (as planned), or add sections made from the phone
   spec?
3. Reused images: the zip holds full-size copies so the agent can deliver all `NN.png` files (Comfy
   sample: 8.6 MB, of which 7.3 MB is our own PNGs). Fine, or should reused images be referenced
   by name only?

## Sample
`sample-BRIEF.md` and `sample-refs.json` in the session scratchpad (`ai-brief/`). Built by a
read-only prototype script from a copy of the Comfy Mahjong workspace and the live Pilot view.

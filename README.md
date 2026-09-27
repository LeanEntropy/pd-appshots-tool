# Store Screenshot Recipe

A config-driven tool that collects Google Play screenshots of a game and its competitors, per country,
and (in later milestones) analyses them to recommend which screenshots the game should use.

This repo holds the tool only: code, configs, taxonomy and prompts. Run data (images, analysis,
reports) lives in the gitignored `workspace/` folder. The plan is in `docs/plan-v2.md`.

## Status

Setup milestone done. Core analysis built to the user's spec
(`docs/analysis-requirements-user-2026-09-27.md`): each image is read on two layers (screenshot and
marketing layer) by Fable 5.1, cross-checked by gpt-5.6-sol, disagreements settled by Opus 5.5, and
saved immediately by content hash (never analysed twice; interrupted runs resume). Then, by code:
store order per game per date, patterns across competitors, and our game vs the patterns; Opus
summarises the patterns and writes the recommendations, which gpt-5.6-sol checks. The final report
is shown in the gallery and saved as markdown plus JSON. Nothing is sent to a model
without an explicit approval of the numbers shown first. Only phone-shaped screenshots are analysed
by default (`core.deviceClasses`); tablet-shaped ones are kept and shown greyed out.

## Requirements

- Node.js 22 or newer
- Optional: Python 3.10+ with psd-tools, to read exact facts from our layered PSD
- For later milestones: the `claude` and `codex` command-line tools, signed in

```sh
npm install
# optional PSD reader
python -m venv .venv
.venv/Scripts/python -m pip install -r tools/psd/requirements.txt   # Windows
.venv/bin/python -m pip install -r tools/psd/requirements.txt       # macOS / Linux
```

## Usage

All commands take `--config <file>` (default `configs/rogue-legend.json`). With npm, pass options
after `--`, e.g. `npm run download -- --yes`.

| Step | Command | What it does |
|---|---|---|
| Host check | `npm run doctor` | Node, Python, PSD reader, disk space, and a one-word prompt to each configured Claude and Codex model (`-- --skip-ai` to skip those) |
| Download preview | `npm run preview` | Reads store pages and charts, then shows how many store pages and images would be downloaded and the disk space. Downloads no images. 0 AI calls |
| Download | `npm run download` | Shows the preview again and asks for approval (type `yes`, or pass `-- --yes`). Downloads full-resolution screenshots politely, with a cache |
| Our assets | `npm run own-assets` | Matches the local files in the assets folder to our live deck (reference only) and reads the PSD if psd-tools is installed |
| Raw deck view | `npm run deck-view` | Writes offline markdown per game and country and a read-only `gallery.html` |
| **Gallery (main screen)** | `npm run gallery` | Starts a small local server and opens the gallery: comparison grid (position N of every game in one column), competitor picker with drag-and-drop that saves automatically, and **Start analysis** (approval screen, then **Approve and run**). Run the same command to reopen it later |
| Pick competitors (fallback) | `npm run select -- --pick "Archero 2, Capybara Go, ..."` | Saves the pick from the terminal (names or package ids), or asks in the terminal |
| Analysis approval | `npm run pilot` / `npm run core` | Shows the approval screen (games and positions, images by cost level, model passes, estimated cost). No AI call. In Claude Code: `/analyze pilot` |
| Refresh analysis records | `npm run refresh-records` | Rebuilds each record's identity block (game, files, source URL, every appearance) and the taxonomy mapping. No AI call |
| Check the core size | `npm run fit` | Applies the whole-deck rule to your pick: our deck first, whole competitor decks only, within the cap |

Development: `npm test`, `npm run typecheck`, `npm run lint`.

## Where things are

```
configs/<project>.json          game config (competitors, countries, charts, caps, models)
taxonomies/mobile-rpg.v1.json   screen types and marketing-layer vocabulary (draft)
tools/psd/                      optional Python helper for the PSD (psd-tools)
src/                            TypeScript tool
workspace/<project>/            run data (gitignored)
  images/orig/<sha256>.<ext>    every image stored once, named by its content hash
  images/thumb/<sha256>.webp    240 px thumbnails
  images/db.json                image database: hashes, perceptual hash, size, device guess, where seen
  decks/<app>/<country>-<lang>.json   store order per game and country, pointing to image ids
  runs/<run id>/manifest.json   immutable record of each download or analysis run
  analysis/<sha256>.json        per-image analysis (both layers), saved as soon as it is done
  objects/                      every model answer, cached by its full input
  orders/<app>/<gl-hl>/<date>.json   store order per game per date, with screen types
  reports/<run id>/report.md    final report (+ patterns.json, ours-vs.json, recommendations.json, review.json)
  pending/analysis-status.json  last analysis status (shown in the gallery after a restart)
  own/                          our local files matched to the live deck, PSD facts
  views/index.md, views/decks/  offline markdown
  views/gallery.html            raw deck gallery with the competitor picker
```

## Notes

- Google Play repeats each screenshot in its data (often 3 times). The tool removes repeats and keeps
  store order. Full resolution comes from the `=s0` image URL.
- A store page that is not available in a country is recorded as "not available", not as an error.
- Identical images (same bytes) are stored and, later, analysed once, whichever game or country they
  appear in.
- The gallery can later be published as a private claude.ai page that stores the pick in its page
  database. Until then, the "Save selection" button downloads `selection.json`; put it in
  `workspace/<project>/` and run `npm run select`.

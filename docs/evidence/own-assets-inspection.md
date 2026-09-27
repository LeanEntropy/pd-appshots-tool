# Rogue Legends store asset inventory

Source (read-only): `C:\projects\ai\pd-appstore-tool\rogue-legends_current`
Scratch/tools: `C:\Users\User\AppData\Local\Temp\claude\C--projects-ai-pd-appstore-tool\9b150f72-d30c-4d72-a5fa-2d1770596957\scratchpad\assets-inspect`
(venv with psd-tools + Pillow lives there; `psd_tree.txt` is the full PSD layer dump)

## 1. File inventory

```
rogue-legends_current/
├── _APPLE STORE.psd                                    116.4 MB   canvas 1080x1920, RGB
├── base_screenshots_no_marketing_layer/                 (6 files, all JPEG, 739x1600, RGB)
│   ├── battle_boss.jpeg                    256.1 KB
│   ├── battle_regular.jpeg                 218.6 KB
│   ├── level_up.jpeg                       233.2 KB
│   ├── maps.jpeg                           364.9 KB
│   ├── player_character_profile.jpeg       265.1 KB
│   └── roster.jpeg                         284.7 KB
└── base_screenshots_plus_marketing/                     (5 files, all JPEG, 900x1600, RGB)
    ├── battle_boss_w_marketing.jpeg            321.7 KB
    ├── battle_regular_w_marketing.jpeg         315.5 KB
    ├── maps_w_marketing.jpeg                   407.4 KB
    ├── player_character_profile_w_marketing.jpeg 283.5 KB
    └── roster_w_marketing.jpeg                 346.1 KB
```

Two flat folders, no subfolders. All raster assets are JPEG. "Clean" folder images are 739x1600 (portrait ~5.5:12); marketed images are wider, 900x1600, because the marketing character art is drawn bleeding past the right edge of the game capture — the marketed JPEGs are simply a wider canvas, not a crop of the same frame.

## 2. IMPORTANT — folder names are misleading

- Files in `base_screenshots_no_marketing_layer/` are **not raw/clean game captures**. Every one of the 6 files already has the bold "diagonal band + headline" marketing text baked in at the bottom (just without the large hero/monster cutout character art). So "no_marketing_layer" really means "text-only marketing, no character art layer."
- Files in `base_screenshots_plus_marketing/` = same background/text as their content match in the other folder, **plus** a large character/monster cutout added over the band.
- **Filename correspondence is broken for one pair.** By visual content (not filename):

| plus_marketing file | actual clean-image content it's built from | headline text |
|---|---|---|
| `battle_boss_w_marketing.jpeg` | `battle_boss.jpeg` (matches filename) | EPIC BOSS FIGHTS! |
| `maps_w_marketing.jpeg` | `maps.jpeg` (matches filename) | EVERY BOARD NEW ADVENTURE! |
| `player_character_profile_w_marketing.jpeg` | `player_character_profile.jpeg` (matches filename) | COLLECT AND UPGRADE! |
| `roster_w_marketing.jpeg` | `roster.jpeg` (matches filename; this screen is actually the **pets/companions** collection, not a character roster) | FIND COMPANIONS! |
| **`battle_regular_w_marketing.jpeg`** | **`level_up.jpeg`** ("Select a Skill to learn" screen) — **NOT** `battle_regular.jpeg` | CHOOSE YOUR FATE! |

So `battle_regular.jpeg` (forest fight vs. skeleton mage, headline "BATTLE AND LEVEL UP!") has **no marketed counterpart at all** in this folder — it's an orphan. The file that is misnamed `battle_regular_w_marketing.jpeg` should really be named something like `level_up_w_marketing.jpeg`.

## 3. Marketed screenshots — content, layout, marketing layer

Store display order can't be determined from filenames (no numeric prefixes / metadata); order below follows the PSD's internal group order top-to-bottom, which is a reasonable proxy for production/export order:

1. **`battle_regular_w_marketing.jpeg`** (built from `level_up.jpeg`) — metagame / level-up screen. Shows the "LEVEL UP!" skill-choice popup (Round Bolt / Ultimate Mastery / Poison Cloud cards) over a dimmed board background. Marketing layer: gray diagonal band + **gold/amber** bottom band, headline "CHOOSE YOUR FATE!" (yellow "CHOOSE YOUR" line, white "FATE!" line, black outline, custom display font), large cutout of a white-haired vampire-lord villain character bottom-right.
2. **`player_character_profile_w_marketing.jpeg`** — metagame / gear & equipment screen. Character portrait with 6 equipped-item slots and an inventory grid below. Marketing layer: gray diagonal + **green** bottom band, headline "COLLECT AND UPGRADE!", large cutout of a blond dwarf/blacksmith character at an anvil, bottom-right.
3. **`maps_w_marketing.jpeg`** — metagame / world map screen. Triptych of three board tiles (orc dungeon, central shrine board, haunted purple swamp), diagonal seams. Marketing layer: gray diagonal + **dark blue** bottom band, headline "EVERY BOARD NEW ADVENTURE!", large cutout of a purple-haired cat-eared swordswoman character bottom-right.
4. **`roster_w_marketing.jpeg`** — metagame / pets & companions screen. Shows equipped pet diorama plus a grid of owned/unowned pet cards ("Owned Pets Bonus" stat row). Marketing layer: gray diagonal + **cyan** bottom band, headline "FIND COMPANIONS!", large cutout of a crystalline ice-dragon creature bottom-right.
5. **`battle_boss_w_marketing.jpeg`** — gameplay / boss battle. Hero fighting a large two-headed orc boss with active spell VFX, HUD (level/HP/gold/shield), ability bar below. Marketing layer: gray diagonal + **purple** bottom band, headline "EPIC BOSS FIGHTS!", large cutout of a blue crystalline rock-golem boss bottom-right.

All five share the same visual system: a gray angled band across the image, a solid color band beneath it that differs per screen, a two-line headline in a bold outlined display font (top word yellow, bottom word white, black stroke, "!" suffix as its own layer), and one oversized character/monster cutout breaking the band on the right side.

(`battle_regular.jpeg`'s content — forest fight vs. a purple-robed skeleton mage, headline "BATTLE AND LEVEL UP!", magenta/pink band — exists as a PSD template group but has no exported marketed JPEG in this folder.)

## 4. PSD layer-tree findings (`_APPLE STORE.psd`)

Full dump saved to `psd_tree.txt` (171 lines) in the scratch dir. Script used: `psd_dump2.py` (python-psd-tools + venv), also in scratch dir.

- Canvas 1080x1920, RGB, 116 MB file (multiple embedded/linked smart-object PSBs and PNGs push the size up).
- **6 top-level items**, 5 of which are per-screenshot template groups, plus one loose reference smart object:
  - `Group 4` → CHOOSE YOUR FATE! (source for `battle_regular_w_marketing.jpeg`, i.e. the level-up screen)
  - `Group 3` → COLLECT AND UPGRADE! (player_character_profile)
  - `Group 2` → EVERY BOARD NEW ADVENTURE! (maps)
  - `bossfight copy` → BATTLE AND LEVEL UP! (battle_regular — **not exported** as a marketed JPEG)
  - `boss fight` → EPIC BOSS FIGHTS! (battle_boss) — **the only top-level group set to `visible`**; all others are `hidden`. This is effectively a "which scene is currently active for export" toggle.
  - `ref` (smart object `unnamed (2).webp`) — loose reference image, hidden, not part of any group.
- **Each per-screenshot group is cleanly separable into layers**, consistently across all 5 groups:
  - **Background game capture**: a smart object referencing an `Image Sequence_0xx....jpg`/`.psb` file — the raw gameplay/UI screenshot.
  - **Band/scrim graphics**: plain pixel layers (`Layer 7`, `Layer 8`, etc.) reused near-identically across groups (same bbox `(-148,1501)-(1195,2054)` in every group) — this is the diagonal band shape, duplicated per group and presumably re-tinted per band color.
  - **Character art**: one or more smart objects referencing standalone PNGs (e.g. `vlad 1_.png`, `blacksmith.png`, `kas.png`, `ancient construct.png`). Several groups contain **multiple alternate character smart objects** (hidden) alongside the one currently visible — e.g. the `boss fight` group has `ancient construct` (visible, the golem actually used) plus hidden alternates `two headed ogre.png` and `dragom.png` (a dragon), meaning the artist had boss options and picked one per export.
  - **Text**: a nested `epic boss fight...` group per screen with 3 `type` (text) layers each — line 1, line 2, and a separate `!` layer.
- **Text layer contents & styling** (via `engine_dict`/`resource_dict`, font resolved from the layer's embedded `FontSet`):
  - Font used throughout: **`BoldenVan`** (a custom/display font baked into the PSD's per-layer font resource list, alongside fallback placeholders `AdobeInvisFont`, `MyriadHebrew-Regular`).
  - Line 1 of every headline: size ~170pt, fill `rgba(247,247,4,1.0)` (bright yellow), black stroke.
  - Line 2 + the `!`: size ~205pt, fill `rgba(255,255,255,1.0)` (white), black stroke.
  - Example: `Group 4` → "CHOOSE YOUR" (yellow) / "FATE" (white) / "!" (white).
- No adjustment layers were found in the tree (only `pixel`, `smartobject`, `type`, and `group` kinds appear).
- **Conclusion**: layers are well-organized and cleanly separable per screenshot (background / band / character / text each isolated), which makes the PSD straightforward to script against for regenerating marketing overlays — except that the "FIND COMPANIONS!" (pets/roster) screen has no corresponding group in this PSD at all, so that marketed JPEG must have been produced from a different/earlier PSD or template not present here, and `bossfight copy` (BATTLE AND LEVEL UP!) is a built template with no matching export in the current asset folder.

## 5. Tooling availability

- `python`: 3.14.0 (also on PATH as `python3`)
- `node`: v22.22.0
- `codex` CLI: installed, `codex-cli 0.153.4`

## Files in scratch dir

- `venv/` — Python venv with `psd-tools`, `Pillow`
- `dims.py` — dumps image dimensions/sizes for the store asset folder
- `psd_dump.py` — first-pass PSD layer dump (font-run parsing bug)
- `psd_dump2.py` — corrected PSD layer dump script (resolves font name + fill/stroke color from run data)
- `font_probe.py` — scratch probe used to debug the engine_dict structure for text runs
- `psd_tree.txt` — full layer-tree dump output (groups, layers, kinds, bbox, visibility, smart-object filenames, text contents + font/size/color)
- `ASSETS.md` — this report

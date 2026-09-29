# Answer-key reduction rules (layout benchmark)

Written and frozen before the paid run (docs/plan-layout-wireframes.md section 7). The answer key for each of the 4 sample images is the agent breakdown in `docs/samples/wireframe-<name>/` (skeleton.md, structure.json where present, the SVGs), reduced to the coarse layout the tool asks for (`src/layout/vocab.ts`, `prompts/analysis/layout-block.v1.md`).

## Layers
1. In-game layer = the breakdown's Layer 1 (screenshot). For full-screen art (no in-game UI) it is the painted scene.
2. Marketing layer = the breakdown's Layer 2 (everything added for the store).

## Roles
3. In-game roles: `hud` (status bars, currencies, button strips), `nav-bar` (tab bar, bottom navigation), `main-scene` (world, battle field, stage, showcase, wall or backdrop of the screen), `character` (a prominent in-game hero, unit, boss, or a showcased group of units), `panel` (list, grid, inventory, roster, shop, talent column), `dialog` (popup, tooltip, reward or result window), `game-text` (an in-game text block worth reading on its own), `other`.
4. Marketing roles: `band`, `headline`, `subline`, `logo`, `badge`, `cut-out`, `frame`, `callout`, `backdrop`, `other`.

## Reduction
5. Work top-down: every top-level container of the breakdown becomes one element with the role that describes it; its children merge into it. A child becomes its own element only when it has a different role and is a prominent part of the image (e.g. a character showcased on a stage, a tooltip over a panel).
6. Decorative details (vignettes, pillars, props, seams, sparkles, shadows, individual icons, individual damage numbers) never become elements; they belong to their parent.
7. A text that belongs to a UI element (a button label, a tab name, a tooltip's text) is part of that element (`text` on it when worth reading), not a separate `game-text`.
8. Marketing: each visually distinct band (different colour or angle) is one `band`; a dark slab directly under a band that reads as its shadow or base merges into the band. Each separate headline block is one `headline` (the main message) or `subline` (secondary message); a logo is `logo`; each placed character or item is a `cut-out`; a card or device frame around the capture is `frame`; art behind a shrunk capture is `backdrop`.
9. At most 8 elements per layer. If more remain, merge the smallest ones into the nearest element of the same role, or into their parent.
10. ids: in-game S1..S8, marketing M1..M8, numbered in draw order from the bottom (z) and then top to bottom.

## Values
11. Boxes are percent of the whole image (x, y, w, h, origin top-left), the union of the merged parts, rounded to 0.5.
12. A tilted element (tilt at least 1 degree in the breakdown) keeps the box of the unrotated element and its `tiltDeg` (negative = rising to the right). For a band whose edges have different angles, `tiltDeg` is the angle of its top edge.
13. `capture`: 0 when the image has one capture; null for full-screen art.
14. Texts: the original text exactly as in the breakdown (case, spaces, punctuation), and a reference English meaning taken from the breakdown. Marketing text lives on the headline, subline, badge or logo element.
15. Composition: `focal` is the point the breakdown names as where the eye goes first (or the centre of the dominant element), with that element's id; `readingOrder` is up to 5 ids in the order the breakdown describes; `overlaySharePercent` is the breakdown's measured marketing coverage.

## Measurements (for scoring the measuring tool)
16. For every band: `tiltDeg` of its top edge, and the y (percent) of its top edge at the image's left border (x = 0) and right border (x = 100), taken from the breakdown's measured line fits; the same for its bottom edge when that edge is inside the image (null when the band runs off the bottom).
17. `coveragePercent`: the breakdown's measured marketing coverage.
18. Experimental: `headlineGlyphPercent` (cap height of the main headline, percent of image height) and `headlineContrast` (text vs background, WCAG ratio) when the breakdown measured them; null otherwise.

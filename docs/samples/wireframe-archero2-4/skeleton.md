# Archero 2 - store screenshot 4 - structural skeleton

Source: `workspace/_library/images/orig/b799e91a...ba21.jpg`, 1242 x 2208 px (9:16 portrait). All boxes are x / y / w / h in % of the full image, origin top-left. z is the draw order inside each layer (higher = on top). Values were measured with colour-threshold scans and a 5% grid overlay; expect +/-1%.

## Summary

The underlying screen is the game's **Gear tab of the hero/equipment hub**: a theatrical showcase (six chibi units on tiered pedestals under a starry arch) fills the top half, a three-tab bar sits exactly on the image's vertical centre, and a 4-column inventory grid fills the bottom half. The marketing layer is a **lower-right corner block**: a diagonal light-blue band slabbed over the bottom ~18% of the image, a large 3D hero cut-out standing on it in the right 40%, and a two-line headline riding the band's slope. Nothing in the marketing layer touches the top half, so the showcase reads as pure screenshot while the inventory grid becomes a textured background for the message.

## Layer 1 - Screenshot (in-game screen)

| # | Element | Role | x | y | w | h | z | Note |
|---|---|---|---|---|---|---|---|---|
| S1 | Showcase stage (scene container) | container | 0 | 0 | 100 | 48.8 | 0 | Purple hall; hosts pedestals and the 6-unit roster. Top half of the screen. |
| S1.1 | &nbsp;&nbsp;Left pillar + curtain | element | 0 | 0 | 9 | 48.8 | 1 | Dark frame column; pushes the eye inward. |
| S1.2 | &nbsp;&nbsp;Right pillar + curtain | element | 91 | 0 | 9 | 48.8 | 1 | Mirror of S1.1; symmetric frame. |
| S1.3 | &nbsp;&nbsp;Central arch window (starry backdrop) | element | 18 | 0 | 64 | 40 | 1 | Bright glow behind the roster; brightest region of the screenshot. |
| S1.4 | &nbsp;&nbsp;Top pedestal | element | 37 | 12 | 26 | 4 | 2 | Small platform under S2.1. |
| S1.5 | &nbsp;&nbsp;Middle tier pedestal (wide) | element | 8 | 21 | 84 | 6 | 2 | Full-width step under S2.2 / S2.3. |
| S1.6 | &nbsp;&nbsp;Centre step | element | 36 | 29.5 | 28 | 4 | 2 | Platform under S2.4. |
| S1.7 | &nbsp;&nbsp;Bottom-left pedestal | element | 5 | 38 | 37 | 6 | 2 | Platform under S2.5. |
| S1.8 | &nbsp;&nbsp;Bottom-right pedestal | element | 58 | 38 | 37 | 6 | 2 | Platform under S2.6. |
| S1.9 | &nbsp;&nbsp;Stage floor | element | 0 | 44 | 100 | 4.8 | 2 | Dark floor strip ending at the tab bar. |
| S2 | Character roster (6 units) | container | 11 | 0 | 78 | 40 | 3 | Two interlocking triangles: 1 top, 2 mid, 1 centre, 2 bottom. Centred on x=50. |
| S2.1 | &nbsp;&nbsp;Unit: top-centre (green aura) | element | 40 | 1.5 | 20 | 11 | 4 | Aura 32/0/36/16. Apex of the arrangement. |
| S2.2 | &nbsp;&nbsp;Unit: mid-left (pirate bear) | element | 17 | 8 | 17 | 13 | 4 | Aura 11/4/28/20. |
| S2.3 | &nbsp;&nbsp;Unit: mid-right (ice queen) | element | 66 | 8 | 17 | 13 | 4 | Aura 60/4/29/20. |
| S2.4 | &nbsp;&nbsp;Unit: centre (red knight) | element | 38 | 17 | 20 | 14 | 5 | Sits on the vertical axis; weapon at 56/21/6/5. Front-most of the roster. |
| S2.5 | &nbsp;&nbsp;Unit: bottom-left (gold angel) | element | 18 | 26 | 20 | 14 | 5 | Aura 11/24/32/20. |
| S2.6 | &nbsp;&nbsp;Unit: bottom-right (dark mage) | element | 60 | 26 | 21 | 14 | 5 | Aura 54/24/33/20. |
| S3 | Tab bar | container | 0 | 48.8 | 100 | 5.7 | 6 | Horizontal split between showcase and inventory. Sits on the image's vertical centre. |
| S3.1 | &nbsp;&nbsp;Tab: Characters (inactive) | element | 0 | 49.6 | 32 | 3.8 | 7 | Dark pill, icon + label, left third. |
| S3.2 | &nbsp;&nbsp;Tab: Gear (active) | element | 33.1 | 48.8 | 33.4 | 4.9 | 8 | Yellow raised tab; exactly the middle third of the width. |
| S3.3 | &nbsp;&nbsp;Tab: Runes (inactive) | element | 68 | 49.6 | 32 | 3.8 | 7 | Dark pill, right third. |
| S3.4 | &nbsp;&nbsp;Divider line | element | 0 | 54 | 100 | 0.5 | 7 | Thin light rule under the tabs. |
| S4 | Filter bar | container | 0 | 54.5 | 100 | 7.5 | 6 | Navy strip holding two controls. |
| S4.1 | &nbsp;&nbsp;Button: By Quality | element | 1.4 | 56 | 23.2 | 3.5 | 7 | Yellow pill, left edge. |
| S4.2 | &nbsp;&nbsp;Button: Blacksmith | element | 75 | 56 | 23.2 | 3.5 | 7 | Yellow pill, right edge. Partly hidden under the hero's hair. |
| S5 | Gear grid panel | container | 0 | 62 | 100 | 38 | 6 | Inventory list; 4 columns visible, 2 rows before the band cuts it. |
| S5.1 | &nbsp;&nbsp;Grid row 1 (cells a-d) | element | 2.4 | 61.2 | 74.5 | 11.3 | 7 | Cells x = 2.4 / 21 / 40 / 59, each 17.5 x 11.3, gap ~1.5. |
| S5.2 | &nbsp;&nbsp;Grid row 2 (cells a-d) | element | 2.4 | 73.4 | 74.5 | 11.3 | 7 | Same columns; bottom ~20% clipped by the marketing band. |
| S5.c | &nbsp;&nbsp;Cell anatomy | detail | - | - | - | - | 8 | Type icon top-left (3 x 2.5), item art centre (9 x 6), rank badge 'S' bottom-left (5 x 3.5), rarity stripe. |

**Grouping and hierarchy.** Three horizontal zones stacked top to bottom:

1. **Showcase** (y 0-48.8, 49% of height): container S1 > backdrop (S1.1-S1.3) > pedestals (S1.4-S1.9) > roster S2 (six units, z above pedestals). The roster is arranged as an upper triangle (S2.1 apex, S2.2/S2.3 base) interlocked with a lower triangle (S2.4 centre apex, S2.5/S2.6 base) - all six centred on the x = 50 axis with left/right mirror pairs.
2. **Controls** (y 48.8-62, 13%): tab bar S3 (three equal thirds, active tab raised and bright) then filter bar S4 (two pills pinned to the outer edges, empty centre).
3. **Inventory** (y 62-100, 38%): grid S5, 4 columns x 2+ rows of 17.5 x 11.3 cards, ~1.5% gutters, 2.4% side margin. Every card repeats the same anatomy (S5.c).

**Reading and visual flow (screenshot alone).** Eye enters at the brightest point - the glowing arch and S2.1 - drops down the centre axis through S2.4 to the yellow Gear tab (the only saturated warm element in the UI), then scans the grid left to right, row by row. The showcase is symmetric and static; the grid is a rhythmic texture.

## Layer 2 - Marketing overlay

| # | Element | Role | x | y | w | h | z | Note |
|---|---|---|---|---|---|---|---|---|
| M1 | Diagonal band (light-blue slab) | container | 0 | 80.2 | 100 | 19.8 | 1 | Polygon (0,85)-(100,80.2)-(100,100)-(0,100). Slope ~4.8 deg rising to the right. Covers grid row 2 bottom and the floor of the inventory. |
| M2 | Band edge shadow | container | 0 | 79.2 | 100 | 1.2 | 2 | Thin dark stripe hugging the slanted edge; separates the band from the screenshot. |
| M3 | Hero cut-out (3D character render) | container | 60 | 58.5 | 40 | 27.5 | 3 | Head 62/58.5/38/17, torso 64/73/30/13, hands at 60/79 and 96/79. Drawn over the band (feet and hands overlap it). Covers grid column d and ~30% of column c, and the lower edge of S4.2. |
| M4 | Headline: 'Beyond All Limits' | container | 7 | 85 | 86 | 7.5 | 4 | Yellow display type with dark-blue outline, rotated ~-4.8 deg to follow the band. Widest element in the layer. |
| M5 | Subline: 'Deep progression, maximum fun' | container | 5 | 91.5 | 91 | 6.5 | 4 | White type, blue outline, same rotation. Sits under M4 with ~1% gap. |

**What it covers.** M1 hides the bottom ~20% of grid row 2 and everything below; M3 hides grid column d entirely, ~30% of column c in both rows, and clips the lower edge of the Blacksmith button (S4.2). Together the overlay occludes roughly the lower-right quadrant of the inventory zone. The showcase (S1/S2), tab bar (S3) and left filter button (S4.1) remain fully visible.

**How it directs the eye.** The hero's face (~x 80, y 67) is the single highest-contrast point in the image: warm skin and glowing eyes against the dark grid. From there the diagonal band and the tilt of the type pull the eye down-left along the headline (M4), then to the subline (M5). The band's slope (rising to the right) and the hero's lean form a chevron pointing back up toward the showcase, closing the loop.

## Composition

- **Aspect / grid.** 9:16. Horizontal thirds fall at y 33.3 (through the middle of the roster's lower triangle) and y 66.7 (through the hero's face and grid row 1). Vertical thirds at x 33.3 / 66.7 coincide with the tab boundaries: the active Gear tab is exactly the middle third.
- **Focal point.** Hero face at approx (80, 67) - on the lower-right rule-of-thirds intersection (66.7, 66.7), offset right. Secondary focal point: S2.4 at (48, 24), near the upper-centre.
- **Reading order.** 1 hero face (M3) -> 2 headline (M4) -> 3 subline (M5) -> 4 showcase roster (S2) top-down -> 5 tab bar (S3) -> 6 grid (S5). Marketing first, product proof second.
- **Zone split.** Screenshot-only region: y 0-58 full width (58%). Mixed region: y 58-85 (hero on the right 40%, grid on the left 60%). Marketing-dominant region: y 85-100 (band + text).
- **Area budget.** Band trapezoid ~17% of the image, hero silhouette above the band ~6% -> marketing overlay occupies ~23% of the pixels; ~77% of the image is untouched screenshot. Of the overlay, the hero is the tallest element (27.5% of height), the headline the widest (86% of width).
- **Balance.** Top half: symmetric, cool purple, many small equal-weight units. Bottom half: asymmetric, warm accent on the right, one large unit. The heavy hero on the right is counter-weighted by the headline starting at the far left (x 7) and by the By Quality button at the top-left of the same zone.
- **Angles.** Only two angles exist: 0 deg (all UI) and -4.8 deg (band edge, headline, subline). The single tilt is what makes the overlay read as "marketing" rather than "UI".

## Structural takeaways

- **Corner-block overlay, not a full mask.** Keep the top ~58% of the frame as untouched screenshot and confine the marketing to a lower band plus one right-side cut-out; the screen stays legible as a real screen.
- **One tilt, applied to everything in the overlay.** Band edge, headline and subline share the same ~5 deg slope; the UI stays at 0 deg. The contrast in angle does the layer separation for free.
- **Hero on the lower-right thirds point, headline anchored far-left.** Face at ~(80, 67) with the text block starting at x 5-7 creates a diagonal counterweight instead of a stacked centre column.
- **Let the hero break the band.** The cut-out's hands and feet overlap the band (hero z above band); this makes the character pop off the slab instead of standing behind it.
- **Sacrifice the repetitive part of the screen.** The overlay covers the grid (repeating cards - low information loss), never the roster, tabs or the primary buttons; occlusion cost is minimal while the message gets ~23% of the frame.

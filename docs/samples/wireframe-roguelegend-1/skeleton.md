# Rogue Legend - store screenshot 1 - structural skeleton

Source: `workspace/_library/images/orig/ddd7f071...a732.png`, 1080 x 1920 px (9:16 portrait), position 1 of the US listing of `com.pockethaven.roguelegend` (same image at position 1 in th / id / ph). All boxes are x / y / w / h in % of the full image, origin top-left. z is the draw order inside each layer (higher = on top). Values were measured with colour-threshold masks, connected components and a 10 x 10 luminance grid (PIL + numpy); boxes for painted, soft-edged shapes combine measured anchors (eyes, runes, crystals, floor, slabs) with visual reading; expect +/-1%.

**Caveat.** This is not a screenshot: position 1 is full-bleed key art with no HUD, no buttons, no panels. "Layer 1" below is therefore the painted scene (the thing that plays the role of the product proof), and "Layer 2" is the only true overlay, the two-line logo. The same two-layer format is kept so the file compares 1:1 with the Archero 2 sample.

## Summary

The underlying image is a **single painted cave scene**: a dark navy cavern framed by two vignetted walls, a pale mist band in the upper-middle that back-lights seven monster silhouettes with red eyes, a large rune-covered stone golem crouching centre-right, and a small white-haired hero with sword and shield standing low-left on the only warm-lit patch of floor, with glowing cyan / green crystals ringing the arena. The marketing layer is a **top-centre logo block only**: a two-line wordmark ("ROGUE" white, "LEGEND" yellow) on a thick dark outline plate, centred at x 50, spanning y 6.6-25.5. There is no band, no cut-out, no subline and no badge; ~88% of the frame is untouched art and the logo sits in the darkest, emptiest zone of the scene (the ceiling), fully above every scene element.

## Layer 1 - Screenshot (painted scene, in place of in-game UI)

| # | Element | Role | x | y | w | h | z | Note |
|---|---|---|---|---|---|---|---|---|
| S1 | Cave environment (scene container) | container | 0 | 0 | 100 | 100 | 0 | Full-bleed painted cave, dark navy (mean luminance 46/255). No HUD anywhere in the frame. |
| S1.1 | &nbsp;&nbsp;Left cave wall + vignette | element | 0 | 0 | 16 | 100 | 1 | Mean lum 21/255 vs 63 in the centre 40%. Frames the scene, pushes the eye inward. |
| S1.2 | &nbsp;&nbsp;Right cave wall + vignette | element | 84 | 0 | 16 | 100 | 1 | Mirror of S1.1 (lum 22/255). Symmetric frame. |
| S1.3 | &nbsp;&nbsp;Ceiling rock / top dark band | element | 0 | 0 | 100 | 7 | 1 | Rows above y 6.9 average lum < 30; the logo plate starts right below it. |
| S1.4 | &nbsp;&nbsp;Bottom dark vignette | element | 0 | 90 | 100 | 10 | 1 | Rows below y 90.2 fall under lum 30; fades the floor out. |
| S1.5 | &nbsp;&nbsp;Lit mist / cave depth | element | 22 | 25 | 56 | 30 | 1 | Lightest part of the scene (lum 47-78): pale blue fog that back-lights the monster silhouettes and the golem's head. |
| S1.6 | &nbsp;&nbsp;Left rock ledge | element | 5 | 38 | 35 | 8 | 2 | Mid-ground shelf the spider and eye-monster stand on. |
| S1.7 | &nbsp;&nbsp;Right rock ledge | element | 62 | 35 | 33 | 9 | 2 | Shelf under the werewolf; slightly higher than S1.6. |
| S1.8 | &nbsp;&nbsp;Lit floor (warm ground plane) | element | 8 | 70 | 62 | 24 | 2 | Only warm-toned area (R > B); brown earth lit by the crystals. Brightest floor cell is under the hero (x 30-40 / y 70-80, lum 117). |
| S1.9 | &nbsp;&nbsp;Glowing crack in floor | element | 47 | 84 | 13 | 7 | 3 | Green-cyan fissure running diagonally down-right from the hero's feet toward the crystals. |
| S2 | Monster crowd (7 silhouettes) | container | 6 | 25 | 81 | 30 | 2 | Dark shapes with red eye pairs; five of the seven pairs sit on one line at y 34-36. |
| S2.1 | &nbsp;&nbsp;Spider (left) | element | 6 | 29 | 23 | 12 | 3 | Eyes at (16.4, 35.5) and (19.5, 35.6). Largest silhouette of the crowd. |
| S2.2 | &nbsp;&nbsp;Eye-monster (centre-left) | element | 28 | 31 | 14 | 9 | 3 | Eyes at (35.2, 35.0) / (37.0, 35.0). |
| S2.3 | &nbsp;&nbsp;Bat (upper) | element | 48.7 | 26.2 | 13.1 | 6 | 3 | Measured dark blob; highest creature, ~1% under the logo plate. |
| S2.4 | &nbsp;&nbsp;Bat (lower) | element | 41.5 | 35.5 | 15.9 | 4 | 3 | Measured dark blob, wings spread across the vertical centre axis. |
| S2.5 | &nbsp;&nbsp;Werewolf (right) | element | 62 | 28 | 25 | 13 | 3 | Eyes at (65.7, 34.4) / (68.3, 34.1). Right-hand counterpart to S2.1. |
| S2.6 | &nbsp;&nbsp;Shambler (centre, deep) | element | 35 | 46 | 11 | 9 | 3 | Eyes at (40.7, 49.1) / (42.3, 49.3). Sits between the crowd and the golem, adds depth. |
| S2.7 | &nbsp;&nbsp;Small creature (right, deep) | element | 65 | 45 | 11 | 8 | 3 | Eyes at (68.0, 47.4) / (69.7, 47.2). |
| S3 | Boss golem (stone brute) | container | 32 | 50.5 | 55 | 26.5 | 4 | Dark slate silhouette (body lum 13-45) read against the lighter mist; cyan runes and red eyes carry the shape. Largest single figure, bbox ~14.6% of the frame. |
| S3.1 | &nbsp;&nbsp;Head (helmet-shaped block) | element | 44 | 50.5 | 26 | 16.5 | 5 | Top rune at (53, 54). Jaw ends ~y 67. |
| S3.2 | &nbsp;&nbsp;Eyes (red glow) | element | 50.8 | 61.5 | 11 | 2.2 | 6 | Two blobs at (52.1, 62.7) and (59.5, 62.3); the brightest warm accent in the lower half. |
| S3.3 | &nbsp;&nbsp;Left arm + fist | element | 30 | 59 | 17 | 14 | 5 | Fist planted on the floor at x 30-33 / y 63-72; rune at (37, 65). |
| S3.4 | &nbsp;&nbsp;Right shoulder + arm + fist | element | 68 | 52 | 19 | 25 | 5 | Runes at (74.6, 58) and (83, 68). Fist reaches y 77, the lowest point of the golem. |
| S3.5 | &nbsp;&nbsp;Chest with magenta cracks | element | 46 | 66 | 20 | 9 | 5 | Magenta veins at (64, 69), (61, 70), (54, 71.5): a second accent colour unique to the boss. |
| S3.c | &nbsp;&nbsp;Rune anatomy | detail | - | - | - | - | 6 | Seven cyan glyph groups: 53/52/8/4, 44/55/8/6, 74.6/56/8/5, 54/56/6/5, 37/62/12/7, 72/66/3/4, 83/66/6/4. |
| S4 | Hero (elf swordsman) | container | 25 | 72 | 25 | 17 | 6 | Small (bbox ~4.3% of the frame) but placed on the brightest floor patch; faces right toward the golem. |
| S4.1 | &nbsp;&nbsp;Hair (white ponytail) | element | 25.5 | 72.5 | 16 | 8 | 7 | Pure white: highest-luminance pixels below the logo. |
| S4.2 | &nbsp;&nbsp;Head / face | element | 30 | 74 | 15 | 8 | 7 | Skin bbox measured x 30.1-44.7 / y 74.3-82.0. |
| S4.3 | &nbsp;&nbsp;Round shield (blue) | element | 24 | 79 | 9 | 8 | 8 | Left of the body, overlapping the hair's tail. |
| S4.4 | &nbsp;&nbsp;Tunic + legs | element | 29 | 80 | 14 | 9 | 7 | Orange tunic (measured 30-46 / 77-83), dark boots end ~y 89. |
| S4.5 | &nbsp;&nbsp;Sword (cyan blade, raised) | element | 43 | 75.5 | 7 | 7 | 8 | Blade tip at (49, 77); the only strong diagonal in the frame (~ -35 deg). |
| S5 | Set dressing (stones + crystals) | container | 2 | 38 | 96 | 50 | 3 | Glowing props that ring the arena and light the floor. |
| S5.1 | &nbsp;&nbsp;Left standing stone (rune slab) | element | 2.6 | 56.2 | 19.3 | 20.2 | 3 | Measured bbox. Cyan glyphs at (10.5, 61) and (12.6, 64). |
| S5.2 | &nbsp;&nbsp;Right standing stone | element | 84 | 55 | 11 | 17 | 3 | Partly lost in the right vignette; measured lit part 84-93.6 / 66.3-72. |
| S5.3 | &nbsp;&nbsp;Cyan crystal cluster (bottom-left) | element | 10 | 77 | 9 | 9 | 7 | Largest cyan blob in the image (3247 px at 13.3, 80.8). |
| S5.4 | &nbsp;&nbsp;Cyan crystal cluster (bottom-right) | element | 61 | 79 | 25 | 9 | 7 | Blobs at (62.5, 83), (70.8, 83.4), (82.5, 83.4); counterweights the hero. |
| S5.5 | &nbsp;&nbsp;Green crystal cluster (right wall) | element | 87 | 69 | 10 | 8 | 5 | Only green accent besides the floor crack; blobs at (90, 71-74). |
| S5.6 | &nbsp;&nbsp;Wall sprites (cyan dots) | detail | - | - | - | - | 4 | Tiny cyan crystals at (9.4, 38) and (92.2, 40.4) plus green sparks along both walls. |

**Grouping and hierarchy.** Four depth planes stacked back to front, and (unlike a UI screen) they overlap vertically rather than tiling:

1. **Environment** (S1, full frame): a symmetric frame of two dark walls (S1.1 / S1.2, 16% each) and a dark ceiling / floor fade (S1.3 / S1.4), with the light concentrated in a mist window S1.5 (x 22-78, y 25-55) and a warm floor patch S1.8 (x 8-70, y 70-94). Everything of interest lives inside the resulting cross of light.
2. **Threat crowd** (S2, y 25-55): seven silhouettes arranged as a wide arc: spider far-left, werewolf far-right (mirror pair), two bats on the centre axis, and three smaller creatures between. The eye pairs of S2.1 / S2.2 / S2.5 line up at y 34-36, exactly on the top-third line.
3. **Boss** (S3, y 50.5-77): one big block, head on the vertical axis (44-70), arms spread to x 30 and x 87 so the golem alone spans 55% of the width. Runes (cyan) and eyes (red) are the only lit details on an otherwise near-black mass.
4. **Hero + props** (S4 / S5, y 55-89): hero at the lower-left (x 25-50), two standing stones at the far left / right edges acting as a second set of "pillars", and crystal clusters at the three lower corners of the arena (left, right, centre-right crack).

**Reading and visual flow (scene alone).** The eye enters on the pale mist (brightest scene region) and the red eye line at y ~35, drops down the centre axis onto the golem's red eyes (56, 62.5), then follows the golem's left fist down to the brightest floor cell and the white-haired hero (37, 78). The hero's raised sword points back up-right at the golem's face, closing a tight loop between the two figures; the crystals and the floor crack then lead out to the lower corners.

## Layer 2 - Marketing overlay

| # | Element | Role | x | y | w | h | z | Note |
|---|---|---|---|---|---|---|---|---|
| M1 | Logo plate (dark navy outline / drop shadow) | container | 18.5 | 6.6 | 64.5 | 18.9 | 1 | Thick dark outline (~18-24 px = ~2% of width at the sides, ~15-25 px top / bottom) hugging both words; separates the wordmark from the cave. Only marketing element that touches the scene. |
| M2 | Wordmark line 1: 'ROGUE' (white) | container | 20.6 | 7.7 | 59.3 | 8.9 | 2 | Measured white pixel bbox. Centre x 50.3. 0 deg (fitted tilt -0.9 deg, within letterform noise). |
| M3 | Wordmark line 2: 'LEGEND' (yellow) | container | 20.3 | 16.7 | 60.8 | 7.2 | 2 | Measured yellow pixel bbox. Centre x 50.8. Slightly wider than line 1; the two lines touch (no gap). |

**What it covers.** M1 covers only ceiling rock and the top edge of the mist (x 18.5-83, y 6.6-25.5), a zone that holds no scene element: the highest creature (S2.3, top bat) starts at y 26.2, ~1% below the plate. Nothing in S2-S5 is occluded; the walls S1.1 / S1.2 stay fully visible either side of the logo (18.5% and 17% margins).

**How it directs the eye.** The wordmark holds the brightest pixels in the image (white 240+, yellow ~200 lum) inside the darkest band (ceiling lum < 30), so it is read first regardless of position. Its bottom edge (y 25.5) sits directly above the mist and the bat, handing the eye down the centre axis to the crowd, the golem and finally the hero. Because the logo is exactly centred and horizontal, it also sets the symmetry that the walls and the two standing stones repeat, while the figures below break it diagonally.

## Composition

- **Aspect / grid.** 9:16 (1080 x 1920). Horizontal thirds: y 33.3 runs through the monster eye line (y 34-36); y 66.7 cuts the golem's chest / left fist, 5% above the hero's hair. Vertical thirds: x 33.3 runs through the hero's body (30-44); x 66.7 through the golem's right shoulder. The logo is centred on x 50 (50.3 / 50.8 for the two lines).
- **Focal point.** Golem eyes at (56, 62.5), 4% right of centre and just under the lower-third line, the only warm glow in the dark lower half. Secondary: hero head at (37, 78) on the brightest floor cell. The logo at (50.5, 16) is the brightest element but reads as a label, not the focal point of the scene.
- **Reading order.** 1 logo (M2 -> M3) -> 2 golem eyes / head (S3.2, S3.1) -> 3 hero (S4; sword points back at the golem) -> 4 crystals and crack (S5.3 / S5.4 / S1.9) -> 5 monster eye line (S2) -> 6 standing stones (S5.1 / S5.2). Brand first, confrontation second, world third.
- **Zone split.** Marketing-only region: x 18.5-83 / y 6.6-25.5 (12.2% of the frame). Scene-only region: everything else, including the top 6.6% and both side margins next to the logo. There is no mixed region: no scene element is partly under the overlay.
- **Area budget.** Logo plate ~12.2% of the pixels, actual glyphs ~5.9%; ~88% of the frame is untouched art. Of the scene, the golem's bbox is the largest figure (~14.6%), the hero's ~4.3%, the mist window ~16.8%, the warm floor ~14.9%.
- **Balance.** Top: symmetric (centred logo, mirrored walls, mirrored spider / werewolf pair). Bottom: asymmetric diagonal, hero low-left (37, 80) versus golem centre-right (60, 64); counter-weighted by the bottom-right crystal cluster (61-86, 79-88) and the green crystals on the right wall. The two standing stones (x 2.6-22 and 84-95) bracket the arena at the same height band (y 55-76).
- **Angles.** Logo 0 deg; walls, stones, floor 0 deg. Only two diagonals exist: the hero's sword (~ -35 deg, up-right) and the floor crack (~30 deg, down-right); both point at the golem-hero axis. No marketing element is tilted.
- **Light.** Mean luminance 46/255. Outer 15% columns average 21-23, centre 40% 63; top 7% rows 14, bottom 10% rows 16. The light budget goes to four things: logo, mist, hero's floor patch, crystals.

## Structural takeaways

- **Key art slot, not a screenshot.** Position 1 uses zero UI; the product proof is a painted confrontation. Any structural comparison with UI-based shots (Archero 2 sample) should note that the "screenshot layer" here is a scene with depth planes, not tiled panels.
- **Logo-only overlay, top-centre, ~12% of the frame.** One plate at y 6.6-25.5 with its own dark outline; no band, no subline, no cut-out, no badge. Everything else is the art itself.
- **Overlay parked in dead space.** The logo sits in the ceiling band (lum < 30) with 1% clearance above the top bat; nothing is occluded, so the art keeps 100% of its elements and the logo keeps maximum contrast.
- **Confrontation diagonal inside a symmetric frame.** Walls, stones and logo are mirror-symmetric around x 50; the hero (low-left) and golem (centre-right) form the only asymmetry, which is what the eye locks onto after the logo.
- **Light hierarchy does the reading order.** Brightest = logo, next = mist behind the threats, next = the hero's floor patch; red eye pairs (12 of them, five on the top-third line) are the connective tissue between those pools.
- **Small hero, huge boss.** Hero bbox ~4% vs golem ~15%: the scale contrast sells threat; the hero stays legible only because he owns the single brightest floor cell and the only pure-white shape below the logo.

# Legend of Mushroom - store screenshot 3 (US) - structural skeleton

Source: `workspace/_library/images/orig/ce1c0012...545b.jpg`, 1920 x 1080 px (16:9 landscape). All boxes are x / y / w / h in % of the full image, origin top-left. z is the draw order inside each layer (higher = on top). Values were measured with colour-threshold masks, connected components and line fits on the pixels, plus a 5% grid overlay; expect +/-1%.

## Summary

The underlying screen is the game's **auto-battle stage view**: a side-scrolling battlefield (player party on the left, five enemies on the right, floating damage numbers between them) with a top HUD row and a 2 x 5 equipment column pinned to the left edge. The marketing layer is a **framed-card-plus-cut-out** composition: the whole screenshot is inset in a white-stroked rounded card on a flat blue margin (with a second outline tilted ~1.5 deg peeking out behind it), a giant white cat cut-out occupies the right 29% and bleeds off the frame, two smaller cut-outs (mushroom knight, chick) stand in front of it, and a bottom-left text block (headline + icon pill) sits over a blurred bokeh foreground. Roughly 60% of the pixels remain untouched screenshot; the marketing occupies the right third and the bottom quarter.

## Layer 1 - Screenshot (in-game screen)

| # | Element | Role | x | y | w | h | z | Note |
|---|---|---|---|---|---|---|---|---|
| S1 | Battle scene viewport (card interior) | container | 1.6 | 3.2 | 95.9 | 96.8 | 0 | Everything in-game lives inside the white card; the card's bottom edge is hidden under the bokeh strip. |
| S1.1 | &nbsp;&nbsp;Sky + distant hills | element | 1.6 | 3.2 | 95.9 | 40 | 1 | Flat light-blue sky, blurred green hills at y 20-40. |
| S1.2 | &nbsp;&nbsp;Big tree (left backdrop) | element | 1.6 | 3.2 | 36 | 35.5 | 1 | Dark canopy behind the HUD and the equipment column. |
| S1.3 | &nbsp;&nbsp;Fallen log | element | 23.4 | 23.1 | 23.4 | 12 | 2 | Horizontal prop separating hills from battlefield. |
| S1.4 | &nbsp;&nbsp;Mushroom platform tower | element | 55.2 | 8.3 | 17.7 | 22.2 | 1 | Purple cap on a wooden scaffold. |
| S1.5 | &nbsp;&nbsp;Lamp post | element | 75.5 | 8.3 | 7.3 | 22.2 | 1 | Thin vertical prop with a yellow bulb. |
| S1.6 | &nbsp;&nbsp;Mushroom house (right) | element | 81.3 | 9.3 | 16.2 | 32.4 | 1 | ~70% hidden by the cat cut-out M4. |
| S1.7 | &nbsp;&nbsp;Battlefield ground (dirt path) | element | 1.6 | 43.5 | 95.9 | 23.1 | 2 | Sand-coloured floor the units stand on. |
| S1.8 | &nbsp;&nbsp;In-game grass | element | 1.6 | 66.7 | 95.9 | 33.3 | 2 | Flat cartoon grass, crisp edges (unlike the marketing bokeh M7). |
| S2 | Player HUD (top-left) | container | 2.9 | 5.0 | 33.2 | 5.2 | 6 | Avatar, HP bar, two currency pills in one row. |
| S2.1 | &nbsp;&nbsp;Avatar + LV 17 | element | 2.9 | 5.0 | 3.9 | 5.2 | 7 | Square portrait frame, px 56-129 x 54-109. |
| S2.2 | &nbsp;&nbsp;HP bar 13450/1520 | element | 5.8 | 6.7 | 11.6 | 1.9 | 6 | Green fill px 112-327 x 81-89; starts behind the avatar. |
| S2.3 | &nbsp;&nbsp;Gold counter 999,999 | element | 22.1 | 6.0 | 7.0 | 3.7 | 7 | Dark pill with coin icon. |
| S2.4 | &nbsp;&nbsp;Gem counter 9,999 | element | 29.9 | 6.0 | 6.2 | 3.1 | 7 | Dark pill with gem icon. |
| S3 | Stage HUD (top-right) | container | 84.5 | 4.9 | 11.6 | 5.0 | 6 | Stage label + wave progress. |
| S3.1 | &nbsp;&nbsp;Stage label '1-6' | element | 89.3 | 4.9 | 1.9 | 1.7 | 7 | White text px 1715-1750 x 53-70. |
| S3.2 | &nbsp;&nbsp;Wave progress bar + boss skull | element | 84.5 | 7.6 | 11.6 | 2.2 | 7 | Teal track px 1623-1776 x 87-98, 5 dots, skull badge to x 1842. |
| S4 | Equipment column (2 x 5 cells) | container | 3.8 | 17.8 | 13.2 | 60.6 | 6 | Cols x 72-191 / 207-326 px; row pitch 135 px (12.5%); cell 120 x 115 px (6.3 x 10.6%). |
| S4.1 | &nbsp;&nbsp;Row 1: helmet (red) / noose (grey) | element | 3.8 | 17.8 | 13.2 | 10.6 | 7 | Fully visible. |
| S4.2 | &nbsp;&nbsp;Row 2: glove (green) / necklace (purple) | element | 3.8 | 30.3 | 13.2 | 10.6 | 7 | Fully visible. |
| S4.3 | &nbsp;&nbsp;Row 3: sword (gold) / claw (red) | element | 3.8 | 42.8 | 13.2 | 10.6 | 7 | Fully visible. |
| S4.4 | &nbsp;&nbsp;Row 4: armor (orange) / cloak (blue) | element | 3.8 | 55.3 | 13.2 | 10.6 | 7 | Fully visible. |
| S4.5 | &nbsp;&nbsp;Row 5: airship (red), clipped | element | 3.8 | 67.8 | 13.2 | 10.6 | 7 | Lower ~60% hidden by headline M2 and bokeh M7.1. |
| S4.c | &nbsp;&nbsp;Cell anatomy | detail | - | - | - | - | 8 | Rarity-coloured rounded frame, item art centred (~4 x 6%), 'Lv.10' label strip on the bottom ~2.5%. |
| S5 | Player party (left of centre) | container | 18.8 | 35.0 | 22.9 | 34.4 | 4 | Hero + 4 companions + skateboard prop, all facing right. |
| S5.1 | &nbsp;&nbsp;Hero mushroom knight (player) | element | 25.0 | 37.5 | 11.5 | 19.0 | 5 | Olive cap px 480-699 x 411-519; body to y 609. Largest in-game unit. |
| S5.2 | &nbsp;&nbsp;Sword slash / impact FX | element | 33.3 | 38.9 | 13.5 | 16.7 | 6 | White-yellow starburst; brightest point of the screenshot. |
| S5.3 | &nbsp;&nbsp;Companion: red fox | element | 18.8 | 35.1 | 7.2 | 9.3 | 4 | |
| S5.4 | &nbsp;&nbsp;Companion: orange cat | element | 35.4 | 35.0 | 4.5 | 6.3 | 4 | Behind the slash FX. |
| S5.5 | &nbsp;&nbsp;Companion: banana | element | 20.6 | 49.9 | 4.8 | 14.1 | 5 | |
| S5.6 | &nbsp;&nbsp;Companion: turtle | element | 33.5 | 55.4 | 4.4 | 9.4 | 5 | |
| S5.7 | &nbsp;&nbsp;Skateboard prop | element | 33.9 | 66.7 | 4.7 | 2.8 | 4 | Sits right above the headline's top edge. |
| S5.8 | &nbsp;&nbsp;Ally HP bars (green, x4) | detail | 21 | 33 | 20 | 21 | 6 | Thin ~4 x 0.8% bars above each ally. |
| S6 | Enemy group (right of centre) | container | 48.7 | 31.0 | 24.7 | 33.8 | 4 | Five enemies facing left; the rightmost two are partly under the cat. |
| S6.1 | &nbsp;&nbsp;Skeleton 1 | element | 48.7 | 42.1 | 9.4 | 15.6 | 5 | |
| S6.2 | &nbsp;&nbsp;Skeleton 2 | element | 54.4 | 51.4 | 10.1 | 12.8 | 5 | |
| S6.3 | &nbsp;&nbsp;Dark knight | element | 54.9 | 31.0 | 6.0 | 11.1 | 4 | |
| S6.4 | &nbsp;&nbsp;Wizard (large) | element | 62.2 | 32.0 | 11.2 | 20.3 | 4 | Right ~15% clipped by the cat halo. |
| S6.5 | &nbsp;&nbsp;Goat demon | element | 67.3 | 52.3 | 6.1 | 12.5 | 5 | Right half under the cat M4. |
| S6.6 | &nbsp;&nbsp;Enemy HP bars (red, x5) | detail | 50 | 29 | 25 | 20 | 6 | Thin red bars above each enemy. |
| S7 | Floating damage numbers | container | 22.6 | 22.7 | 56.6 | 24.5 | 8 | Pink-to-lavender gradient type with white outline; 4 instances. |
| S7.1 | &nbsp;&nbsp;'-583' | element | 22.6 | 26.4 | 7.5 | 5.6 | 8 | |
| S7.2 | &nbsp;&nbsp;'-587' | element | 58.3 | 22.7 | 7.7 | 5.6 | 8 | |
| S7.3 | &nbsp;&nbsp;'-2774' (largest) | element | 43.2 | 30.7 | 12.4 | 8.1 | 8 | Near the image centre; ties the two groups together. |
| S7.4 | &nbsp;&nbsp;'-9..' (clipped) | element | 72.4 | 39.8 | 6.8 | 7.4 | 8 | Cut by the cat cut-out M4. |

**Grouping and hierarchy.** The screen is a left-to-right stage with a fixed chrome:

1. **Chrome** (edges): HUD row S2/S3 along the top 5-10% (avatar + bars left, stage progress right) and the equipment column S4 pinned to the left 4-17% for 60% of the height (2 columns x 5 rows, 135 px pitch, every cell the same anatomy S4.c).
2. **Stage** (y 3-100): backdrop S1.1-S1.6 (sky, tree, props), ground S1.7 (y 43-67) and grass S1.8 below. The horizon sits at y ~43.
3. **Actors** (y 31-70): party S5 in x 19-42, enemies S6 in x 49-74, facing each other across the slash FX S5.2 at x 33-47. Damage numbers S7 float above the contact line and are the only text in the scene.

**Reading and visual flow (screenshot alone).** Eye enters at the slash FX (brightest point, ~x 40 / y 48), reads the hero to its left and the skeletons to its right, rises to the big '-2774' at the centre, then scans the equipment column and finally the HUD. The scene is a horizontal tug-of-war: left party vs right enemies, mirrored around x ~45.

## Layer 2 - Marketing overlay

| # | Element | Role | x | y | w | h | z | Note |
|---|---|---|---|---|---|---|---|---|
| M1 | Card frame (blue margin + white stroke) | container | 0 | 0 | 100 | 100 | 0 | Flat blue margin: left 1.3%, top 2.7%, right 2.2%; bottom hidden by M7.2. |
| M1.1 | &nbsp;&nbsp;Card outline (white 6 px, r ~30 px) | element | 1.3 | 2.7 | 96.5 | 97.3 | 1 | px x 25-1877, y 29 -> bottom hidden. The screenshot is clipped to this rounded rect. |
| M1.2 | &nbsp;&nbsp;Second outline, tilted ~1.5 deg CW | element | 1.3 | 1.3 | 97.6 | 97.4 | 0 | Drawn behind the card; peeks out top-left (y 14 -> 29 px over x 100 -> 780), upper-right (x 1899 -> 1887 over y 60 -> 440) and curls at bottom-left (x 0-69, y 700-855). |
| M2 | Headline: 'Collect Companions' | element | 1.6 | 72.2 | 60.9 | 15.4 | 4 | Blue gradient display type with white + dark-blue double outline, 0 deg. Glyph fill 2.8/74.6/56.6/13.3. Covers equipment row 5 and the left in-game grass. |
| M3 | Subline pill | element | 10.8 | 86.7 | 41.8 | 9.5 | 4 | Blue rounded pill with white stroke; px 208-1009 x 936-1038. |
| M3.1 | &nbsp;&nbsp;Subline text: 'Combat Squad, Auto Upgrade' | element | 18.8 | 90.2 | 31.9 | 4.4 | 5 | White type px 360-972 x 974-1020. |
| M3.2 | &nbsp;&nbsp;Pill icon (mini mushroom knight) | element | 10.4 | 86.3 | 7.9 | 10.5 | 5 | Breaks the pill's left edge. |
| M4 | Hero cut-out: giant white cat | element | 71.3 | 33.1 | 28.7 | 56.9 | 3 | Body px 1383-1919 x 371-957, thick black outline, 8.9% of all pixels. Bleeds off the right edge over the card stroke. Covers S1.6, S6.5, S7.4 and the right edge of S6.4. |
| M4.1 | &nbsp;&nbsp;White halo around the cat | element | 66.7 | 36.1 | 6.2 | 36.3 | 2 | Soft white glow px 1280-1399 x 390-782 along the cat's left silhouette. |
| M5 | Cut-out: mushroom knight with sword | element | 56.7 | 68.5 | 18.9 | 23.7 | 5 | Sword 56.7/70.3/8.4/13.1, cap 64.2/68.5/9.7/12.7. Stands in front of the cat's lower-left; ~2x the in-game hero scale. |
| M6 | Cut-out: chick in blanket | element | 75.5 | 77.8 | 10.9 | 15.9 | 5 | In front of the cat's belly; px 1450-1659 x 840-1011. |
| M7 | Bokeh foreground (blurred grass / bush) | container | 0 | 64 | 100 | 36 | 2 | The only blurred pixels in the image; three patches. |
| M7.1 | &nbsp;&nbsp;Left bush patch | element | 0 | 64 | 23 | 36 | 2 | Dark-green blur behind 'Collect'; covers the card's left edge and the bottom of the equipment column. |
| M7.2 | &nbsp;&nbsp;Bottom grass strip | element | 0 | 92.6 | 100 | 7.4 | 2 | Full width from y 1000 px; hides the card's bottom edge. |
| M7.3 | &nbsp;&nbsp;Ground under the cut-outs | element | 52 | 88 | 48 | 12 | 2 | Sharper grass blades the knight, chick and cat stand on. |

**What it covers.** M4 hides the mushroom house (S1.6), the right half of the goat (S6.5), the clipped damage number (S7.4) and the card's right stroke for y 33-90. M2 hides the lower 60% of equipment row 5 (S4.5) and the in-game grass under the party. M3 and M7 hide the card's bottom edge entirely, so the frame is open at the bottom. Everything that carries information - HUD, four full equipment rows, hero, slash, all five enemies, three of four damage numbers - stays visible; the overlay eats backdrop props, grass and one repeated grid row.

**How it directs the eye.** The cat's face (~x 82, y 57) is the largest high-contrast shape: white body, black outline, dark eyes. From there the gaze drops left along the cat's collar to the knight and chick, then to the headline at the bottom-left, and the pill beneath it. The headline's left anchor (x 1.6) and the cat's right bleed (x 100) stretch the composition across the full width; the bright slash FX in the middle keeps the screenshot from becoming mere wallpaper.

## Composition

- **Aspect / grid.** 16:9. Vertical thirds at x 33.3 (through the slash FX / party-enemy contact) and 66.7 (the cat's halo edge - the marketing/screenshot boundary). Horizontal thirds at y 33.3 (top of the actors and damage numbers) and 66.7 (top of the headline / bottom of the actors).
- **Focal point.** Cat face at approx (82, 57), right of the lower-right thirds intersection (66.7, 66.7) and above it. Secondary: slash FX + hero at (40, 48), on the left vertical third.
- **Reading order.** 1 cat face (M4) -> 2 headline (M2) -> 3 subline pill (M3) -> 4 knight + chick (M5/M6) -> 5 slash / hero (S5) -> 6 enemies (S6) -> 7 equipment column (S4) -> 8 HUD (S2/S3). Marketing first, then the battle as proof, then the meta-UI as texture.
- **Zone split.** Screenshot-only region: x 1.6-70, y 3-72 (~46% of the frame). Mixed: right band x 70-100 (cat over scene) and the left bush x 0-23, y 64-100. Marketing-dominant: y 72-100 full width.
- **Area budget.** Card margin ~6%, headline ~7%, pill ~4%, cat ~10%, knight ~3.5%, chick ~1.5%, bokeh ~8% -> the marketing layer occupies ~40% of the pixels; ~60% is untouched screenshot. The cat alone (8.9% measured) is the largest single element in the image; the headline is the widest (61% of width).
- **Balance.** Right side: one huge white mass. Left side: many small saturated cells (equipment) plus the wide blue headline. The diagonal from the headline's start (bottom-left) to the cat's face (right, upper-middle) is the composition's spine.
- **Angles.** Everything sits at 0 deg - UI, type, cut-outs - except the second card outline at ~1.5 deg clockwise. That single wobble, plus the frame itself, is what says "framed screenshot" rather than "screen".

## Structural takeaways

- **Frame the screen, then break the frame.** A 6 px white stroke on a flat blue margin turns the screenshot into a card; the cat bleeding over the right edge and the bokeh hiding the bottom edge keep it from feeling like a flat mock-up.
- **One giant cut-out on the right third, text block bottom-left.** The 29%-wide cat occupies exactly the right third; the headline starts at the far-left edge. Same diagonal counterweight as the Archero 2 sample, mirrored for landscape.
- **Layer the cut-outs by scale.** Cat (57% tall) > knight (24%) > chick (16%) > in-game hero (19% but thin outline). The size ladder plus thick outlines separates marketing characters from gameplay sprites without a band.
- **Blur only the marketing foreground.** The bokeh strips are the only soft pixels; depth of field replaces a colour band as the layer separator.
- **Sacrifice props and one grid row, never the actors.** The overlay covers the mushroom house, the grass and equipment row 5; all fighters, the slash, the HUD and four full equipment rows stay readable.
- **Borrow the game's type treatment.** The headline uses the same double-outline style as the in-game damage numbers, so the marketing copy reads in the game's voice.

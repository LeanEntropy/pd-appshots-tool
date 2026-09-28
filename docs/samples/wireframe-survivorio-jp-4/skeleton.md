# Survivor.io (JP) - store screenshot 4 - structural skeleton

Source: `workspace/_library/images/orig/9890be41...1ce7.jpg`, 1242 x 2208 px (9:16 portrait), Google Play listing for `com.dxx.firenow`, market jp / ja, position 4. All boxes are x / y / w / h in % of the full image, origin top-left. z is the draw order inside each layer (higher = on top). Values were measured with colour-threshold masks, connected components and least-squares line fits on the original pixels; expect +/-1%.

## Summary

The underlying screen is the game's **talent tree**, captured at roughly 2.5x zoom so that one node column and one tooltip fill the frame: a vertical chain of five square talent nodes on a green/slate rail at x = 25, and a large two-panel tooltip callout (talent name, effect, flavour text) with a tier badge on the upper right. The wall behind is a two-tone steel backdrop (dark slate above a horizontal seam at y 20, steel-blue below). The marketing layer is a **tilted bottom block plus a corner logo and a right-side mascot**: the screenshot is cut along a -7.7 deg ledge line at y 82 -> 75, a dark slab sits under it, and a purple halftone band (top edge -11.2 deg) fills the last 78-89 -> 100% with a white outlined headline rotated -9.7 deg. A purple plant-creature cut-out stands on the ledge in the right half, its eye landing near the lower-right thirds point and its stalk vanishing behind the slab. The game logo sits in the top-left corner and clips the top node. Text is dense: six distinct copy blocks (logo, badge numeral, tooltip title, tooltip body, flavour subtext, headline), all Japanese.

## Layer 1 - Screenshot (in-game screen)

| # | Element | Role | x | y | w | h | z | Note |
|---|---|---|---|---|---|---|---|---|
| S1 | Wall backdrop (zoomed talent screen) | container | 0.0 | 0.0 | 100.0 | 82.5 | 0 | Full-width backdrop of the talent screen, captured at roughly 2.5x zoom. Its bottom is not horizontal: it is cut along the tilted ledge line (M2), from y 82.5 at the left edge to y 75.0 at the right edge. |
| S1.1 | &nbsp;&nbsp;Upper wall (dark slate, silhouette motifs) | element | 0.0 | 0.0 | 100.0 | 19.6 | 1 | Dark slate strip with faint skull/ninja silhouettes. Ends at the horizontal seam S1.4. |
| S1.2 | &nbsp;&nbsp;Diagonal plate seam | element | 0.0 | 0.0 | 59.6 | 8.2 | 2 | Black line from (0, 8.2) to (59.6, 0); slope -13.7 deg. In-game art, not overlay. |
| S1.3 | &nbsp;&nbsp;Vertical strut | element | 73.4 | 0.0 | 4.3 | 19.6 | 2 | Dark vertical pillar, 4.3% wide, from the top edge down to the seam. |
| S1.4 | &nbsp;&nbsp;Horizontal seam | element | 0.0 | 19.6 | 100.0 | 0.4 | 2 | Black rule at y 19.6-20.0 across the full width; splits dark upper wall from blue lower wall. |
| S1.5 | &nbsp;&nbsp;Lower wall (blue, halftone lower-left) | element | 0.0 | 20.0 | 100.0 | 62.5 | 1 | Steel-blue wall with darker silhouette motifs and a halftone dot texture that fades in toward the lower-left. Cut at the ledge line. |
| S1.6 | &nbsp;&nbsp;Faint panel seam | detail | 0.0 | 51.6 | 100.0 | 0.5 | 2 | Barely visible horizontal line at y ~51.6-52.2, mostly readable left of the tree column. |
| S2 | Talent tree column (5 nodes + connector) | container | 17.2 | 2.2 | 15.8 | 68.7 | 3 | Single vertical chain of square nodes, centre x = 25.1. Pitch between node tops ~15-16% (320-345 px). Two locked grey nodes, one clipped grey node, two unlocked blue nodes. |
| S2.0 | &nbsp;&nbsp;Connector rail | element | 23.4 | 2.2 | 3.5 | 68.7 | 3 | 2-3.5% wide vertical bar behind the nodes. Dark slate between N1-N2 and N2-N3 (locked), bright green between N3-N4 and N4-N5 (unlocked). |
| S2.1 | &nbsp;&nbsp;Node N1 (locked, cross icon) - clipped | element | 18.8 | 2.2 | 11.9 | 6.7 | 4 | Top ~70% hidden under the logo M1; only y 6.9-8.8 is visible. Grey tile, black outline. |
| S2.2 | &nbsp;&nbsp;Node N2 (locked, skull + plus icon) | element | 18.8 | 17.2 | 11.9 | 6.6 | 4 | Grey 12.0 x 6.7 tile with dark inset and a grey skull-with-plus glyph (attack talent). |
| S2.3 | &nbsp;&nbsp;Node N3 (locked, shield icon) | element | 19.3 | 31.7 | 11.2 | 6.7 | 4 | Grey tile, shield glyph (defence talent). Same size as N2. |
| S2.4 | &nbsp;&nbsp;Node N4 (unlocked, refresh-arrow icon) | element | 17.2 | 46.8 | 15.8 | 8.4 | 5 | Blue frame with lighter glow ring (outer 15.9 x 8.5), inner tile 18.8/48.1/13.0/6.2 holds a yellow card-with-arrow glyph and white sparkles. |
| S2.5 | &nbsp;&nbsp;Node N5 (unlocked, lightbulb icon) | element | 17.2 | 62.4 | 15.8 | 8.4 | 5 | Same blue frame as N4; inner tile 20.0/63.7/10.3/5.6 with a yellow lightbulb glyph and sparkles. Lowest node; its glow touches the ledge cut. |
| S3 | Talent tooltip (callout box) | container | 54.4 | 17.3 | 43.7 | 26.5 | 6 | Rounded rectangle, black 1.5% outline, right edge 1.8% from the frame edge. Two stacked panels plus a downward tail. Widest text block in the image. |
| S3.1 | &nbsp;&nbsp;Tooltip header bar | element | 54.4 | 17.3 | 43.7 | 5.8 | 7 | Text: 'ラッキードッグ' = 'Lucky Dog'. Pale steel-blue bar with a halftone fade on the right; holds the talent name. |
| S3.2 | &nbsp;&nbsp;Tooltip body panel | element | 54.9 | 23.1 | 41.1 | 20.6 | 7 | Dark slate panel (same colour as the upper wall) with a black rule under the header. |
| S3.3 | &nbsp;&nbsp;Tooltip body text (3 lines) | text | 59.5 | 25.0 | 34.6 | 9.0 | 8 | Text: '戦闘開始時に1個のスキルを獲得' = 'Gain 1 skill at the start of battle'. Bold white, 3 lines, line pitch ~3.0%, glyph height ~2.4%. Left-aligned at x 59.5. |
| S3.4 | &nbsp;&nbsp;Tooltip flavour subtext (2 lines) | text | 59.5 | 36.1 | 27.1 | 3.2 | 8 | Text: 'すべてのサバイバーは神のお気に入り' = 'All survivors are the favourites of the gods'. Smaller white text, 2 lines, glyph height ~1.4%. Same left edge as S3.3. |
| S3.5 | &nbsp;&nbsp;Tooltip tail | element | 70.2 | 42.2 | 15.7 | 3.1 | 6 | Downward triangle, tip at (75.7, 45.2), pointing at the mascot below. Its tip is overlapped by the mascot bulbs (M4.1). |
| S4 | Level badge (diamond) "2" | element | 45.7 | 17.7 | 10.5 | 5.2 | 7 | Text: '2' = '2 (talent level / tier)'. Dark diamond docked to the tooltip header left edge, white numeral 2.2 x 1.7. Reads as the talent tier. |

**Grouping and hierarchy.** Three groups on one backdrop:

1. **Backdrop S1** (y 0-82.5 left / 0-75 right): upper dark wall S1.1 with a diagonal seam S1.2 and a vertical strut S1.3, a black horizontal seam S1.4 at y 19.6-20.0, then the steel-blue lower wall S1.5 (halftone fades in toward the lower-left). The wall's bottom is the tilted ledge cut, not a horizontal edge.
2. **Talent column S2** (x 17-33, y 2-71): one rail S2.0 with five 12 x 6.7 nodes at a 15-16% pitch. State is encoded twice - grey tiles + slate rail for locked (N1-N3), blue glowing frames + green rail for unlocked (N4-N5). The first node is 70% hidden under the logo.
3. **Tooltip S3 + badge S4** (x 45.7-98.2, y 17.3-45.2): header bar (name), body panel (effect, 3 lines; flavour, 2 lines) and a downward tail whose tip points at the mascot. The diamond badge docks to the header's left edge. It is the only in-game copy and it is large (glyphs 2.4-3.3% tall).

**Reading and visual flow (screenshot alone).** The tooltip is the brightest and most structured object (white on dark, black frame), so the eye goes there first, then follows the tail down and left to the glowing blue nodes N4/N5, then up the rail through the grey locked nodes. The tree implies "progress upward"; the tooltip explains one step of it.

## Layer 2 - Marketing overlay

| # | Element | Role | x | y | w | h | z | Note |
|---|---|---|---|---|---|---|---|---|
| M1 | Game logo (JP title) | text | 3.8 | 1.4 | 48.8 | 5.6 | 5 | Text: 'ダダサバイバー' = 'Dada Survivor (Survivor.io Japanese title)'. Yellow italic display type, black outline and drop shadow, baseline horizontal (0 deg). Top-left corner, 3.8% inset. Covers the top of node N1. |
| M2 | Ledge / cut edge (dark slab with white rim) | container | 0.0 | 75.0 | 100.0 | 14.1 | 1 | Polygon (0,82.5)-(100,75.0)-(100,77.9)-(0,89.0). Top rim: 0.6% white line + 0.9% black line, slope -7.7 deg. Slab colour = dark slate. The screenshot is clipped along this line; the mascot stalk goes behind it. |
| M3 | Purple headline band | container | 0.0 | 77.9 | 100.0 | 22.1 | 2 | Polygon (0,89.0)-(100,77.9)-(100,100)-(0,100). 0.9% black outline on its top edge, slope -11.2 deg rising to the right. Magenta halftone dots that get denser toward the right (~4% ink at left, ~100% at right). |
| M4 | Mascot cut-out (purple plant creature) | container | 51.6 | 42.6 | 48.4 | 36.2 | 3 | Large chibi character: two pale bulbs on top, purple spherical head with one giant black-ringed eye, green fin on the right (bleeds off the frame), olive stalk down to the ledge. Head centre ~(74.6, 57). Drawn over the tooltip tail and over the wall, behind the ledge slab. |
| M4.1 | &nbsp;&nbsp;Bulbs (2 pale spheres) | element | 52.4 | 42.8 | 36.2 | 9.3 | 4 | Left bulb ~(700-820, 960-1080), right bulb ~(830-1000, 940-1120) px; pale cyan with black outline; overlap the tooltip tail. |
| M4.2 | &nbsp;&nbsp;Head (purple sphere) | element | 57.5 | 46.1 | 34.3 | 21.6 | 4 | Purple 34.3 x 21.6 disc, black outline; pink cheek blush lower-right. |
| M4.3 | &nbsp;&nbsp;Eye (black ring, dark iris) | element | 55.6 | 50.7 | 13.7 | 13.6 | 5 | Tall ellipse 13.7 x 13.6 on the left of the head, at (55.6-69.3, 50.7-64.3). Highest-contrast spot in the image: focal point. |
| M4.4 | &nbsp;&nbsp;Right fin (green) | element | 92.6 | 51.0 | 7.4 | 12.5 | 4 | Green leaf/fin, bleeds off the right edge. |
| M4.5 | &nbsp;&nbsp;Stalk (olive) | element | 64.4 | 67.4 | 24.2 | 10.6 | 3 | Olive-green stem, 24% wide, disappears behind the ledge slab M2 at y ~75-78. |
| M5 | Headline | text | 1.6 | 84.2 | 96.1 | 14.4 | 4 | Text: 'タレントを進化させて!' = 'Evolve your talents!'. White display type with thick black outline, rotated -9.7 deg (measured on glyph tops and bottoms). Glyph height ~118 px (5.3%). 11 glyphs incl. "!". Starts 1.6% from the left edge and ends 3.9% from the right. |

**What it covers.** M1 hides the top ~70% of node N1 and the end of the diagonal seam. M2 (the ledge slab) hides the bottom 7-17% of the blue wall and the base of the mascot stalk. M3 covers nothing of the screenshot - it lies entirely below the ledge. M4 covers the lower-right quarter of the blue wall and the tip of the tooltip tail; it does not touch the tooltip text, the badge or any node. Together the overlay occupies about 33.9% of the pixels (band 16.5, mascot 9.9, slab 4.7, logo 2.7); about 66.1% of the frame remains screenshot, and every in-game text block stays fully legible.

**How it directs the eye.** The mascot's black-ringed eye at ~(62, 57) is the strongest contrast spot; from there the tilted white headline (M5) pulls the eye down-left along the band, and the band's rising edge sends it back up to the tooltip on the right. The tooltip tail literally points at the mascot, tying the in-game copy ("Lucky Dog: gain 1 skill at battle start") to the character. The logo is the last stop: small, yellow-on-slate, top-left.

## Composition

- **Aspect / grid.** 9:16. Vertical thirds at x 33.3 / 66.7: the tree column sits left of the first third (x 25), the tooltip spans the middle and right thirds, the mascot head centre (~75) is inside the right third. Horizontal thirds at y 33.3 (through the tooltip body text) and y 66.7 (through the stalk / node N5).
- **Focal point.** Mascot eye at approx (62, 57), just left of the lower-right thirds intersection (66.7, 66.7). Secondary: headline centre (49, 91).
- **Reading order.** 1 headline (M5) -> 2 mascot eye (M4.3) -> 3 tooltip (S3) -> 4 node chain (S2) top-down -> 5 logo (M1). Message first, then character, then product proof.
- **Zone split.** Screenshot-only: the top ~75-82% minus the logo corner and the mascot. Mixed: x 52-100, y 43-78 (mascot over wall + tooltip tail). Marketing-dominant: the bottom 18-25% (slab + band + headline).
- **Area budget.** Band ~16.5% of the image, mascot ~9.9%, ledge slab ~4.7%, logo ~2.7% -> overlay ~33.9%. The headline is the widest element (96% incl. outline); the mascot is the tallest (36% of height).
- **Balance.** Two-column split at x ~45: a thin, regular node chain on the left against a heavy tooltip-plus-mascot block on the right. The bottom band is full-width and the headline starts at the far left (x 1.6), counter-weighting the mascot. Top-left logo and bottom-right band corner form a diagonal.
- **Angles.** In-game UI: 0 deg (nodes, tooltip, seams, logo). In-game art: -13.7 deg (upper-wall diagonal seam). Overlay: -7.7 deg (ledge cut), -9.7 deg (headline), -11.2 deg (band edge). The three overlay tilts fan out, so the slab narrows to the right (144 px thick at the left edge, 65 px at the right): a perspective wedge rather than parallel stripes.
- **Text density.** Six copy blocks: logo (glyphs 3.9% tall), badge numeral (1.7%), tooltip title (3.3%), body (2.4%, 3 lines), flavour (1.4%, 2 lines), headline (5.3%). Total text area ~14% of the frame, roughly half of it in-game.

## Structural takeaways

- **Zoom the capture until one callout fills the frame.** The screenshot is not the whole talent screen but a ~2.5x crop: one node column plus one tooltip. The in-game tooltip does the job of a feature label, so the overlay needs only one headline.
- **Cut the screenshot on a tilt, then stack the band under it.** A tilted ledge (with a white rim and dark slab) ends the screenshot cleanly and gives the mascot something to stand on; the band starts below it, so the message never overlaps UI.
- **Three near-parallel tilts, not one.** Ledge -7.7, headline -9.7, band -11.2: close enough to read as one gesture, different enough to create a wedge with depth. The UI stays at 0 deg for separation.
- **Point the in-game callout at the mascot.** The tooltip tail's tip lands on the mascot's bulbs; the UI element and the marketing cut-out become one composition instead of two layers.
- **Logo in the dead corner, over the least valuable UI.** The logo covers only the top of a locked node whose siblings repeat below it - near-zero information loss.
- **Keep all in-game copy uncovered.** The mascot fills the empty wall to the right of the tree and under the tooltip; the tooltip's text block, badge and every node icon remain fully visible.

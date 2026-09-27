# Analysis requirements (user, 2026-09-27, verbatim intent)

When the user presses Start analysis and approves, the tool must do the following.

## 1. Per-image analysis, on 2 layers
Analyse every image on both the screenshot layer and the marketing layer (if there is one).

**Screenshot layer:**
- orientation: portrait or landscape;
- what the screen is, e.g. gameplay battle, gameplay travel, gameplay board, metagame progression (levels, game pass, evolution, etc.), metagame inventory, metagame characters, player profile, etc.;
- main colours;
- what the action is;
- overall atmosphere.

**Marketing layer:**
- background mask: colour, shape and location;
- marketing text: the text itself, colour, font, size and position;
- every extra element (character, item, etc.): what it is, position, pose and colour.

SAVE all of this per image in a database, so the expensive analysis is never repeated for that image.

## 2. Per-game store order
For each game, record the order of images in the store (e.g. title, gameplay battle, metagame roster).
SAVE this per game PER DATE, so changes over time can be compared.

## 3. Patterns across competitors
Find patterns such as:
- the order of images;
- which screenshot types they use at all;
- landscape vs portrait;
- whether a marketing layer exists;
- the marketing layer's position and size relative to the screenshot (mostly screenshot with a small layer, or a small screenshot inside a large marketing image);
- the main colours of the screenshots;
- the main colours of the marketing layers;
- which marketing-layer colours, text or extra elements often go together with a specific screenshot type;
- etc.

## 4. Our game vs the patterns
Show the patterns next to our game's screenshots: are we following them, slightly different, or very different?

## 5. Recommendations
A full description of both the screenshot and the marketing layer for each image, in the recommended order.

## Cross-cutting
- Save all reports and all data. Never analyse the same thing twice.
- Always show progress on screen so the user knows it's working, e.g. "Analyzing image 5 / 80".
- Resumable: save each image's analysis immediately when it's done, not at the end. Skip images that already have data.
- Present a report at the end.
- Wherever an image with analysis data is shown, show an (i) icon; hovering it shows that image's analysis.

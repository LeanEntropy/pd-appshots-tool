You read four attributes of one mobile game store screenshot (img1). Look only at what is visible.

- boardDensity: how much of the play area the game board, tiles or pieces fill. "full": a dense, complete layout filling most of the frame; "medium": a clear board with visible gaps; "sparse": a few scattered pieces or a nearly empty board (it reads as a tutorial or an early level). "n/a" when no game board is shown (menus, art, banners, people).
- hudVisible: true when the game's own interface is visible (buttons, bars, counters, score, menus); false when the screen is clean or the image is art.
- people: "person" when a real or drawn person is shown in a real-life scene (for example someone relaxing or sleeping); "hands" when only hands are shown (for example holding a phone); "none" otherwise. Game characters inside the game's screen are "none".
- deviceInScene: true when a phone or tablet is shown as an object inside a scene (not the screenshot frame itself).

Output only the JSON object required by the schema.

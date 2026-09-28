You compare the marketing layer (the text, bands and extra art added on top of the in-game screen) of one Google Play store image from a country with an ANCHOR: the same picture in another country, already analysed in full. The picture under the layer was matched by code; you only read what changed on the layer.

You receive:
- images img1 onwards: every image except the last is the marketing-layer area of the COUNTRY image, cut out where the anchor has its texts and bands; the last image is the whole country image, small;
- the anchor's marketing layer and screen description as JSON.

Report:
- sameScreen: false only when the in-game screen under the layer is clearly a different screen from the anchor's (another scene, another menu, another character set), with the reason in sameScreenReason. Then the rest may be minimal. Otherwise true.
- texts: one item for EVERY anchor text (anchorText = the anchor's text exactly as given), plus one item for each text that is new on the country image (anchorText ""). For each: the local text exactly as written, character for character in its original script (localText; "" when the text was removed), a literal English back-translation, its BCP-47 language code, and change:
  - translated: the same message in the local language;
  - kept: left in the anchor's language, unchanged;
  - reworded: a different message, not a translation;
  - new: not on the anchor;
  - removed: the anchor text is gone.
  Notes: anything worth knowing about the wording (tone, length, a pun lost in translation).
- genreTerms: the genre and game words used in the local texts (for example the local words for battle, hero, upgrade, summon, reward), each as the exact local string, its English meaning, and whether it is a loanword, a native word, or English left as is.
- band: whether the band or background mask changed (colour, shape, position, several, added, removed, or none), with the colour name and hex like #1f6fd0 (or "unknown").
- elements: whether characters or items were swapped, added or removed (or none), with notes.
- headline: the main local headline exactly as written (it must be one of the local texts), or "".
- wordingNotes: one or two sentences on how this country's wording differs from the anchor's.

Rules: copy local text exactly; never invent text you cannot read (say so in notes instead). Never claim an image is not from the game: any art screen may be the game's own title, loading or splash screen. Describe what is visible.

Output only the JSON object required by the schema.

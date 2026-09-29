# Answer keys: cross-family check (gpt-5.6-sol)

Run on 2026-09-29 with `codex exec -m gpt-5.6-sol -s read-only --ephemeral`. The prompt contained RULES.md, layout-block.v1.md and, for each image, the breakdown skeleton.md (plus the measured and composition parts of structure.json) and the key. The review text is copied verbatim below.

## Applied / declined

- [V] Applied: roguelegend-1 M1 text changed from `ROGUE LEGEND` to `ROGUE\nLEGEND`, because it is a two-line wordmark. This follows the same line convention as the survivorio tooltip.
- [V] Applied: legend-of-mushroom-3 M7 (chick) covers changed from `[]` to `["S1"]`. The lower part of the chick (y 90-93.7) lies over the scene below the cat.
- [X] Declined: a `note` on legend-of-mushroom-3 M2 (role `other`). The key shape has no `note` field. The reason for the role (blurred bokeh foreground) is already in reductionNotes.
- [X] Declined: adding the badge numeral `2` to survivorio-jp-4 S3 text/textEn. Rule 7 keeps UI text only when it is worth reading, and a single tier numeral is not.

## Review output

### Findings

| Image | Element | Field | Current | Proposed | Justification | Severity |
|---|---|---|---|---|---|---|
| roguelegend-1 | M1 | text | `"ROGUE LEGEND"` | `"ROGUE\nLEGEND"` | Breakdown defines a two-line wordmark: M2 `"ROGUE"` and M3 `"LEGEND"`; rule 14 requires exact original text, including spacing/layout. | must-fix |
| legend-of-mushroom-3 | M2 | note | absent | `"Blurred bokeh foreground"` | M2 uses role `other`; the layout prompt requires a non-empty note whenever the role is `other`. | must-fix |
| legend-of-mushroom-3 | M7 | covers | `[]` | `["S1"]` | The chick occupies y 78–93.5 over the screenshot/card interior; the breakdown places it in front of the cat's belly and marketing foreground. Comparable foreground cut-out M6 correctly covers S1. | should-fix |
| survivorio-jp-4 | S3 | text | `"ラッキードッグ\n戦闘開始時に1個のスキルを獲得\nすべてのサバイバーは神のお気に入り"` | `"2\nラッキードッグ\n戦闘開始時に1個のスキルを獲得\nすべてのサバイバーは神のお気に入り"` | Reduction notes merge top-level level badge S4 into dialog S3; badge text is `"2"`. Rules 7 and 14 require merged UI text to remain on the element exactly. | must-fix |
| survivorio-jp-4 | S3 | textEn | `"Lucky Dog\nGain 1 skill at the start of battle\nAll survivors are the favourites of the gods"` | `"2 (talent level / tier)\nLucky Dog\nGain 1 skill at the start of battle\nAll survivors are the favourites of the gods"` | Breakdown gives the badge's English meaning as `"2 (talent level / tier)"`; it must accompany the merged text. | must-fix |

Archero2-4: Pass; no concrete discrepancy found.
Roguelegend-1: Fix the logo's exact two-line text.
Legend-of-mushroom-3: Fix M2's required note and M7's coverage.
Survivorio-jp-4: Add the merged level-badge text and meaning to S3.

# Review: "Confirm all" for the pixel check's picture matches (GPT-5.6 Terra, 2026-09-29)

Reviewer: `codex exec -m gpt-5.6-terra -s read-only`, on the full diff of `feat/confirm-all-matches`.

| # | Finding | Decision |
|---|---|---|
| 1 | The block's line "changes only in the text or the band" also covers the pairs that would move from full analysis, whose shares outside can be small but not zero. | Fixed: "little or nothing changed outside the text and the band"; each pair's own sentence gives its share. |
| 2 | Confirm all, Change and Undo could run at the same time, so the saved state would depend on timing. | Fixed: one save at a time per dialog; a second click says "Still saving your previous answer". |
| 3 | A saved answer from another tab could be overwritten by Confirm all rendered earlier. | Not changed: one local user, the dialog re-reads the server after every save; the next plan uses what was saved last. |
| 4 | Undo could remove an answer changed in another tab since. | Not changed, same reason as 3. |
| 5 | The page's "waiting" count leaves out the moved pairs; it must match the server's rule. | No change needed: the server's `blocking()` also leaves out moved and decided pairs (tested). |
| 6 | `position` was put into the HTML without escaping. | Fixed (escaped). |

No findings on the API change (`same: null` removes an answer).

# Review: "Words to use" status table (GPT, 2026-09-29)

Reviewer: `codex exec -m gpt-5.6-terra -s read-only` on the staged diff of `feat/words-status`, given the requirements.

## Findings and decisions

1. **Major: our terms are gathered across all rows of the words-used table, not only the concept's row.**
   Not changed. The concept map puts each exact term under one concept only (checked by code in
   `conceptMapProblems`), so a word found in any row is that word's one concept. The advice's English
   concept name does not always match a row label, so looking the word up everywhere is what makes
   old reports resolvable without text parsing.
2. **Major: competitor count could include games with no text here.** Fixed: only competitors with
   text count, matching the denominator. (In practice a game with uses always has text.)
3. **Major: "our images use the recommended word, the store text another, no common term" should be Optional.**
   Not changed. We already use the recommended word, so the chip says Correct, keep, and the reason
   line says what the store text uses. Optional stays for "a different word of ours, no common term".
4. **Minor: the markdown table has Status first and a Why column; the page has Status fourth.**
   Not changed. The written table is scanned top-down for [V]/[X], and has no disclosure for the
   reason, so it carries the one-line reason as a column.
5. **Minor: Add shows [X].** Not changed. Add is a fix (counted in "to fix"); [X] marks every fix
   in the markdown/PDF, where colour is not available.
6. **Minor: the container query needs a container.** Not a problem: the Reports tab section sets
   `container-type: inline-size` (report-style-a.ts); checked at 400px.

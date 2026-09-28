# Review: plan-games-library (gpt-5.6-terra, 2026-09-29)

Reviewer: gpt-5.6-terra via `codex exec -s read-only --ephemeral`, plan and code excerpts passed inline (the sandbox could not read the repo). Raw output below; outcomes are in the plan's "Review outcome" section.

1. **High — §0, §6:** The plan schedules the library after selected items, but not after *everything else*. It even places G3 before store history, while the user explicitly made this feature “scheduled LAST.”  
   **Fix:** State that no G1–G3 work begins until all approved higher-priority work, including 12D/store history, is complete; remove G3 from this plan or defer it to the store-history work.

2. **High — §3.3:** Project stamps do not include deck contents. A refresh can overwrite an existing deck with the same key while changing `fetchedAt`, status, slots, or hashes; neither `project.json.updatedAt`, run-directory names, deck key list, nor necessarily the final job file changes. The index can remain stale indefinitely.  
   **Fix:** Stamp each deck’s content (or a stable hash of every deck manifest) and include it in the project part stamp.

3. **High — §3.3:** The library stamp hashes only key names. Updating an existing analysis record or replacing the same-day store-text snapshot leaves keys unchanged. “Update the list rebuilds everything” only works if it explicitly bypasses stamps and rereads contents; that is not specified.  
   **Fix:** Make manual rebuild a true forced rebuild. For automatic freshness, include content hashes/version timestamps of relevant records and store-text snapshots, or accept clearly bounded staleness without claiming automatic detection.

4. **High — §3.2:** A walk of `library/analysis/` alone cannot calculate `analysed[appId]`: analysis records are keyed by image hash and analysis key, not by game. The same shared image may belong to multiple games, and multiple records may exist for it.  
   **Fix:** Derive app-to-image membership from project deck/refs parts, then count distinct image IDs with at least one usable record. Do not count analysis files directly per app.

5. **High — §3.3, §1.1:** “Previous list at once with live progress” is not credible with the shown synchronous `Storage` interface and a server-side rebuild. A synchronous scan blocks the Node event loop, so the browser cannot receive intermediate progress; it also conflicts with “nothing runs in the background.”  
   **Fix:** Keep page-open validation bounded and return the cached index immediately; make rebuilding an explicitly user-started resumable job using the existing job/progress mechanism. Otherwise drop live-progress and sub-second claims.

6. **Medium — §2, §1.2:** Store text is selected as the shared library’s latest snapshot, while screenshots and analysis are presented “as the chosen project sees them.” This can silently combine a project’s old deck with text read later by another project.  
   **Fix:** Define and show provenance for each text snapshot, and either select the snapshot associated with the viewing project/current deck or explicitly label it as the latest shared text and its read date/source.

7. **Medium — §1.2, §7:** `samePicture()` is only a pairwise perceptual-similarity predicate. It does not select a unique main-country counterpart when duplicate/near-duplicate screenshots exist, nor does the excerpt show it applying saved “different” decisions.  
   **Fix:** Reuse the report matching result/rules, or define deterministic one-to-one matching, tie-breaking, and how explicit user decisions override matches. Test duplicate and reordered near-identical images.

8. **Medium — §1.1, §3.1:** Country display rules conflict. The plan says flags are for pages with at least one screenshot, but also says unavailable pages get a dimmed flag. The listed `countries` type supports unavailable entries, yet `countriesWithImages` does not.  
   **Fix:** Separate “checked countries” from “countries with images”; render unavailable checked pages dimmed, exclude them from image counts, and make country-filter semantics explicit.

9. **Medium — §4, §8:** Route behavior is inconsistent: §4 says malformed `appId` returns 404, while tests require 400. Query `project` validation is also underspecified.  
   **Fix:** Choose one contract (prefer 404 for unknown/malformed game pages if avoiding identifier probing, or 400 consistently for malformed API input), validate `appId` and `project` against strict patterns before storage access, and require that the project actually uses the indexed game.

10. **Medium — §4:** The claim that existing icon routes “already refuse images the project does not reference” is not true for `icons/`: `staticKey()` serves any allowed file under that project’s `icons` directory. This is scoped to the project, but it is not reference-gated like library images.  
    **Fix:** Correct the claim; select icons only from validated index data and ensure the game endpoint never accepts a caller-provided arbitrary static path.

11. **Medium — §1.2:** Deck slots can have `imageId: null` when download failed. The proposed strips assume every slot has a thumbnail, hash comparison, and `(i)` data.  
    **Fix:** Render an explicit “Screenshot could not be saved” placeholder with store position, no image URL, no misleading mark, and preserve it in counts/order semantics.

12. **Low — §1.1–§1.2:** Several country references lack flags despite the requirement that every country mention has one: “Same file as United States,” “main country,” chart rank “#3 in Japan,” and textual country headings/examples.  
    **Fix:** Route every rendered country label through the shared flag helper, including comparison marks, tooltips, ranks, folded text groups, and empty states.

13. **Low — §2, §3.2:** Name, developer, category, icon, and rating have multiple possible project sources but no deterministic conflict rule or displayed provenance. Two projects can hold contradictory metadata.  
    **Fix:** Define precedence (for example, newest successful page per locale, then newest cached lookup), retain source/date in the index, and label disagreements rather than silently picking one.

14. **Low — §3.4:** The performance numbers are asserted without accounting for synchronous recursive `Storage.list()` scans and JSON parsing across all analysis/store-text files during stamp checks. A synthetic test alone does not make the ≤200 ms target realistic on ordinary disks.  
    **Fix:** Treat these as measurements, not guarantees; benchmark cold and warm filesystem cases, and avoid scanning every analysis key on ordinary page opens.

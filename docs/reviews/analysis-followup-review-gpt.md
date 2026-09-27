# Identity block and title/feature image taxonomy: cross-family review (gpt-5.6-sol)

- Reviewer: `codex exec -m gpt-5.6-sol -s read-only --skip-git-repo-check --ephemeral` (10-minute timeout), with the request and the changed files inlined. Date: 2026-09-27.

## Reviewer output (verbatim)

- **Medium** — `src/analysis/identity.ts`, `identityBuilder/nameOf`: title cache is keyed only by `appId`, so the first locale read supplies the game name for every country/language appearance and can make output dependent on record traversal. **Fix:** key cached titles by `appId|gl|hl` (keeping configured names as app-wide fallbacks).

- **Medium** — `src/analysis/record-refresh.ts`, `refreshRecord`: records with any existing `mappedFrom` are never reconsidered, even after `TAXONOMY_MAPPING` changes. The mapping version is only embedded in free-text `rule`, so stale mappings persist. **Fix:** store a dedicated `mappingVersion`; remap when it differs, retaining the original pre-mapping classification separately.

- **Medium** — `src/analysis/record-refresh.ts`, `mapKeyArt`: any marketing element with `kind === "logo"` is treated as evidence of the game logo, so publisher/platform/partner logos can incorrectly convert `key_art` to `title_image`. **Fix:** require `title_logo`, recognized game-title text, or explicit evidence that the logo is the game logo; otherwise leave unchanged or map to feature image when supported.

- **Low** — `src/analysis/identity.ts`, `identityBuilder`: `appearances` comes only from `ImageDb.sources`; deck manifests are consulted only for titles/Google IDs. Missing or stale DB source entries therefore violate the requirement to rebuild all appearances from both sources. **Fix:** index current deck manifests by `imageId`, reconcile them with DB sources, then sort/deduplicate the combined appearances deterministically.
## Outcome (all four applied)
- Game names: configured names are app-wide; other games use the store title per country-language.
- The mapping version is stored per record (`mapping`), along with the model's original type, subtype and orientation (`mappedFrom`). When the version changes, the mapping is applied again from the original. Tested.
- A logo element counts as title evidence only if it is the game's own logo (its description names the game or says "game logo/title"). A publisher logo does not count. Tested.
- Appearances combine image-database sources with every current deck manifest, deduplicated and sorted.

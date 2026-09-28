# Milestone 3 code review (gpt-5.6-sol)

Date: 2026-09-28. Reviewer: gpt-5.6-sol via Codex CLI (`codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium -s read-only --skip-git-repo-check --ephemeral`), cross-family. Input: the milestone 3 scope, plan sections 1.2, 2.4, 3 and 4, the stated deliberate deviations, the diff of the changed files and the new files inlined (`src/play/{input,queue,lookup,icon}.ts`, `src/config/countries.ts`, `src/server/{routes-play,routes-setup,app-server,http-util}.ts`, `src/view/wizard-*.ts`, `src/view/action.ts`, and the new tests). A first run that asked the reviewer to read the files itself returned nothing: the read-only sandbox on Windows refused every command, so the files were inlined.

## Outcome

10 findings: 7 fixed, 1 partly fixed, 2 declined.

| # | Sev. | Finding | Outcome | What was done / why |
|---|---|---|---|---|
| 1 | High | The project is written only after the icon download (up to 10 s), so closing the page then loses it | Fixed | `project.json` and the registry entry are written first; the icon is fetched afterwards and added to the saved settings. Test: an icon download that hangs, while the project is already on disk and in the registry. Competitor adds still wait for their icon: the add is one action with its own error message, and nothing earlier is lost |
| 2 | High | A country change queued behind another save reads the page later; after moving to another step it finds no ticks and saves "United States only" | Fixed | The ticked countries are read when the change happens, not when its save runs. The tier menu keys its change by game, not by row number, and the redraws after a save skip a step that is no longer shown |
| 3 | Med. | "Download preview" is not a button in the page (terminal commands instead) | Declined (scope) | Store check and download inside the page are milestone 4 in the approved plan; the task for this milestone asked to show the next step clearly, pointing to the terminal command for now. The project page does so, with Copy buttons |
| 4 | Med. | Unreadable Play cache entries are not kept aside; an unexpected Play answer is not logged | Fixed | An unreadable or invalid cache entry is copied to `<key>.bad-<time>` and read again from Google Play; an unexpected answer logs its shape and the mismatching fields to the terminal (the page still gets the plain sentence). Test added |
| 5 | Med. | Closing the page right after a change can cancel its save | Partly fixed | Every write from the pages now uses `keepalive`, and the wizard asks before closing while a save is running or the project name was typed but not saved yet. Name saving stays on `change` (on leaving the field), which is what a typed name expects |
| 6 | Med. | No length bound on package IDs (they become a storage key) | Fixed | Package IDs are 3 to 150 characters; names stay 2 to 100 (already enforced by the input parser). Tests added |
| 7 | Med. | `configs/countries.json` is read without the storage layer | Declined | The storage rule (plan 12B) covers workspace data. The catalogue is tracked tool configuration read the same way as `configs/defaults.json` (`config/project.ts`); the `node:fs` allow-list test is unchanged and passes |
| 8 | Med. | Unexpected server failures send the raw error text to the page | Fixed | The details go to the terminal; the page gets "The tool could not finish this. Try again; if it keeps happening, restart the tool (npm start) and look at its terminal." |
| 9 | Low | The same-origin check ignores the scheme | Fixed | The origin must be `http:` as well as a local host with this server's port |
| 10 | Low | The save conflict check uses a millisecond timestamp | Fixed | Settings writes of one project now run one after another on the server (a per-project queue); the conflict check stays as a second guard |

Areas the reviewer checked with no finding: the Play queue (serialising, spacing, failure recovery, interactive first), icon fetching (hosts, no redirects, size and pixel caps; no SSRF or path traversal), escaping in the wizard scripts (no XSS found), write-route security (token, JSON, same origin, 64 KB, local host), duplicate and own-game refusals, the "Survivor.io" fallback, refusal of competitors not on Google Play in the US, US English first with catalogue languages, and the 409 on finished projects.

All tests (148), `npm run typecheck` and `npm run lint` pass after the fixes.

## Raw review

## High

1. `postProject()` does not make the project durable when step 1 is confirmed (`src/server/routes-play.ts:105`). `fetchIcon()` is awaited before `project.json` and the registry entry are written. That fetch can take up to ten seconds. Closing the browser, stopping the server, or a hung CDN request during "Creating the project..." leaves no resumable project, despite the requirement that the project exists from the moment step 1 is confirmed. Fix: write the minimal validated settings and registry entry first, return the created project, then fetch the icon as best-effort background work and patch `iconFile` afterward. Apply the same principle when adding competitors: metadata should be saved before waiting for icon processing. Missing test: use a fetcher that never resolves, and assert that the project is already readable/resumable after confirmation.

2. Queued country saves can silently replace the selection with US only (`src/view/wizard-countries.ts:44`, `src/view/wizard-script.ts:39`). `saveCountries()` passes a deferred builder, `autosave(() => ({ markets: pickedMarkets() }), ...)`. Builders run only when their turn in `saveChain` arrives. If another save is already running and the user changes a country and navigates away, the countries DOM has been removed by the time `pickedMarkets()` runs. It finds no checkboxes and sends `markets: []`, which the server converts to US-only. This loses confirmed work without warning. Fix: snapshot before queueing. Missing test: browser-level test with a delayed first save, a second country change, then immediate navigation to step 4; verify both selections remain.

## Medium

3. The required browser "Download preview" action is not implemented (`src/view/wizard-review.ts:16`, `src/view/pages-html.ts:45`). Step 5 says "Create project," then the project page says the browser workflow "arrives in the next update" and asks the user to run terminal commands. Section 1.2 requires "Check the store" to start the existing preview as a background job with live progress and approval numbers. Fix: expose the preview job through the project page, invoke it with `act()`, show live progress and the approval totals.

4. Corrupt Play caches are neither quarantined nor diagnosed (`src/play/lookup.ts:138`, `:174`). Invalid JSON, an invalid cache wrapper, or an invalid cached value is silently treated as a miss. The requirement says unreadable entries are moved aside before refetching. Likewise, unexpected scraper shapes are converted to `PlayProblem`, but the raw shape is never logged as required. Fix: quarantine the exact cache key (`.bad-<timestamp>`) and log a bounded description of the failed scraper value.

5. Closing or navigating away can cancel saves that the wizard presents as autosaves (`src/view/action.ts:40`, `src/view/wizard-game.ts:86`). `send()` does not use `keepalive`, and page links do not wait for `saveChain`. The name is saved only on `change`, which is not reliable during unload while the field is focused. Fix: snapshot changes immediately, use keepalive requests, block navigation while `saveChain` is pending, save the name on debounced `input` or blur plus a final unload-safe flush.

6. Play request validation does not implement the specified 2–100-character boundary (`src/server/routes-play.ts:27`, `src/play/input.ts:47`). The route accepts up to 500 characters, while package IDs have no length bound at all. A very long dotted value can become a cache key/path segment and produce filesystem errors. Fix: separate strict query schemas, and a practical maximum on package IDs.

7. New country-catalogue code bypasses the required storage boundary (`src/config/countries.ts:3`, `:44`). `loadCountries()` reads the filesystem directly through `util/fsx.ts`, against section 12B. Fix: a read-only tool-resource adapter under `src/storage`.

8. Unexpected server failures expose internal error text to the page (`src/server/app-server.ts:138`). The top-level handler returns `e.message` verbatim. Fix: log the details server-side and return a stable plain message.

## Low

9. Same-origin comparison does not include the scheme (`src/server/http-util.ts:49`). An `https://localhost:<port>` origin is accepted. The write token is still a strong mitigating control. Fix: compare the full origin including `http:`.

10. The optimistic-save version is a millisecond timestamp (`src/server/routes-setup.ts:145`). Concurrent saves within the same millisecond can share `updatedAt`. Fix: an integer revision, or serialize updates with a per-project mutex.

## Areas checked with no finding

- Play queue serialization, pacing after completion, failure recovery, and interactive-over-background selection are sound.
- Icon fetching correctly restricts HTTPS hosts, refuses redirects, caps bytes and decoded pixels, and stores a re-encoded PNG; no SSRF or path-traversal finding there.
- Wizard-rendered Play and project data is consistently escaped; no concrete XSS was found in the supplied scripts.
- Write routes use the token, JSON gate, same-origin check, and 64 KB body cap. The server also binds to and validates local hostnames.
- Duplicate competitors and adding the user's own game are refused correctly.
- The deliberate dotted-name fallback is implemented correctly.
- Refusing a competitor unavailable in US Play is implemented consistently.
- US-English is forced first, catalogue alternatives are checked, and the specified default Asia markets are present.
- Finished projects correctly reject wizard settings changes with 409.

## Follow-up review: competitors not on Google Play in the United States

Date: 2026-09-28. Reviewer: gpt-5.6-sol (same invocation), on the diff of the change that allows such competitors (user decision): lookup in the project's other countries, the reference warning, and the pipeline showing them as left out of the US core. The change also treats a Play page marked `available: false` as "not available" (found live: Google Play serves a Japan-only game's page for country=us).

3 findings: 2 fixed, 1 declined.

| # | Sev. | Finding | Outcome | What was done / why |
|---|---|---|---|---|
| 1 | Med. | A save that adds a country and a competitor together looks the competitor up in the old country list | Fixed | The countries of the save are checked first and used for the lookup. Test added |
| 2 | Med. | Lookup cache entries written before the availability check would still count a not-sold game as in the US for up to 24 hours | Fixed | The details cache key is versioned (`<gl>-<hl>.v2.json`), so older entries are read again. The download's store-page cache is per project and expires after 24 hours; a store check after that reads the availability afresh |
| 3 | Low | No direct test of the download listing with `available: false` | Declined | `PlayClient.listing` calls the scraper directly (not injectable), and making it so is outside this change; the path was checked live (the Japan-only game's US page comes back "unavailable", 0 screenshots), and the lookup path has a test |

Areas with no finding: order of the fallback countries, the core fit leaving the competitor out, the download preview, grid and report wording, and the saved reference warnings.

### Raw review

- **Medium — `src/server/routes-setup.ts`, `postSettings`: new competitors are looked up using stale markets.** The first lookup uses `before.markets`, so a settings request that adds a market and a competitor together rejects a competitor available only in the newly added market. Build the merged settings first and pass its markets to `detailsAnywhere`. Add a combined-update regression test.
- **Medium — `src/play/lookup.ts`, `PlayLookup.details`: old cached US results bypass the new availability check.** Previous versions cached normalized `PlayDetails`, losing `available:false`; those entries remain valid for 24 hours and are treated as US-available, so the warning/reference is missing. Version the details-cache key or invalidate legacy entries.
- **Low — `src/play/client.ts`, `PlayClient.listing`: missing direct regression test.** Tests cover `available:false` through lookup, but not the download-listing path that must emit an `unavailable` manifest with no screenshots.

No finding: alternate-country ordering, core-fit exclusion, preview/grid/report presentation, and persisted reference warnings are otherwise handled consistently.

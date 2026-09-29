# Review: project open performance (gpt-5.6-terra, 2026-09-29)

Findings from the cross-family review, with what was done:

- Same-screen status restarted after its own writes: FIXED (the entry is kept under the stamp it ends with).
- Cache keyed without the workspace: FIXED (keys include the workspace).
- Per-entry TTL ignored: not so in the reviewed code (current() uses e.ttlMs).
- External writes without the marker: by design, every tool process touches the marker on its writes; hand edits of data files are not detected.
- Cached objects shared by reference: kept; responses are serialised, no caller mutates them. Records are handed out as copies.
- Shell waits for the state: state is cached 5 s and costs tens to a few hundred ms; accepted.

## Raw review

- `src/server/project-data.ts:49-56` — **high**: A same-screen run that writes results invalidates its own cache entry in `finally(flushDataChanges)`. The next `/api/same-screens` poll sees the old stamp, starts the expensive check again, and reports `running: true`; the “done” state may never be observable. Track completion against the post-run stamp (without masking unrelated concurrent writes), or use a dedicated same-screen scheduler/cache that invalidates dependent page data but retains the completed-check status.

- `src/storage/changes.ts:108-118` — **high**: Direct terminal writes are not detected. `dataStamp()` only notices changes to `.locks/data-changed`, but an external command that edits project/library data does not touch that marker. The test manually touches the marker, which does not validate the requirement. Add a filesystem watcher (or equivalent robust data-directory change detection) that bumps the workspace stamp for external writes.

- `src/server/computed.ts:36,65,73` — **high**: Cached derived objects are returned by reference. Callers of `get()` and `peek()` receive the same mutable report list, suggestions, builder response, and view model held in the cache, violating the requirement that callers cannot mutate shared cached objects. Keep an internal immutable/deep-frozen value or return a `structuredClone` per consumer.

- `src/server/computed.ts:28` — **medium**: Per-entry TTL is ignored: `current()` compares with `this.ttlMs`, not `e.ttlMs`. Consequently `stateNow(..., STATE_KEEP_MS)` is retained for five minutes rather than five seconds, leaving clock/job-derived state stale. Use `e.ttlMs`.

- `src/server/computed.ts:27-38` — **high**: Cache entries are keyed only by `key` (for example, `"<projectId>:reports"`), not workspace. Two workspaces with the same project ID and equal initial stamps (`0:0`) can receive each other’s cached data. Include a canonical workspace identifier in the map key; ideally make the generation counter workspace-scoped too.

- `src/server/routes-project.ts:99-103` — **high**: The streamed project shell still waits for `stateNow()`, which runs `projectState()` before headers or the loading placeholder are sent. The diff itself notes state requests can cost seconds, so this does not meet the under-one-second shell requirement and does not asynchronously placeholder the stage/steps. Send a minimal shell immediately, then fetch/render state and the heavy view data asynchronously.
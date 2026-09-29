# Review: share and import a project (milestone 3b)

Reviewer: gpt-5.6-sol (Codex CLI, read-only, diff inline), 2026-09-29. 8 findings: 5 accepted, 3 partly accepted, 0 declined.

| # | Severity | Finding | Outcome | What changed |
|---|---|---|---|---|
| 1 | Critical | Analysis records accepted with any status and any `updatedAt` string; string comparison lets a package win every later merge | Accepted | Status must be a known one, `updatedAt` a real ISO time not in the future, `final` an object or null; times compared as dates; replacement only by a usable record (the tool's own `isUsable`) that is strictly newer, or when the local one is unusable. Test added. |
| 2 | Major | Privacy: broad export, only paths and user name scrubbed | Partly accepted | E-mail addresses are now removed from every exported text value (store pages keep their developers' public contact addresses). A field-level allow-list of every project file was not built: the workspace holds no credentials, and paths, user name, other projects and e-mails are covered. Test added. |
| 3 | Major | Most files only checked as "any JSON object"; markdown unchecked | Partly accepted | Report definitions and the competitor pick now pass their schemas too (besides settings, refs, journal, facts, Google-id links, analyses, cost records, pictures). Markdown is shown only through the existing escaping renderer, so it cannot carry script. |
| 4 | Major | Preview trusts the manifest | Accepted | The summary is now built from the package's own project.json and refs.json; a manifest whose project, name, game or kind (originals present or not) differs is refused. Test added. |
| 5 | Major | Two entries could land on one destination after a copy's rename | Accepted | Every destination is computed before writing; a duplicate refuses the import. |
| 6 | Major | Export reads files while an analysis or download may change them | Partly accepted | Export is refused while this project's analysis or download runs. No full snapshot (reads of write-once library files are stable; project files are written atomically). |
| 7 | Major | Work after the switch could fail a live import | Accepted | `shared-from.json` is written into the staging folder before the switch; after it, nothing can fail the import. |
| 8 | Minor | Entry-limit rejection left the zip reader open | Accepted | The zip is closed at once. |

Found by the real check (not the reviewer): a hand-made side file in the library's analysis folder (not a record) stopped the import; such files now travel as plain JSON. An e-mail rewrite that ran on raw JSON text could break an escape (`\n`); it now runs on parsed values.

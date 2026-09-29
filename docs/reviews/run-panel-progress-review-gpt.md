# Run panel progress: code review (gpt-5.6-terra)

Date: 2026-09-29. Reviewer: `codex exec -m gpt-5.6-terra -s read-only` on the full diff (inline).

## Findings and what was done

1. **High (as rated): `runAnalysis` (Pilot, Full check) has no step list and its text calls are not stop-guarded.**
   By design, not a bug. This change covers the report runner (R4). The Pilot and Full check keep their
   earlier behaviour: during their patterns and recommendations the button reads "Stop", and the message says
   those parts finish first. Nothing claims to stop them. A step list for them can follow later.
2. **Medium: images never started after Stop get no outcome.**
   Kept as is. The panel shows them as "not done (the run ended first)", which is their real state.
   The tally counts them as "not done".
3. **Medium: an unexpected exception in a text comparison marks the image failed and rethrows without counting it.**
   Kept as is. The exception fails the whole job, so the progress count no longer matters. The job ends as failed, with the error shown.
4. **Medium: an exception during the text steps leaves a step "running" in the journal.**
   Handled in the panel. When the job is no longer running, a "running" step shows as "not finished" and a
   "running" image as "not done". Nothing stays spinning.

No other findings.

# R4 code review (country reports run end to end), gpt-5.6-terra

Date: 2026-09-29. Branch `feat/r4-country-reports`, reviewed at d244865 (diff of `src` and `prompts` against 84c13d4).
Reviewer: gpt-5.6-terra through Codex CLI (`codex exec -s read-only --ephemeral`). The diff, the R4 requirements (approval with cost, runtime limit, doubtful matches first, no escalation of a different screen, partial versions, free builds, report content rules) and the deliberate choices were given on stdin.

## Findings and outcome

| # | Sev. | Finding | Outcome |
|---|---|---|---|
| 1 | High | The approval omits the main country's synthesis calls (recommendations, their check, A/B tests) | Partly right. The approval already lists "Recommendations for the main country (text only)" at the synthesis estimate (pattern wording, recommendations, check and revision) whenever the main country is in the report. The extra A/B call was real: fixed with finding 4. |
| 2 | High | An approval could be replayed after later jobs, because only the latest job's approval id was checked | Fixed. Each batch keeps every approval that started one of its runs; a used approval is refused for good ("This approval was used already"). Tested with two failing runs and a replay. |
| 3 | Medium | The limit reached during the written parts did not mark the run or the version as partial | Fixed. When the limit runs out during the text-only steps, the version carries a "Partial version: the spending limit ... was reached while the written parts were made" banner, the run ends as stopped for the limit, and the run panel says which parts were not made. |
| 4 | Medium | The main country's synthesis wrote A/B tests that the report then wrote again | Fixed. The report writes its A/B tests once, over every country (the main one included); the main country's synthesis no longer asks for them. |

## Checks after the fixes

- `npm run typecheck`, `npm run lint`: clean. `npm test`: 282 of 282 pass (after merging origin/master with the flags helper and the add-countries picker).
- Real smoke test on a scratch copy of the Rogue Legend workspace (never the real one): One country, Thailand, 4 competitors, 5 text comparisons plus words used, country advice with its GPT second opinion and the A/B tests. $0.88 on Claude against a $1.00 cap, no failures; a free rebuild afterwards reused every written part (nothing missing).

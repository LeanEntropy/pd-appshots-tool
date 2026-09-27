# Cross-family re-review of plan-v1.md (GPT), round 2: did findings F1-F16 land?

- Reviewer: `gpt-6-astra` via `codex exec -m gpt-6-astra -s read-only --ephemeral` (Codex CLI 0.153.4), 2026-09-26
- Input (inlined): review 1, the orchestrator decisions, the revised plan-v1.md and product-proposal-v1.md. Section H of the proposal was intentionally left unchanged.
- Prompt: scratchpad `review2-prompt.md`. Verbatim output below. Fixes are NOT applied.

---

| # | Status | Where it landed (section) | Residual issue |
|---|---|---|---|
| 1 | partial | Plan §1, §8 | M0 probe covers capabilities, but does not explicitly verify authenticated private publishing/access. |
| 2 | landed | Plan §6 | - |
| 3 | partial | Plan §3–5 | Preserves all images, but still assigns device class from aspect ratio without supporting metadata. |
| 4 | landed | Plan §3–4 | - |
| 5 | landed | Plan §4, §7 | - |
| 6 | landed | Plan §3, §10 | - |
| 7 | partial | Plan §3, §4 S8, §6 | Low-distance pHash links become matches automatically; verified correspondence is still missing. |
| 8 | partial | Plan §4.1 | Position-agnostic denominator and meaning of “N” remain undefined; our app’s weight is unspecified. |
| 9 | landed | Plan §3, §6 | - |
| 10 | partial | Plan §3, §5, §8–9 | Preflight omits explicit pilot accounting and understates review exposure; unsupported “measured” Haiku cost remains. |
| 11 | landed | Plan §3, §6 | - |
| 12 | landed | Plan §4 S2b, §6 | - |
| 13 | landed | Plan §3, §6 | - |
| 14 | landed | Plan §3, §9 | - |
| 15 | partial | Plan §2; Proposal §F | Obligations and revised reasons landed, but unsupported verification claims remain presented as checked facts. |
| 16 | partial | Proposal §B–G; Plan §0, §4, §6 | Five steps and future media scope landed; fixed two-page layout is absent and some approval items remain bundled. |

New problems:

- **High:** Proposal H27 requires phone-only screenshots; plan §3–4 retains all device classes.
- **High:** Proposal H30 requires V1 media downloads; plan §4/§6 defers both feature graphics and video.
- **Medium:** Proposal H24 includes US baseline for chart games; plan §4.1 restricts chart games to markets where they chart.
- **Medium:** S4 measurements depend on regions identified by L1, but L1 runs later at S6; no second measurement pass is specified.

Verdict: Rework the partial findings and internal contradictions before approval.
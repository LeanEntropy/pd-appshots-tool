---
description: Plan an analysis batch (core pilot or core check), show the approval screen, and run it only after the user says yes
argument-hint: "[pilot|core]  (default: pilot)"
---

Run a screenshot analysis batch with an explicit approval gate. The main place to start an analysis is the gallery (`npm run gallery`, then "Start analysis"); this command is the same gate from Claude Code.

1. Batch: `$ARGUMENTS` if it is `pilot` or `core`, otherwise `pilot`.
2. Run `npm run <batch> --silent` from the repo root. It only computes the approval screen: no AI call.
3. Show the user the approval screen exactly as printed: games and positions, images by cost level, model passes, and estimated cost. Do not summarise away any numbers.
4. Ask the user: "Approve and run this batch?" Then STOP and wait for their answer.
5. Only if the user clearly answers yes: run `npm run <batch> --silent -- --yes` in the background and report progress. The tool refuses if the batch changed since the screen was shown; in that case show the new screen and ask again.
6. If the user says anything other than yes, do not run it.
7. When it finishes, give the path of the report it prints, and suggest opening the gallery (`npm run gallery`) to see the analyses in the comparison grid.

Never pass `--yes` without the user's explicit yes in this conversation. Never change the config or the pick to make a batch fit.

---
description: Plan an analysis batch (core pilot or core check), show the approval screen, and run it only after the user says yes
argument-hint: "[pilot|core] [project id]  (default: pilot, the most recently opened project)"
---

Run a screenshot analysis batch with an explicit approval gate. The main place to start an analysis is the tool's page (`npm start`, open the project, then "Start analysis"); this command is the same gate from Claude Code. It uses the same AI lock as the page: while any project analyses in the page, this command is refused, and the other way round.

1. Batch: the first word of `$ARGUMENTS` if it is `pilot` or `core`, otherwise `pilot`. Project: the second word of `$ARGUMENTS` if given; otherwise run `npm run projects --silent` and use the first project listed that is not archived (the most recently opened).
2. Run `npm run <batch> --silent -- --project <id>` from the repo root. It only computes the approval screen: no AI call.
3. Show the user the approval screen exactly as printed: games and positions, images by cost level, model passes, and estimated cost. Do not summarise away any numbers.
4. Ask the user: "Approve and run this batch?" Then STOP and wait for their answer.
5. Only if the user clearly answers yes: run `npm run <batch> --silent -- --project <id> --yes` in the background and report progress. The tool refuses if the batch changed since the screen was shown; in that case show the new screen and ask again.
6. If the user says anything other than yes, do not run it.
7. When it finishes, give the path of the report it prints, and suggest opening the tool (`npm start`) to see the analyses in the comparison grid.

Never pass `--yes` without the user's explicit yes in this conversation. Never change the settings or the pick to make a batch fit.

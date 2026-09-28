import type { Storage } from "../storage/index.ts";
import type { LockInfo } from "../storage/leases.ts";
import { readJournal } from "./journal.ts";

/** "Rogue Legend is using the AI now (image 5 of 17)." from the lock and its project's journal. */
export function busyMessage(
  storage: Storage,
  held: LockInfo | null,
  names: (id: string) => string,
): string {
  const later = "You can start this when it finishes.";
  if (!held?.projectId) return `Another job is using the AI now. ${later}`;
  const name = names(held.projectId);
  if (held.kind === "import") return `${name} is being imported right now. ${later}`;
  let where = "";
  try {
    const other = readJournal(storage, { projectId: held.projectId }).jobs.ai;
    if (other?.state === "running" && other.progress.total)
      where = ` (image ${Math.min(other.progress.done + 1, other.progress.total)} of ${other.progress.total})`;
  } catch {}
  return `${name} is using the AI now${where}. ${later}`;
}

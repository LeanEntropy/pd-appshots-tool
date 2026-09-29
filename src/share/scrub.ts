import { homedir, userInfo } from "node:os";
import { JournalSchema } from "../jobs/journal.ts";

/**
 * Privacy rewrite of every text file on export (plan 12C, C7): no folder paths of this computer
 * (they carry the user's name), no user name, and no other project's id. Pictures are never
 * changed. The receiving tool rebuilds paths it needs; these strings are only shown as details.
 */
export interface ScrubContext {
  /** Folders to hide, longest first: the workspace, the tool folder, the home folder. */
  folders: { path: string; token: string }[];
  /** Ids of the other projects of this workspace. */
  otherProjects: string[];
  /** Words to hide wherever they appear (the computer's user name). */
  words: string[];
}

export function scrubContext(
  workspace: string,
  toolRoot: string,
  otherProjects: string[],
): ScrubContext {
  let user = "";
  try {
    user = userInfo().username;
  } catch {}
  const folders = [
    { path: workspace, token: "<workspace>" },
    { path: toolRoot, token: "<tool>" },
    { path: homedir(), token: "<home>" },
  ]
    .filter((f) => f.path.length > 3)
    .sort((a, b) => b.path.length - a.path.length);
  // A short or common user name would damage ordinary words: only distinctive ones are hidden.
  const words = user.length >= 4 && !/^(user|admin|owner|guest)$/i.test(user) ? [user] : [];
  return { folders, otherProjects, words };
}

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every spelling a folder can have in a text file: as is, JSON-escaped, forward slashes. */
function spellings(p: string): string[] {
  const fwd = p.replace(/\\/g, "/");
  const json = JSON.stringify(p).slice(1, -1);
  return [...new Set([json, p, fwd])].sort((a, b) => b.length - a.length);
}

export function scrubText(text: string, c: ScrubContext): string {
  let out = text;
  for (const f of c.folders)
    for (const s of spellings(f.path)) out = out.replace(new RegExp(escRe(s), "gi"), f.token);
  // Only where a value names a project (who paid for or wrote an analysis).
  for (const id of c.otherProjects)
    out = out.replace(
      new RegExp(`("(?:projectId|writtenBy)"\\s*:\\s*)"${escRe(id)}"`, "g"),
      '$1"another-project"',
    );
  for (const w of c.words) out = out.replace(new RegExp(`\\b${escRe(w)}\\b`, "gi"), "user");
  return out;
}

/**
 * The job journal travels without live jobs (plan 12C, C2): no running or stopped job on the
 * friend's computer. Batches (with their limits) and saved expansion choices are kept.
 */
export function shareableJournal(raw: unknown): unknown {
  const p = JournalSchema.safeParse(raw);
  if (!p.success) return undefined;
  const j = p.data;
  const keep = (x: (typeof j.jobs)["ai"]) => x && (x.state === "finished" || x.state === "failed");
  return {
    ...j,
    jobs: {
      ...(keep(j.jobs.ai) ? { ai: j.jobs.ai } : {}),
      ...(keep(j.jobs.store) ? { store: j.jobs.store } : {}),
    },
  };
}

const TEXT = /\.(json|md)$/i;
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?!(?:png|jpe?g|webp|gif|json|md|bin)\b)[A-Za-z]{2,}\b/g;

/** E-mail addresses in every text value (an account identity never travels). */
function withoutEmails(v: unknown): unknown {
  if (typeof v === "string") return v.replace(EMAIL, "<e-mail>");
  if (Array.isArray(v)) return v.map(withoutEmails);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutEmails(x)]));
  return v;
}

/** The bytes a file is exported with. */
export function exportBytes(name: string, bytes: Buffer, c: ScrubContext): Buffer {
  if (!TEXT.test(name)) return bytes;
  let text = bytes.toString("utf8");
  if (name === "project/state/job.json") {
    const j = shareableJournal(JSON.parse(text));
    text =
      j === undefined
        ? '{"version":1,"jobs":{},"batches":[],"increments":[]}'
        : JSON.stringify(j, null, 2);
  }
  // Store pages keep their developers' public contact addresses (they are store data).
  if (!name.startsWith("library/store-text/") && text.includes("@")) {
    if (name.endsWith(".md")) text = text.replace(EMAIL, "<e-mail>");
    else {
      const before = JSON.parse(text);
      const after = withoutEmails(before);
      if (JSON.stringify(after) !== JSON.stringify(before)) text = JSON.stringify(after, null, 2);
    }
  }
  return Buffer.from(scrubText(text, c), "utf8");
}

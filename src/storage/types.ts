import type { Readable } from "node:stream";

/**
 * Storage behind one small interface (plan 12B, B2). Keys are logical paths, never OS paths:
 *   library/...            shared image and analysis library (content-addressed)
 *   projects/<id>/...      one project's own data
 *   registry/projects.json the project registry
 *   shared/...             caches shared by all projects
 * The local implementation maps them onto the workspace folder. It is synchronous in this
 * stage (the whole tool runs locally); a hosted backend would make these calls async.
 */
export interface Storage {
  /** Parsed JSON, or undefined when the key does not exist. */
  getJson(key: string): unknown;
  /** Atomic write (temp file and rename): a crash never leaves half a file. */
  putJson(key: string, value: unknown): void;
  /** Text file (e.g. a markdown report), or undefined when missing. */
  getText(key: string): string | undefined;
  /** Atomic text write (temp file and rename). */
  putText(key: string, text: string): void;
  /** Write-once JSON: false (and nothing written) when the key exists already. */
  putJsonOnce(key: string, value: unknown): boolean;
  /**
   * Write-once blob. With `sha256` (content-addressed originals) the bytes must hash to it, and
   * an existing blob is kept ("exists") only if its own bytes hash the same, else it is an error.
   * Without it (derived copies named after their original), an existing blob is simply kept.
   */
  putBlob(key: string, bytes: Buffer, sha256?: string): "written" | "exists";
  /** Whole blob, or undefined when missing. */
  getBytes(key: string): Buffer | undefined;
  /** Streamed read, for serving images. */
  readStream(key: string): Readable;
  exists(key: string): boolean;
  /** Every key under a prefix (recursive, unordered). */
  list(prefix: string): Iterable<string>;
  /** Ids of every project folder with settings (project.json) or library references (refs.json). */
  listProjectIds(): string[];
  /** Local-disk capability: the OS path of a key, for tools that need a file (sharp, CLIs). */
  localPath(key: string): string;
  /**
   * The only delete (plan-reports 4.3): one report's def (projects/<id>/reports/defs/<r>.json)
   * or one of its version folders (projects/<id>/reports/<version id>). Any other key is refused.
   */
  deleteReportFiles(key: string): void;
  /**
   * One-off cleanup (plan-layout-wireframes section 4): one trial file
   * library/analysis/<sha>/structure-test-v0.json. Any other key is refused.
   */
  deleteTrialFile(key: string): void;
}

/** The only key deleteTrialFile accepts: a layout trial file in an image's analysis folder. */
export const TRIAL_DELETE_KEY = /^library\/analysis\/[0-9a-f]{64}\/structure-test-v0\.json$/;

/** Keys deleteReportFiles accepts: a report def file, or a report version folder. */
export const REPORT_DELETE_KEY =
  /^projects\/[a-z0-9-]{1,60}\/reports\/(defs\/r-[a-z0-9-]+\.json|\d{4}-\d{2}-\d{2}T[0-9-]+Z-r-[a-z0-9-]+)$/;

/** Every project-scoped storage call is made through its context (a future owner check goes here). */
export interface ProjectContext {
  projectId: string;
}

export const PROJECT_ID = /^[a-z0-9-]{1,60}$/;

const SEGMENT = /^[A-Za-z0-9._@=-]+$/;

/** Joins key segments; refuses anything that could escape its namespace. */
export function key(...parts: string[]): string {
  const segs = parts.flatMap((p) => p.split("/")).filter((s) => s.length > 0);
  for (const s of segs)
    if (!SEGMENT.test(s) || s === "." || s === "..")
      throw new Error(`Invalid storage key segment "${s}"`);
  return segs.join("/");
}

export function projectKey(ctx: ProjectContext, ...parts: string[]): string {
  if (!PROJECT_ID.test(ctx.projectId)) throw new Error(`Invalid project id "${ctx.projectId}"`);
  return key("projects", ctx.projectId, ...parts);
}

export function libraryKey(...parts: string[]): string {
  return key("library", ...parts);
}

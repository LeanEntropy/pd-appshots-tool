import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { REPORT_DELETE_KEY, type Storage, TRIAL_DELETE_KEY } from "./types.ts";

/** Top-level key namespaces and their folders inside the workspace. */
const NAMESPACES: Record<string, string> = {
  library: "_library",
  projects: "",
  registry: "",
  shared: "_shared",
  locks: ".locks",
};

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

let tmpCounter = 0;

/** The local file-system implementation, rooted at the workspace folder. */
export class LocalFsStorage implements Storage {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  localPath(k: string): string {
    const [ns = "", ...rest] = k.split("/");
    const folder = NAMESPACES[ns];
    if (folder === undefined || !rest.length) throw new Error(`Unknown storage key "${k}"`);
    if (rest.some((s) => !s || s === "." || s === ".." || /[\\:]/.test(s)))
      throw new Error(`Invalid storage key "${k}"`);
    // Namespaces that share the workspace folder must never reach each other's files.
    if (ns === "projects" && !/^[a-z0-9-]{1,60}$/.test(rest[0] ?? ""))
      throw new Error(`Invalid project id in storage key "${k}"`);
    if (ns === "registry" && (rest.length !== 1 || !rest[0]?.startsWith("projects.json")))
      throw new Error(`Invalid registry key "${k}"`);
    const p = resolve(this.root, folder, ...rest);
    if (p !== this.root && !p.startsWith(this.root + sep))
      throw new Error(`Storage key escapes the workspace: "${k}"`);
    return p;
  }

  private keyOf(ns: string, abs: string): string {
    const base = resolve(this.root, NAMESPACES[ns] ?? "");
    return [ns, ...relative(base, abs).split(sep)].join("/");
  }

  getJson(k: string): unknown {
    const p = this.localPath(k);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : undefined;
  }

  putJson(k: string, value: unknown): void {
    this.putText(k, `${JSON.stringify(value, null, 2)}\n`);
  }

  getText(k: string): string | undefined {
    const p = this.localPath(k);
    return existsSync(p) ? readFileSync(p, "utf8") : undefined;
  }

  putText(k: string, text: string): void {
    const p = this.localPath(k);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${++tmpCounter}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, p);
  }

  putJsonOnce(k: string, value: unknown): boolean {
    const p = this.localPath(k);
    mkdirSync(dirname(p), { recursive: true });
    try {
      writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw e;
    }
  }

  putBlob(k: string, bytes: Buffer, hash?: string): "written" | "exists" {
    if (hash && sha256(bytes) !== hash)
      throw new Error(`Content does not match its hash for "${k}"`);
    const p = this.localPath(k);
    if (existsSync(p)) {
      if (hash && sha256(readFileSync(p)) !== hash)
        throw new Error(`A different file is already stored under "${k}"`);
      return "exists";
    }
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${++tmpCounter}.tmp`;
    writeFileSync(tmp, bytes);
    try {
      // Exclusive commit: linking never replaces an existing file (a rename would).
      linkSync(tmp, p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      if (hash && sha256(readFileSync(p)) !== hash)
        throw new Error(`A different file is already stored under "${k}"`);
      return "exists";
    } finally {
      rmSync(tmp, { force: true });
    }
    return "written";
  }

  getBytes(k: string): Buffer | undefined {
    const p = this.localPath(k);
    return existsSync(p) ? readFileSync(p) : undefined;
  }

  readStream(k: string): Readable {
    return createReadStream(this.localPath(k));
  }

  deleteReportFiles(k: string): void {
    if (!REPORT_DELETE_KEY.test(k)) throw new Error(`Refusing to delete "${k}"`);
    rmSync(this.localPath(k), { recursive: true, force: true });
  }

  deleteTrialFile(k: string): void {
    if (!TRIAL_DELETE_KEY.test(k)) throw new Error(`Refusing to delete "${k}"`);
    rmSync(this.localPath(k), { force: true });
  }

  exists(k: string): boolean {
    return existsSync(this.localPath(k));
  }

  listProjectIds(): string[] {
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[a-z0-9-]{1,60}$/.test(e.name))
      .filter(
        (e) =>
          existsSync(join(this.root, e.name, "project.json")) ||
          existsSync(join(this.root, e.name, "refs.json")),
      )
      .map((e) => e.name)
      .sort();
  }

  *list(prefix: string): Iterable<string> {
    const [ns = ""] = prefix.split("/");
    const start = this.localPath(prefix);
    if (!existsSync(start) || !statSync(start).isDirectory()) return;
    const stack = [start];
    while (stack.length) {
      const dir = stack.pop() as string;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile() && !e.name.endsWith(".tmp")) yield this.keyOf(ns, p);
      }
    }
  }
}

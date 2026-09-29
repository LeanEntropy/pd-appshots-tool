import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { dataChanged } from "../storage/changes.ts";

export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readJsonIfExists(path: string): unknown {
  // One read instead of a check and a read (each file-system call is slow on Windows).
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw e;
  }
  return JSON.parse(text);
}

/** Write via a temp file and rename, so a crash never leaves half a file. */
export function writeJsonAtomic(path: string, value: unknown): void {
  ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, path);
  dataChanged();
}

/** Write once. Refuses to overwrite: used for immutable run manifests. */
export function writeJsonOnce(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  dataChanged();
}

/** Filesystem-safe name for ids like "com.foo.bar" or "zh-TW". */
export function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]/g, "_");
}

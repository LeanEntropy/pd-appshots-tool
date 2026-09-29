import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

/**
 * The knowledge base's files in the tool's own folder (kb/, reviewed and committed like code;
 * docs/plan-knowledge-base.md section 6). Paths are relative to kb/ and may not leave it. Seed
 * folders written by the research agents are read through readSeedDir (read only).
 */
export interface KbFiles {
  readonly dir: string;
  getJson(rel: string): unknown;
  putJson(rel: string, value: unknown): void;
  list(relDir: string): string[];
  exists(rel: string): boolean;
  /** Removes one generated JSON file of the inbox or the release entries (nothing else). */
  remove(rel: string): void;
}

const REL = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

export function kbFiles(root: string, sub = "kb"): KbFiles {
  const dir = resolve(root, sub);
  const at = (rel: string) => {
    if (!REL.test(rel) || rel.split("/").includes(".."))
      throw new Error(`Invalid kb path "${rel}"`);
    const p = resolve(dir, rel);
    if (!p.startsWith(dir + sep)) throw new Error(`kb path escapes the kb folder: "${rel}"`);
    return p;
  };
  return {
    dir,
    getJson(rel) {
      const p = at(rel);
      if (!existsSync(p)) return undefined;
      return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
    },
    putJson(rel, value) {
      const p = at(rel);
      mkdirSync(dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
      renameSync(tmp, p);
    },
    list(relDir) {
      const p = relDir ? at(relDir) : dir;
      if (!existsSync(p)) return [];
      return readdirSync(p)
        .filter((n) => n.endsWith(".json"))
        .sort();
    },
    exists(rel) {
      return existsSync(at(rel));
    },
    remove(rel) {
      if (!/^(inbox\/entries-[a-z0-9-]+|entries\/[a-z0-9-]+)\.json$/.test(rel))
        throw new Error(`Refusing to remove "${rel}"`);
      const p = at(rel);
      if (existsSync(p)) rmSync(p);
    },
  };
}

/** A JSON file the knowledge-base scripts read or write outside kb/ (evaluation packets). */
export function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

export function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Every *.json file of a seed folder, parsed (or the parse error), in name order. */
export function readSeedDir(dir: string): { name: string; json?: unknown; error?: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((name) => {
      try {
        const raw = readFileSync(join(dir, name), "utf8").replace(/^﻿/, "");
        return { name, json: JSON.parse(raw) as unknown };
      } catch (e) {
        return { name, error: e instanceof Error ? e.message : String(e) };
      }
    });
}

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Files that ship with the tool itself (not workspace data): the country flag pictures of the
 * flag-icons package (MIT), served by the tool's own server so no page loads anything from the
 * internet. Read once per country and kept in memory.
 */
const FLAG_CODE = /^[a-z]{2}$/;
const cache = new Map<string, Buffer | null>();
let flagsDir: string | null | undefined;

function dir(): string | null {
  if (flagsDir !== undefined) return flagsDir;
  try {
    const pkg = createRequire(import.meta.url).resolve("flag-icons/package.json");
    flagsDir = join(dirname(pkg), "flags", "4x3");
  } catch {
    flagsDir = null;
  }
  return flagsDir;
}

/** The SVG of a country's flag (two-letter Google Play code), or undefined when there is none. */
export function flagSvg(gl: string): Buffer | undefined {
  if (!FLAG_CODE.test(gl)) return undefined;
  const hit = cache.get(gl);
  if (hit !== undefined) return hit ?? undefined;
  const d = dir();
  let bytes: Buffer | null = null;
  if (d) {
    try {
      bytes = readFileSync(join(d, `${gl}.svg`));
    } catch {
      bytes = null;
    }
  }
  cache.set(gl, bytes);
  return bytes ?? undefined;
}

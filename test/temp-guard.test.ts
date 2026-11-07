import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// Tests leaked tens of thousands of temp dirs into %TEMP%. Every temp dir now comes from
// test/helpers/temp.ts, which removes them; this guard fails on any other way to make one.
const TEST = import.meta.dirname;
// The helper is the one place allowed to make temp dirs; this file names the patterns it forbids.
const ALLOWED = new Set(["helpers/temp.ts", "temp-guard.test.ts"]);

// Any mention catches every form: mkdtemp and mkdtempSync, from node:fs or fs/promises, aliased
// imports (`mkdtemp as m`), `fs.mkdtemp`, and os.tmpdir however it is reached (`tmpdir as t`,
// `os.tmpdir`, `const t = os.tmpdir`, `{ tmpdir: t } = os`), since each spells the name once.
const FORBIDDEN: [RegExp, string][] = [
  [/mkdtemp/, "mkdtemp/mkdtempSync"],
  [/tmpdir/i, "os.tmpdir()"],
  [/process\.env\.(TEMP|TMP|TMPDIR)\b|env\[["'](TEMP|TMP|TMPDIR)["']\]/, "the TEMP/TMP variables"],
];

function violations(source: string): string[] {
  return FORBIDDEN.filter(([re]) => re.test(source)).map(([, what]) => what);
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : sources(p);
    return /\.(c|m)?[jt]sx?$/.test(e.name) ? [p] : [];
  });
}

test("the guard catches every way of making a temp dir by hand", () => {
  const bad = [
    'import { mkdtempSync } from "node:fs";',
    'import { mkdtemp } from "node:fs/promises"; await mkdtemp("x");',
    'import fsp from "node:fs/promises"; fsp.mkdtemp(p);',
    'import { mkdtempSync as m } from "fs";',
    'import { tmpdir as t } from "node:os";',
    'import os from "node:os"; const t = os.tmpdir();',
    'import * as os from "os"; const f = os.tmpdir; f();',
    'const { tmpdir: t } = await import("node:os");',
    "const base = process.env.TEMP;",
    'const base = process.env["TMPDIR"];',
  ];
  for (const s of bad) assert.notDeepEqual(violations(s), [], s);
  assert.deepEqual(violations('import { tempDir } from "./helpers/temp.ts"; tempDir("ssr-");'), []);
});

test("no test, helper or fixture makes a temp dir except through helpers/temp.ts", () => {
  const found = sources(TEST).flatMap((p) => {
    const rel = relative(TEST, p).replaceAll("\\", "/");
    if (ALLOWED.has(rel)) return [];
    return violations(readFileSync(p, "utf8")).map((what) => `${rel}: ${what}`);
  });
  assert.deepEqual(found, [], "use tempDir() from test/helpers/temp.ts instead");
});

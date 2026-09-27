import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { toJsonSchema } from "../src/analysis/schema.ts";
import { assertShellSafe, resolveCommand, run } from "../src/util/proc.ts";

const ECHO = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
const winOnly = { skip: process.platform !== "win32" };

// The first real pilot failed on Windows: the --json-schema argument went through cmd.exe and
// arrived as invalid JSON ("Invalid escape character #"). These tests pin the fix.
const schemaArg = JSON.stringify(
  toJsonSchema(z.strictObject({ c: z.string().describe('approximate hex like "#1f6fd0"') })),
);

test("a JSON argument with quotes and # reaches an .exe byte for byte", async () => {
  const r = await run(process.execPath, ["-e", ECHO, schemaArg, "", "a b"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [schemaArg, "", "a b"]);
  assert.doesNotThrow(() => JSON.parse(JSON.parse(r.stdout)[0]));
});

test("an npm .cmd shim is run as node <script>, without cmd.exe", winOnly, async () => {
  const dir = mkdtempSync(join(tmpdir(), "ssr-shim-"));
  const bin = join(dir, "node_modules", "fake", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "fake.js"), ECHO);
  writeFileSync(
    join(dir, "fake.cmd"),
    '@ECHO off\r\nSET "_prog=node"\r\n"%_prog%"  "%dp0%\\node_modules\\fake\\bin\\fake.js" %*\r\n',
  );
  const r = resolveCommand("fake", { PATH: dir, PATHEXT: ".EXE;.CMD" });
  assert.equal(r.shell, false);
  assert.equal(r.prefixArgs[0], join(bin, "fake.js"));
  const out = await run(r.file, [...r.prefixArgs, schemaArg]);
  assert.deepEqual(JSON.parse(out.stdout).slice(1), [schemaArg]);
});

test("a real .exe on PATH is started directly, never through a shell", winOnly, () => {
  const dir = join(process.execPath, "..");
  const r = resolveCommand("node", { PATH: dir, PATHEXT: ".EXE;.CMD" });
  assert.equal(r.shell, false);
  assert.match(r.file.toLowerCase(), /node\.exe$/);
});

test("an unknown .cmd refuses JSON or long arguments instead of mangling them", () => {
  assert.throws(() => assertShellSafe("x.cmd", [schemaArg]), /Refusing/);
  assert.throws(() => assertShellSafe("x.cmd", ["a".repeat(3000)]), /Refusing/);
  assert.doesNotThrow(() =>
    assertShellSafe("x.cmd", ["exec", "-m", "gpt-5.6-sol", "C:\\a b\\c.json"]),
  );
});

test("the older npm shim template (%~dp0) is recognised too", winOnly, () => {
  const dir = mkdtempSync(join(tmpdir(), "ssr-shim2-"));
  const bin = join(dir, "node_modules", "old", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "old.js"), ECHO);
  writeFileSync(join(dir, "old.cmd"), '@"%~dp0\\node_modules\\old\\bin\\old.js" %*\r\n');
  const r = resolveCommand("old", { PATH: dir, PATHEXT: ".CMD" });
  assert.equal(r.shell, false);
  assert.equal(r.prefixArgs[0], join(bin, "old.js"));
});

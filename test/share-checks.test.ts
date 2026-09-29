import assert from "node:assert/strict";
import { test } from "node:test";
import { entryKey } from "../src/share/format.ts";
import { importPackage } from "../src/share/import.ts";
import { inspectPackage, uploadKey } from "../src/share/inspect.ts";
import { openPackage, readEntry } from "../src/share/read-zip.ts";
import { exportBytes, scrubContext } from "../src/share/scrub.ts";
import { checkFile } from "../src/share/validate.ts";
import type { LocalFsStorage } from "../src/storage/index.ts";
import { sha256 } from "../src/util/hash.ts";
import { pack, receiver, sender, upload, zipOf } from "./helpers/share.ts";

type Entries = { name: string; data: Buffer; mode?: number }[];

/** The entries of a package, to rebuild it with a change. */
async function entriesOf(storage: LocalFsStorage, bytes: Buffer): Promise<Entries> {
  const ix = await openPackage(storage.localPath(uploadKey(upload(storage, bytes))));
  const out: Entries = [];
  for (const [name, e] of ix.entries) out.push({ name, data: (await readEntry(ix, e)).bytes });
  ix.close();
  return out;
}

const manifestOf = (es: Entries) =>
  JSON.parse(es.find((e) => e.name === "manifest.json")?.data.toString() ?? "{}");

function withManifest(es: Entries, m: unknown): Entries {
  return es.map((e) =>
    e.name === "manifest.json" ? { ...e, data: Buffer.from(JSON.stringify(m)) } : e,
  );
}

/** Imports a rebuilt package and returns the plain problem it was refused with. */
async function refused(storage: LocalFsStorage, es: Entries): Promise<string> {
  const id = upload(storage, await zipOf(es));
  try {
    await importPackage(storage, id, "new");
  } catch (e) {
    assert.deepEqual(storage.listProjectIds(), [], "nothing was imported");
    return (e as Error).message;
  }
  throw new Error("the package was imported");
}

test("damaged, incomplete or padded packages are refused before anything is written", async () => {
  const s = await sender();
  const r = receiver();
  const es = await entriesOf(r.storage, await pack(s, "light"));
  const thumb = es.find((e) => e.name.startsWith("library/images/thumb/"));
  assert.ok(thumb);

  // One changed byte.
  const tampered = es.map((e) =>
    e === thumb ? { ...e, data: Buffer.concat([e.data.subarray(0, -1), Buffer.from([7])]) } : e,
  );
  assert.match(await refused(r.storage, tampered), /changed or damaged/);
  assert.equal([...r.storage.list("library/images")].length, 0, "no library file written");

  // An entry the manifest does not list, and one it lists that is missing.
  const extra = [...es, { name: "project/decks/extra.json", data: Buffer.from("{}") }];
  assert.match(await refused(r.storage, extra), /does not list/);
  assert.match(
    await refused(
      r.storage,
      es.filter((e) => e !== thumb),
    ),
    /missing/,
  );

  // A newer format, a missing manifest, a file that is not a zip.
  const m = manifestOf(es);
  assert.match(
    await refused(r.storage, withManifest(es, { ...m, formatVersion: 99 })),
    /newer version/,
  );
  // The summary cannot be made to show another project than the one inside.
  const other = { ...m, project: { ...m.project, name: "Something else" } };
  assert.match(await refused(r.storage, withManifest(es, other)), /does not match the project/);
  assert.match(
    await refused(
      r.storage,
      es.filter((e) => e.name !== "manifest.json"),
    ),
    /no manifest/,
  );
  const junk = upload(r.storage, Buffer.from("not a zip at all"));
  await assert.rejects(inspectPackage(r.storage, junk), /not a readable zip/);
});

test("zip-slip names, links and files that could run are refused", async () => {
  const s = await sender();
  const r = receiver();
  const es = await entriesOf(r.storage, await pack(s, "light"));
  const m = manifestOf(es);
  const add = async (name: string, data: Buffer, mode?: number) => {
    const f = { path: name, sha256: sha256(data), bytes: data.length };
    const next = withManifest(es, { ...m, files: [...m.files, f] });
    return refused(r.storage, [...next, { name, data, ...(mode ? { mode } : {}) }]);
  };
  assert.match(await add("project/reports/x.html", Buffer.from("<script>")), /may contain/);
  assert.match(await add("evil.json", Buffer.from("{}")), /may contain/);
  assert.match(await add("project/cache/x.json", Buffer.from("{}")), /may contain/);
  assert.match(await add("project/decks/link.json", Buffer.from("/etc"), 0o120777), /is a link/);

  for (const bad of [
    "../evil.json",
    "project/../../evil.json",
    "project/decks/../../../x.json",
    "/abs/x.json",
    "C:/x/project.json",
    "project\\decks\\x.json",
    "library/images/orig/x.exe",
    "library/locks/ai.lock",
    "library/images/x.json",
  ])
    assert.equal(entryKey(bad, "p"), null, bad);
  assert.equal(entryKey("project/decks/a.json", "p")?.key, "projects/p/decks/a.json");
});

test("each file is checked against what the tool expects there", () => {
  const sha = "a".repeat(64);
  const refs = new Set([sha]);
  const png = Buffer.from("\x89PNG....", "latin1");
  assert.match(checkFile(`library/images/orig/${sha}.png`, png, refs) ?? "", /match its content/);
  assert.match(checkFile(`library/images/thumb/${sha}.webp`, png, refs) ?? "", /not the picture/);
  assert.match(
    checkFile(`library/analysis/${"b".repeat(64)}/k.json`, Buffer.from("{}"), refs) ?? "",
    /does not use/,
  );
  assert.match(
    checkFile("project/refs.json", Buffer.from('{"version":2}'), refs) ?? "",
    /image list/,
  );
  assert.match(checkFile("project/project.json", Buffer.from("{}"), refs) ?? "", /settings/);
  assert.match(checkFile("project/decks/x.json", Buffer.from("{oops"), refs) ?? "", /damaged/);
  assert.match(
    checkFile(`library/analysis/${sha}/k.json`, Buffer.from('{"imageId":"x"}'), refs) ?? "",
    /analysis/,
  );
  assert.equal(checkFile("project/reports/a/report.md", Buffer.from("# ok"), refs), null);
  // Privacy rewrite keeps JSON valid; store pages keep their public contact addresses.
  const ctx = scrubContext("C:\\ws", "C:\\tool", []);
  const text = JSON.stringify({ note: "mail:\nme@example.com", path: "C:\\ws\\x.json" });
  const out = exportBytes("project/runs/a.json", Buffer.from(text), ctx).toString();
  assert.deepEqual(JSON.parse(out), { note: "mail:\n<e-mail>", path: "<workspace>\\x.json" });
  const store = exportBytes("library/store-text/a/us-en/d.json", Buffer.from(text), ctx);
  assert.match(store.toString(), /me@example\.com/);
  // A record cannot claim a time far in the future (it would win every later merge).
  const future = { imageId: sha, status: "ok", updatedAt: "2999-01-01T00:00:00.000Z", final: {} };
  const recordName = `library/analysis/${sha}/k.json`;
  assert.match(checkFile(recordName, Buffer.from(JSON.stringify(future)), refs) ?? "", /analysis/);
  const fine = { ...future, updatedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(checkFile(recordName, Buffer.from(JSON.stringify(fine)), refs), null);
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { key, LocalFsStorage, projectKey } from "../src/storage/index.ts";
import { acquireAll, LOCKS, STALE_MS, tryAcquire } from "../src/storage/leases.ts";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const temp = () => new LocalFsStorage(mkdtempSync(join(tmpdir(), "ssr-store-")));

test("keys are logical and cannot escape their namespace", () => {
  const s = temp();
  assert.equal(
    s.localPath("library/images/orig/a.jpg"),
    join(s.root, "_library/images/orig/a.jpg"),
  );
  assert.equal(
    s.localPath("projects/rogue-legend/refs.json"),
    join(s.root, "rogue-legend/refs.json"),
  );
  assert.equal(s.localPath("registry/projects.json"), join(s.root, "projects.json"));
  assert.throws(() => s.localPath("projects/../x.json"));
  assert.throws(() => s.localPath("projects/_library/images/a.jpg"), /project id/);
  assert.throws(() => s.localPath("registry/other.json"));
  assert.throws(() => s.localPath("nowhere/x.json"));
  assert.throws(() => key("library", "..", "x"));
  assert.throws(() => projectKey({ projectId: "Bad Id" }, "x"));
});

test("json: atomic write, write-once, listing", () => {
  const s = temp();
  s.putJson("projects/p/a/b.json", { x: 1 });
  assert.deepEqual(s.getJson("projects/p/a/b.json"), { x: 1 });
  assert.equal(s.getJson("projects/p/missing.json"), undefined);
  assert.equal(s.putJsonOnce("projects/p/once.json", { v: 1 }), true);
  assert.equal(s.putJsonOnce("projects/p/once.json", { v: 2 }), false);
  assert.deepEqual(s.getJson("projects/p/once.json"), { v: 1 });
  assert.deepEqual([...s.list("projects/p")].sort(), [
    "projects/p/a/b.json",
    "projects/p/once.json",
  ]);
  assert.deepEqual([...s.list("projects/p/nothing")], []);
});

test("blobs are write-once and hash-checked", () => {
  const s = temp();
  const b = Buffer.from("picture");
  assert.throws(() => s.putBlob("library/images/orig/x.png", b, "0".repeat(64)), /hash/);
  assert.equal(s.putBlob(`library/images/orig/${sha(b)}.png`, b, sha(b)), "written");
  assert.equal(s.putBlob(`library/images/orig/${sha(b)}.png`, b, sha(b)), "exists");
  // A corrupted existing file is an error, never silently kept.
  writeFileSync(s.localPath(`library/images/orig/${sha(b)}.png`), "broken");
  assert.throws(() => s.putBlob(`library/images/orig/${sha(b)}.png`, b, sha(b)), /different file/);
  assert.equal(s.getBytes("library/images/orig/none.png"), undefined);
});

test("locks: exclusive, released only by their owner, stale ones taken over", () => {
  const s = temp();
  const a = tryAcquire(s, LOCKS.ai, { projectId: "one", kind: "analysis" });
  assert.ok(!("heldBy" in a));
  const b = tryAcquire(s, LOCKS.ai, { projectId: "two", kind: "analysis" });
  assert.ok("heldBy" in b && b.heldBy?.projectId === "one");
  // A dead process's lock is taken over.
  const path = s.localPath(LOCKS.store);
  const dead = {
    nonce: "f".repeat(32),
    pid: 999999,
    processStartedAt: "x",
    projectId: "one",
    kind: "download",
    startedAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  writeFileSync(path, JSON.stringify(dead));
  const c = tryAcquire(s, LOCKS.store, { projectId: "two", kind: "download" });
  assert.ok(!("heldBy" in c));
  // A live process without a heartbeat for over two minutes is stale too.
  const old = new Date(Date.now() - STALE_MS - 1000).toISOString();
  writeFileSync(
    s.localPath(LOCKS.library),
    JSON.stringify({ ...dead, pid: process.pid, heartbeatAt: old }),
  );
  assert.ok(!("heldBy" in tryAcquire(s, LOCKS.library, { projectId: null, kind: "x" })));
  // Release by a non-owner does nothing; the owner's release removes it.
  if (!("heldBy" in c)) {
    writeFileSync(path, JSON.stringify({ ...dead, nonce: "e".repeat(32), pid: process.pid }));
    c.release();
    assert.ok(existsSync(path));
    assert.equal(c.heartbeat(), false);
  }
  if (!("heldBy" in a)) {
    assert.equal(a.heartbeat(), true);
    a.release();
    assert.ok(!existsSync(s.localPath(LOCKS.ai)));
  }
});

test("acquireAll takes every lock or none", () => {
  const s = temp();
  const held = tryAcquire(s, LOCKS.store, { projectId: "x", kind: "download" });
  const r = acquireAll(s, [LOCKS.library, LOCKS.ai, LOCKS.store], {
    projectId: "y",
    kind: "import",
  });
  assert.ok("heldBy" in r && r.key === LOCKS.store);
  assert.ok(!existsSync(s.localPath(LOCKS.library)));
  assert.ok(!existsSync(s.localPath(LOCKS.ai)));
  if (!("heldBy" in held)) held.release();
  const ok = acquireAll(s, [LOCKS.library, LOCKS.ai, LOCKS.store], {
    projectId: "y",
    kind: "import",
  });
  assert.ok(!("heldBy" in ok));
  if (!("heldBy" in ok)) {
    assert.equal(JSON.parse(readFileSync(s.localPath(LOCKS.ai), "utf8")).projectId, "y");
    ok.release();
  }
  assert.ok(!existsSync(s.localPath(LOCKS.ai)));
});

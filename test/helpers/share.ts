import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable } from "node:stream";
import yazl from "yazl";
import { runImport } from "../../src/library/import/run-import.ts";
import { exportKey, writePackage } from "../../src/share/export.ts";
import type { ShareKind } from "../../src/share/format.ts";
import { uploadKey } from "../../src/share/inspect.ts";
import { type LocalFsStorage, workspaceStorage } from "../../src/storage/index.ts";
import { sha256 } from "../../src/util/hash.ts";
import { legacyProject } from "./imported.ts";

const REPO = join(import.meta.dirname, "..", "..");

/** The sender: a library project with a finished pilot (8 analysed images), on its own root. */
export async function sender() {
  const { loaded, root } = await legacyProject();
  await runImport({ root, configPath: loaded.path, apply: true });
  const workspace = join(root, "workspace");
  return { loaded, root, workspace, storage: workspaceStorage(workspace), id: "rogue-legend" };
}

/** Another computer: an empty tool folder with its own workspace. */
export function receiver() {
  const root = mkdtempSync(join(tmpdir(), "ssr-recv-"));
  mkdirSync(join(root, "configs"));
  cpSync(join(REPO, "configs", "defaults.json"), join(root, "configs", "defaults.json"));
  cpSync(join(REPO, "prompts"), join(root, "prompts"), { recursive: true });
  cpSync(join(REPO, "taxonomies"), join(root, "taxonomies"), { recursive: true });
  const workspace = join(root, "workspace");
  return { root, workspace, storage: workspaceStorage(workspace) };
}

/** Builds a package and returns its bytes. */
export async function pack(
  s: { storage: LocalFsStorage; root: string; workspace: string; id: string },
  kind: ShareKind,
): Promise<Buffer> {
  const r = await writePackage(s.storage, s.id, {
    kind,
    toolRoot: s.root,
    workspace: s.workspace,
    toolVersion: "test",
  });
  return s.storage.getBytes(exportKey(r.exportId)) as Buffer;
}

let n = 0;
/** Puts a package where an upload lands; returns its upload id. */
export function upload(storage: LocalFsStorage, bytes: Buffer): string {
  const id = sha256(`${Date.now()}-${n++}-${Math.random()}`).slice(0, 20);
  storage.putBlob(uploadKey(id), bytes);
  return id;
}

/** A hand-made zip: entries in order, with options (a link, stored or deflated). */
export function zipOf(
  entries: { name: string; data: Buffer | string; mode?: number; compress?: boolean }[],
): Promise<Buffer> {
  const z = new yazl.ZipFile();
  for (const e of entries)
    z.addBuffer(Buffer.from(e.data), e.name, {
      ...(e.mode ? { mode: e.mode } : {}),
      compress: e.compress ?? true,
    });
  z.end();
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const out = z.outputStream as unknown as Readable;
    out.on("data", (c: Buffer) => chunks.push(c));
    out.on("end", () => resolve(Buffer.concat(chunks)));
    out.on("error", reject);
  });
}

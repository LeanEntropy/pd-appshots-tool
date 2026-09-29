import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { test } from "node:test";
import { isUsable, readRecords } from "../src/analysis/records.ts";
import { projectPaths } from "../src/config/load.ts";
import { loadProject } from "../src/config/project.ts";
import { buildImageUses, projectInfos, useOf } from "../src/library/image-uses.ts";
import { readFacts } from "../src/library/imagedb.ts";
import { LIB } from "../src/library/layout.ts";
import { readRefs } from "../src/library/refs.ts";
import { startAppServer } from "../src/server/app-server.ts";
import { imageUses } from "../src/server/image-view.ts";
import { projectKey } from "../src/storage/index.ts";
import { sender } from "./helpers/share.ts";

const TOKEN = "img-token";

async function setup() {
  const s = await sender();
  const srv = await startAppServer({ root: s.root, token: TOKEN });
  const loaded = loadProject(s.id, { root: s.root });
  const paths = projectPaths(loaded);
  const usable = [...readRecords(paths).values()].filter(isUsable);
  const refs = readRefs(s.storage, projectKey({ projectId: s.id }, "refs.json"), s.id);
  const get = async (p: string) => {
    const r = await fetch(srv.origin + p);
    const text = await r.text();
    return { status: r.status, text, json: () => JSON.parse(text) };
  };
  return { ...s, srv, loaded, paths, usable, refs, get };
}

test("image page: routes, defaults, validation and the picture from the viewed project", async () => {
  const t = await setup();
  try {
    const sha = t.usable[0]?.imageId as string;
    const src = t.refs.images[sha]?.sources[0];
    assert.ok(sha && src);
    const r = await t.get(`/api/image/${sha}`);
    assert.equal(r.status, 200);
    const d = r.json();
    assert.equal(d.project.id, t.id);
    assert.equal(d.notice, "");
    // Absent context: the first appearance (main country first, lowest position).
    assert.equal(d.context.gl, "us");
    assert.equal(d.context.app, src.appId);
    assert.match(d.picture.src, new RegExp(`^/p/${t.id}/images/orig/${sha}\\.`));
    assert.equal(d.picture.previewOnly, false);
    // The page itself: the picture URL is in the HTML, text escaped, details folded.
    const page = await t.get(
      `/image/${sha}?project=${t.id}&app=${src.appId}&gl=us&hl=en&pos=${src.position}`,
    );
    assert.equal(page.status, 200);
    assert.ok(page.text.includes(`/p/${t.id}/images/orig/${sha}`));
    assert.match(page.text, /<details class="fold"><summary>Measured facts/);
    assert.doesNotMatch(page.text, /<details class="fold" open/);
    // The picture itself is served through the project's reference-gated route.
    assert.equal((await fetch(t.srv.origin + d.picture.src)).status, 200);
    // Validation before any storage access; unknown pictures are 404.
    assert.equal((await t.get("/api/image/not-a-sha")).status, 400);
    assert.equal((await t.get(`/api/image/${sha}?pos=0`)).status, 400);
    assert.equal((await t.get(`/api/image/${sha}?gl=JPN`)).status, 400);
    assert.equal((await t.get(`/api/image/${sha}?project=..%2Fx`)).status, 400);
    assert.equal((await t.get(`/api/image/${sha}?app=javascript:alert(1)`)).status, 400);
    assert.equal((await t.get(`/api/image/${"a".repeat(64)}`)).status, 404);
    const nf = await t.get(`/image/${"a".repeat(64)}`);
    assert.equal(nf.status, 404);
    assert.match(nf.text, /We hold no picture with this address/);
  } finally {
    t.srv.server.close();
  }
});

test("image page: a context that does not fit is never silently replaced", async () => {
  const t = await setup();
  try {
    const sha = t.usable[0]?.imageId as string;
    const d = (await t.get(`/api/image/${sha}?gl=jp&hl=ja&pos=9`)).json();
    assert.match(d.notice, /asks for Japan, position 9/);
    assert.match(d.notice, /shown as .* sees it \(United States, position \d+\)/);
    const other = (await t.get(`/api/image/${sha}?project=other-project`)).json();
    assert.match(other.notice, /does not use this picture/);
    assert.equal(other.project.id, t.id);
    const ok = t.refs.images[sha]?.sources[0];
    const fine = (
      await t.get(
        `/api/image/${sha}?project=${t.id}&app=${ok?.appId}&gl=us&hl=en&pos=${ok?.position}`,
      )
    ).json();
    assert.equal(fine.notice, "");
  } finally {
    t.srv.server.close();
  }
});

test("image page: data bands (focus note, texts, where used, footer, history)", async () => {
  const t = await setup();
  try {
    const r = t.usable[0];
    assert.ok(r);
    const d = (await t.get(`/api/image/${r.imageId}`)).json();
    // Layouts were off in the fixture: said plainly, never invented.
    assert.equal(d.wireframe, null);
    assert.match(d.layoutNote, /before layouts existed/);
    assert.ok(d.texts.length > 0);
    assert.equal(d.texts[0].from, "original");
    assert.ok(d.where.here.some((x: { current?: boolean }) => x.current));
    assert.match(d.footer, /^Analysed /);
    assert.ok(Array.isArray(d.history.attempts));
    assert.ok(d.measured.some((p: [string, string]) => p[0] === "Size"));
    assert.equal(d.info.file, null, "the raw fold has no project-relative file link");
  } finally {
    t.srv.server.close();
  }
});

test("image page: a thumbnail-only (Light) picture shows its preview and the download link", async () => {
  const t = await setup();
  try {
    const sha = t.usable[1]?.imageId as string;
    const f = readFacts(t.storage, sha);
    assert.ok(f);
    rmSync(t.storage.localPath(LIB.imageFile(f.file)));
    const d = (await t.get(`/api/image/${sha}`)).json();
    assert.equal(d.picture.previewOnly, true);
    assert.equal(d.picture.src, `/p/${t.id}/images/${f.thumb}`);
    assert.equal(d.picture.overview, `/p/${t.id}/views/gallery.html#overview`);
    const page = await t.get(`/image/${sha}`);
    assert.match(page.text, /Preview only \(shared Light copy\)/);
    assert.match(page.text, /Download full-size pictures/);
    assert.equal((await fetch(t.srv.origin + d.picture.src)).status, 200);
  } finally {
    t.srv.server.close();
  }
});

test("usage map: every project's places, platform defaults to Google Play, cached per data stamp", async () => {
  const t = await setup();
  try {
    assert.deepEqual(useOf("p", { appId: "a.b", gl: "us", hl: "en", position: 2 }), {
      projectId: "p",
      appId: "a.b",
      gl: "us",
      hl: "en",
      position: 2,
      platform: "play",
    });
    assert.equal(useOf("p", { gl: "us" }), null);
    // A second project using the same picture.
    const sha = t.usable[0]?.imageId as string;
    t.storage.putJson(projectKey({ projectId: "second" }, "refs.json"), {
      version: 1,
      projectId: "second",
      images: {
        [sha]: { sources: [{ appId: "com.x.y", gl: "jp", hl: "ja", position: 4 }], googleIds: [] },
      },
    });
    const uses = buildImageUses(t.storage, projectInfos(t.storage));
    const list = uses.get(sha) ?? [];
    assert.ok(list.some((u) => u.projectId === "second" && u.gl === "jp" && u.position === 4));
    assert.ok(list.some((u) => u.projectId === t.id));
    // In memory under the data stamp: the same map until something is written.
    const app = t.srv.app;
    const a = await imageUses(app);
    assert.equal(await imageUses(app), a);
    t.storage.putJson(projectKey({ projectId: "third" }, "refs.json"), {
      version: 1,
      projectId: "third",
      images: {},
    });
    assert.notEqual(await imageUses(app), a);
  } finally {
    t.srv.server.close();
  }
});

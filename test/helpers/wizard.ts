import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fetcher } from "../../src/play/icon.ts";
import { startAppServer } from "../../src/server/app-server.ts";
import { workspaceStorage } from "../../src/storage/index.ts";
import { app, fakeFetcher, fakeScraper, lookup } from "./play.ts";

const REPO = join(import.meta.dirname, "..", "..");
export const TOKEN = "wiz-token";
export const headers = { "Content-Type": "application/json", "X-SSR-Token": TOKEN };
export const OURS = "com.pockethaven.roguelegend";

/** The tool's server on a temp workspace, with a scripted Google Play and local icons. */
export async function wizardServer(slowIcon?: Fetcher) {
  const root = mkdtempSync(join(tmpdir(), "ssr-wiz-"));
  mkdirSync(join(root, "configs"));
  cpSync(join(REPO, "configs", "defaults.json"), join(root, "configs", "defaults.json"));
  cpSync(join(REPO, "taxonomies"), join(root, "taxonomies"), { recursive: true });
  cpSync(join(REPO, "prompts"), join(root, "prompts"), { recursive: true });
  const storage = workspaceStorage(join(root, "workspace"));
  const f = fakeScraper(
    [
      app(OURS, "Rogue Legend"),
      app("com.habby.capybara", "Capybara Go"),
      app("com.dxx.firenow", "Survivor.io", "GAME_ADVENTURE"),
      app("com.tool.app", "Some Tool", "TOOLS"),
      app("com.jp.only", "Japan Only", "GAME_ROLE_PLAYING", ["jp"]),
      app("com.jp.two", "Japan Two", "GAME_ROLE_PLAYING", ["jp"]),
    ],
    [app("com.habby.capybara", "Capybara Go"), app("com.dxx.firenow", "Survivor.io")],
  );
  const fetcher = slowIcon ?? (await fakeFetcher()).fetcher;
  const s = await startAppServer({ root, token: TOKEN, play: lookup(storage, f.scraper), fetcher });
  const get = async (p: string) => {
    const r = await fetch(`${s.origin}${p}`, { redirect: "manual" });
    const text = await r.text();
    return {
      status: r.status,
      text,
      json: () => JSON.parse(text),
      location: r.headers.get("location"),
    };
  };
  const post = async (p: string, body: unknown, h: Record<string, string> = headers) => {
    const r = await fetch(`${s.origin}${p}`, {
      method: "POST",
      headers: h,
      body: JSON.stringify(body),
    });
    return {
      status: r.status,
      body: (await r.json()) as Record<string, unknown> & { problems?: string[] },
    };
  };
  return { ...s, root, storage, get, post, calls: f.calls };
}

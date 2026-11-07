import { chromium } from "playwright-core";
import { type BrowserLike, type Launcher, startBrowser } from "../../src/export/pdf.ts";
import { tempEnv } from "./temp.ts";

/** Starts the browser as the tool does, with its TEMP inside a test temp dir that is removed. */
export const tempLaunch: Launcher = (c) =>
  chromium.launch({
    ...c,
    headless: true,
    timeout: 30_000,
    env: tempEnv("ssr-browser-"),
  }) as Promise<BrowserLike>;

/** The installed Chrome or Edge, or NoBrowserError when there is none. */
export const testBrowser = () => startBrowser(null, tempLaunch);

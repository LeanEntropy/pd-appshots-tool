import { chromium } from "playwright-core";

/**
 * The PDF writer (plan 6.2, 6.3): `playwright-core` drives the Chrome or Edge already installed
 * on the computer (no browser download). It opens the report's print page on this tool's own
 * server, waits until every picture has loaded, and prints it with background colours, PDF
 * bookmarks from the headings and a page footer. Every other request is blocked.
 */

/** The small part of a Playwright browser the writer uses (tests pass a fake one). */
export interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
export interface RouteLike {
  request(): { url(): string };
  continue(): Promise<void>;
  abort(): Promise<void>;
}
export interface PageLike {
  route(url: string, handler: (route: RouteLike) => unknown): Promise<unknown>;
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  evaluate<T>(expression: string): Promise<T>;
  pdf(options: PdfOptions): Promise<Buffer>;
}
export interface PdfOptions {
  format: "A4" | "Letter";
  landscape: boolean;
  printBackground: boolean;
  outline: boolean;
  tagged: boolean;
  displayHeaderFooter: boolean;
  headerTemplate: string;
  footerTemplate: string;
  margin: { top: string; bottom: string; left: string; right: string };
}

/** One way to start a browser: an installed channel, or an explicit program file. */
export type BrowserCandidate = { channel: "chrome" | "msedge" } | { executablePath: string };
export type Launcher = (c: BrowserCandidate) => Promise<BrowserLike>;

export interface RenderRequest {
  /** The print page on this tool's server. */
  url: string;
  /** Only URLs starting with this are loaded (the project's own pages and pictures). */
  allowPrefix: string;
  paper: "A4" | "Letter";
  landscape: boolean;
  /** Shown in the page footer. */
  title: string;
  /** A browser path the user set (tried first). */
  browserPath?: string | null;
}

export interface RenderHooks {
  onProgress: (message: string, done?: number, total?: number) => void;
  signal?: AbortSignal;
  launch?: Launcher;
  /** How long to wait for the pictures (ms). */
  imageTimeoutMs?: number;
}

/** Raised when neither Chrome nor Edge could be started: the page offers the browser's print. */
export class NoBrowserError extends Error {
  readonly noBrowser = true;
}

/** Standard install folders, tried after the two channels (plan 6.2, feasibility spike). */
export function browserPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform === "darwin")
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  if (process.platform !== "win32")
    return ["/usr/bin/google-chrome", "/usr/bin/microsoft-edge", "/usr/bin/chromium"];
  const roots = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(
    (r): r is string => !!r,
  );
  return roots.flatMap((r) => [
    `${r}\\Google\\Chrome\\Application\\chrome.exe`,
    `${r}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ]);
}

export function candidates(browserPath?: string | null): BrowserCandidate[] {
  return [
    ...(browserPath ? [{ executablePath: browserPath }] : []),
    { channel: "chrome" as const },
    { channel: "msedge" as const },
    ...browserPaths().map((executablePath) => ({ executablePath })),
  ];
}

const playwrightLaunch: Launcher = (c) =>
  chromium.launch({ ...c, headless: true, timeout: 30_000 }) as Promise<BrowserLike>;

/** The first browser that starts: the user's path, Chrome, Edge, then the standard folders. */
export async function startBrowser(
  browserPath: string | null | undefined,
  launch: Launcher = playwrightLaunch,
): Promise<BrowserLike> {
  const reasons: string[] = [];
  for (const c of candidates(browserPath)) {
    try {
      return await launch(c);
    } catch (e) {
      reasons.push(`${"channel" in c ? c.channel : c.executablePath}: ${firstLine(e)}`);
    }
  }
  const err = new NoBrowserError(
    "The PDF export needs Chrome or Edge, and neither could be started. You can still use your browser's Save as PDF.",
  );
  err.cause = reasons;
  throw err;
}

function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The PDF options (A4 landscape by default; plan decision D4). */
export function pdfOptions(r: Pick<RenderRequest, "paper" | "landscape" | "title">): PdfOptions {
  return {
    format: r.paper,
    landscape: r.landscape,
    printBackground: true,
    outline: true,
    tagged: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: `<div style="width:100%;font:8px system-ui,sans-serif;color:#6b6b70;padding:0 10mm;display:flex;justify-content:space-between"><span>${esc(r.title)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    margin: { top: "10mm", bottom: "14mm", left: "10mm", right: "10mm" },
  };
}

const stopped = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new Error("Stopped: you pressed Stop.");
};

/** Prints the report page to PDF bytes. The browser is always closed at the end. */
export async function renderPdf(req: RenderRequest, hooks: RenderHooks): Promise<Buffer> {
  const { onProgress, signal } = hooks;
  onProgress("Starting Chrome or Edge");
  const browser = await startBrowser(req.browserPath, hooks.launch);
  const close = () => void browser.close().catch(() => {});
  signal?.addEventListener("abort", close, { once: true });
  try {
    stopped(signal);
    const page = await browser.newPage();
    // Security (plan 6.4): the browser loads only this project's pages and pictures.
    await page.route("**/*", (route) =>
      route.request().url().startsWith(req.allowPrefix) ? route.continue() : route.abort(),
    );
    onProgress("Preparing the pages");
    await page.goto(req.url, { waitUntil: "load", timeout: 60_000 });
    const limit = Date.now() + (hooks.imageTimeoutMs ?? 180_000);
    for (;;) {
      stopped(signal);
      const s = await page.evaluate<{ ready: boolean; loaded: number; total: number }>(
        "({ ready: window.reportReady === true, ...(window.reportProgress || { loaded: 0, total: 0 }) })",
      );
      if (s.ready) break;
      if (Date.now() > limit) throw new Error("The pictures took too long to load.");
      onProgress("Loading pictures", s.loaded, s.total);
      await new Promise((r) => setTimeout(r, 300));
    }
    stopped(signal);
    onProgress("Writing the PDF");
    const pdf = await page.pdf(pdfOptions(req));
    stopped(signal);
    return pdf;
  } catch (e) {
    stopped(signal);
    throw e;
  } finally {
    signal?.removeEventListener("abort", close);
    close();
  }
}

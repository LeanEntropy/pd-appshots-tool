import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { projectPaths } from "../src/config/load.ts";
import { exportReport, exportStatus, stopExport } from "../src/export/job.ts";
import {
  type BrowserCandidate,
  type BrowserLike,
  candidates,
  NoBrowserError,
  type PageLike,
  type PdfOptions,
  type RenderRequest,
  type RouteLike,
  renderPdf,
  startBrowser,
} from "../src/export/pdf.ts";
import { type ExportOptions, safeFileName } from "../src/export/report-source.ts";
import { workspaceStorage } from "../src/storage/index.ts";
import { PRINT_SCRIPT, reportPrintHtml } from "../src/view/report-print.ts";
import { PRINT_CSS } from "../src/view/report-print-css.ts";
import { reportsProject } from "./helpers/project.ts";

const OPTS: ExportOptions = { images: true, paper: "A4", landscape: true, hiddenSections: [] };

const REQ: RenderRequest = {
  url: "http://127.0.0.1:9/p/x/views/report-print.html?report=r-pilot",
  allowPrefix: "http://127.0.0.1:9/p/x/",
  paper: "A4",
  landscape: true,
  title: "Pilot <US>",
};

/** A fake browser: records routes and PDF options; the page is ready after `readyAfter` polls. */
function fakeBrowser(readyAfter = 2) {
  const seen = { routes: [] as [string, string][], pdf: null as PdfOptions | null, closed: 0 };
  let polls = 0;
  const page: PageLike = {
    route: async (_u, handler) => {
      for (const url of [
        REQ.url,
        "http://127.0.0.1:9/p/x/images/a.webp",
        "https://evil.example/x",
      ]) {
        const r: RouteLike = {
          request: () => ({ url: () => url }),
          continue: async () => void seen.routes.push([url, "continue"]),
          abort: async () => void seen.routes.push([url, "abort"]),
        };
        await handler(r);
      }
    },
    goto: async () => null,
    evaluate: async <T>() =>
      ({ ready: ++polls > readyAfter, loaded: polls, total: 3 }) as unknown as T,
    pdf: async (o) => {
      seen.pdf = o;
      return Buffer.from("%PDF-fake");
    },
  };
  const browser: BrowserLike = {
    newPage: async () => page,
    close: async () => void seen.closed++,
  };
  return { browser, seen };
}

test("browser: the user's path, then Chrome, then Edge, then the install folders", async () => {
  const c = candidates("D:\\my\\chrome.exe");
  assert.deepEqual(c.slice(0, 3), [
    { executablePath: "D:\\my\\chrome.exe" },
    { channel: "chrome" },
    { channel: "msedge" },
  ]);
  const tried: BrowserCandidate[] = [];
  const { browser } = fakeBrowser();
  const got = await startBrowser(null, async (x) => {
    tried.push(x);
    if ("channel" in x && x.channel === "msedge") return browser;
    throw new Error("not installed\nstack");
  });
  assert.equal(got, browser);
  assert.deepEqual(tried, [{ channel: "chrome" }, { channel: "msedge" }]);
  await assert.rejects(
    startBrowser(null, async () => {
      throw new Error("nope");
    }),
    (e: unknown) => e instanceof NoBrowserError && /Chrome or Edge/.test(e.message),
  );
});

test("render: only the project's URLs load, pictures are awaited, colours and bookmarks on", async () => {
  const { browser, seen } = fakeBrowser(2);
  const steps: string[] = [];
  const pdf = await renderPdf(REQ, {
    launch: async () => browser,
    onProgress: (m, d, t) => steps.push(t ? `${m} ${d}/${t}` : m),
  });
  assert.equal(pdf.toString(), "%PDF-fake");
  assert.deepEqual(seen.routes, [
    [REQ.url, "continue"],
    ["http://127.0.0.1:9/p/x/images/a.webp", "continue"],
    ["https://evil.example/x", "abort"],
  ]);
  assert.deepEqual(steps, [
    "Starting Chrome or Edge",
    "Preparing the pages",
    "Loading pictures 1/3",
    "Loading pictures 2/3",
    "Writing the PDF",
  ]);
  const o = seen.pdf;
  assert.ok(o);
  assert.equal(o.format, "A4");
  assert.equal(o.landscape, true);
  assert.equal(o.printBackground, true);
  assert.equal(o.outline, true);
  assert.match(o.footerTemplate, /Pilot &#60;US&#62;/);
  assert.match(o.footerTemplate, /class="pageNumber"/);
  assert.equal(seen.closed > 0, true, "the browser is closed");
});

test("render: Stop closes the browser; a page that never gets ready fails in plain words", async () => {
  const a = fakeBrowser(1_000_000);
  const ctl = new AbortController();
  const p = renderPdf(REQ, {
    launch: async () => a.browser,
    onProgress: () => {},
    signal: ctl.signal,
  });
  setTimeout(() => ctl.abort(), 50);
  await assert.rejects(p, /Stopped/);
  assert.ok(a.seen.closed > 0);
  const b = fakeBrowser(1_000_000);
  await assert.rejects(
    renderPdf(REQ, { launch: async () => b.browser, onProgress: () => {}, imageTimeoutMs: 10 }),
    /pictures took too long/,
  );
  assert.ok(b.seen.closed > 0);
});

test("print page: escaped title page, data inline, one shared print stylesheet", () => {
  const html = reportPrintHtml({
    title: "Pilot <b>",
    kind: "Pilot",
    facts: [["Country", "United States & co"]],
    data: { market: "</script><script>alert(1)</script>" },
    html: null,
    captions: {},
    images: true,
    hiddenSections: [],
    reportId: "r-pilot",
    stage: "pilot",
  });
  assert.match(html, /<title>Pilot &#60;b&#62;<\/title>/);
  assert.match(html, /<dd>United States &#38; co<\/dd>/);
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(html.includes(PRINT_CSS));
  for (const rule of [
    "print-color-adjust: exact",
    "break-inside: avoid",
    "table-header-group",
    "break-before: page",
  ])
    assert.ok(PRINT_CSS.includes(rule), rule);
});

test("print mode: reportReady turns true only after every picture has loaded or failed", async () => {
  const imgs = [0, 1, 2].map(() => {
    const on: Record<string, () => void> = {};
    return {
      complete: false,
      loading: "lazy",
      addEventListener: (k: string, f: () => void) => {
        on[k] = f;
      },
      fire: (k: string) => on[k]?.(),
    };
  });
  const win: Record<string, unknown> = {};
  const ctx = { window: win, PRINT: {} };
  runInNewContext(`${PRINT_SCRIPT}\nthis.wait = printWait;`, ctx);
  const done = (ctx as unknown as { wait: (r: unknown) => Promise<void> }).wait({
    querySelectorAll: () => imgs,
  });
  assert.equal(win.reportReady, undefined);
  assert.ok(
    imgs.every((i) => i.loading === "eager"),
    "pictures load eagerly",
  );
  imgs[0]?.fire("load");
  imgs[1]?.fire("error");
  await new Promise((r) => setImmediate(r));
  assert.equal(win.reportReady, undefined);
  assert.equal(JSON.stringify(win.reportProgress), '{"loaded":2,"total":3}');
  imgs[2]?.fire("load");
  await done;
  assert.equal(win.reportReady, true);
});

test("export job: saved in the project, the same export again is instant, options change the file", async () => {
  const loaded = await reportsProject({ Heroll: { phone: 2, tablet: 0 } });
  const reqs: RenderRequest[] = [];
  const render = async (r: RenderRequest) => {
    reqs.push(r);
    return Buffer.from("%PDF-1");
  };
  const ref = { report: "r-pilot", version: "now" };
  const a = exportReport(loaded, ref, OPTS, { origin: "http://127.0.0.1:5" }, { render });
  assert.ok(a.ok);
  const job = await a.done;
  assert.equal(job.state, "finished");
  assert.match(job.fileName, /^Pilot report \d{4}-\d{2}-\d{2}\.pdf$/);
  const id = projectPaths(loaded).projectId;
  assert.equal(reqs[0]?.allowPrefix, `http://127.0.0.1:5/p/${id}/`);
  assert.match(
    reqs[0]?.url ?? "",
    /views\/report-print\.html\?report=r-pilot&version=now&images=1/,
  );
  assert.equal(reqs[0]?.paper, "A4");
  assert.equal(reqs[0]?.landscape, true);
  const storage = workspaceStorage(projectPaths(loaded).workspace);
  const saved = [...storage.list(`projects/${id}/reports/now-r-pilot/exports`)];
  assert.equal(saved.length, 1);
  assert.equal(storage.getBytes(saved[0] ?? "")?.toString(), "%PDF-1");
  assert.ok(job.path?.endsWith(".pdf"));

  const again = exportReport(loaded, ref, OPTS, { origin: "http://127.0.0.1:5" }, { render });
  assert.ok(again.ok);
  assert.equal(again.job.state, "finished");
  assert.equal(again.job.existing, true);
  assert.equal(reqs.length, 1, "no second render");
  const letter = exportReport(
    loaded,
    ref,
    { ...OPTS, paper: "Letter", images: false },
    { origin: "x" },
    { render },
  );
  assert.ok(letter.ok);
  await letter.done;
  assert.equal(reqs.length, 2);
  assert.match(reqs[1]?.url ?? "", /images=0/);
  assert.equal(exportStatus(loaded, job.id)?.state, "finished");
  const bad = exportReport(
    loaded,
    { report: "r-pilot", version: "2020-nope" },
    OPTS,
    { origin: "x" },
    { render },
  );
  assert.equal(bad.ok, false);
});

test("export lane: one export at a time; Stop and a missing browser end in plain words", async () => {
  const loaded = await reportsProject({ Heroll: { phone: 2, tablet: 0 } });
  let active = 0;
  let most = 0;
  let release: () => void = () => {};
  const render = (_r: RenderRequest, h: { signal?: AbortSignal }) =>
    new Promise<Buffer>((resolve, reject) => {
      active++;
      most = Math.max(most, active);
      h.signal?.addEventListener("abort", () => reject(new Error("closed")));
      release = () => resolve(Buffer.from("%PDF"));
    }).finally(() => active--);
  const ref = { report: "r-pilot", version: "now" };
  const one = exportReport(loaded, ref, { ...OPTS, landscape: false }, { origin: "x" }, { render });
  const two = exportReport(loaded, ref, { ...OPTS, paper: "Letter" }, { origin: "x" }, { render });
  assert.ok(one.ok && two.ok);
  assert.equal(two.job.state, "waiting");
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(stopExport(loaded, one.job.id), true);
  assert.equal((await one.done).state, "stopped");
  await new Promise((r) => setTimeout(r, 20));
  release();
  assert.equal((await two.done).state, "finished");
  assert.equal(most, 1, "never two exports at once");
  const none = exportReport(
    loaded,
    ref,
    { ...OPTS, images: false, landscape: false },
    { origin: "x" },
    {
      render: async () => {
        throw new NoBrowserError("The PDF export needs Chrome or Edge.");
      },
    },
  );
  assert.ok(none.ok);
  const failed = await none.done;
  assert.equal(failed.state, "failed");
  assert.equal(failed.noBrowser, true);
  assert.match(failed.error ?? "", /Chrome or Edge/);
});

test("file names are safe on every system", () => {
  assert.equal(safeFileName('Pilot: "US/EN" <1>?'), "Pilot- -US-EN- -1--");
});

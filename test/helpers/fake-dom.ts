/**
 * A tiny stand-in for the browser DOM, just enough to run the page's feedback helper (act,
 * send, toast) in node: elements with attributes, dataset and innerHTML, a toast box, and a
 * scripted fetch.
 */
export interface FakeEl {
  id: string;
  innerHTML: string;
  className: string;
  hidden: boolean;
  disabled: boolean;
  isConnected: boolean;
  dataset: Record<string, string>;
  children: FakeEl[];
  classList: { contains: (c: string) => boolean };
  getAttribute: (k: string) => string | null;
  setAttribute: (k: string, v: string) => void;
  removeAttribute: (k: string) => void;
  appendChild: (c: FakeEl) => FakeEl;
  remove: () => void;
  querySelector: (s: string) => FakeEl;
  addEventListener: () => void;
}

function el(id = ""): FakeEl {
  const attrs = new Map<string, string>();
  const e: FakeEl = {
    id,
    innerHTML: "",
    className: "",
    hidden: false,
    disabled: false,
    isConnected: true,
    dataset: {},
    children: [],
    classList: { contains: (c) => e.className.split(" ").includes(c) },
    getAttribute: (k) => attrs.get(k) ?? null,
    setAttribute: (k, v) => void attrs.set(k, v),
    removeAttribute: (k) => void attrs.delete(k),
    appendChild: (c) => {
      e.children.push(c);
      return c;
    },
    remove: () => {
      e.isConnected = false;
    },
    querySelector: () => el(),
    addEventListener: () => {},
  };
  return e;
}

interface Helper {
  act: (btn: FakeEl | null, o: unknown) => Promise<unknown>;
  send: (url: string, body: unknown) => Promise<unknown>;
  spinHtml: (cls: string, extraStyle?: string) => string;
  btn: FakeEl;
  line: FakeEl;
}

export function fakeDom() {
  const byId = new Map<string, FakeEl>();
  const body = el("body");
  // A settable clock for spinHtml()'s phase-sync math, so tests can assert exact delays instead
  // of tolerating real wall-clock jitter from setTimeout.
  let clockMs = 0;
  const performance = { now: () => clockMs };
  let next: () => Promise<unknown> = async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  });
  const document = {
    body,
    documentElement: el("html"),
    getElementById: (id: string) => byId.get(id) ?? null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => el(),
    addEventListener: () => {},
  };
  const add = (e: FakeEl) => {
    byId.set(e.id, e);
    return e;
  };
  return {
    run(script: string): Helper {
      const btn = add(el("go"));
      btn.innerHTML = "Import it";
      const line = add(el("line"));
      const toasts = add(el("act-toasts"));
      body.appendChild(toasts);
      const fn = new Function(
        "document",
        "window",
        "MutationObserver",
        "CSS",
        "fetch",
        "performance",
        `${script}\nreturn { act, send, spinHtml };`,
      );
      const h = fn(
        document,
        { addEventListener: () => {} },
        class {
          observe() {}
        },
        { escape: (s: string) => s },
        () => next(),
        performance,
      ) as Pick<Helper, "act" | "send" | "spinHtml">;
      return { ...h, btn, line };
    },
    setClockMs(ms: number) {
      clockMs = ms;
    },
    respond(status: number, json: unknown) {
      next = async () => ({ ok: status < 400, status, json: async () => json });
    },
    offline() {
      next = async () => {
        throw new TypeError("Failed to fetch");
      };
    },
    toasts: () =>
      (byId.get("act-toasts")?.children ?? []).map((t) => ({
        kind: t.className.includes("bad") ? "bad" : "ok",
        text: t.innerHTML.replace(/<span>(.*?)<\/span>.*/, "$1"),
      })),
  };
}

import assert from "node:assert/strict";
import { test } from "node:test";

// A small DOM for the directory's script: filters, sort, search and the empty state.
type El = {
  tag: string;
  attrs: Record<string, string>;
  kids: El[];
  text: string;
  value: string;
  id: string;
  hidden: boolean;
  className: string;
  options: { value: string }[];
};
function fakePage(games: unknown[]) {
  class Node {}
  const make = (tag: string): El & Record<string, unknown> => {
    const e = Object.assign(new Node(), {
      tag,
      attrs: {},
      kids: [],
      text: "",
      value: "",
      id: "",
      hidden: false,
      className: "",
      options: [],
    }) as unknown as El & Record<string, unknown>;
    e.setAttribute = (k: string, v: string) => {
      e.attrs[k] = v;
      if (k === "value") e.value = v;
    };
    e.append = (...c: (El | string)[]) => {
      for (const x of c) {
        if (typeof x === "string") e.text += x;
        else e.kids.push(x);
      }
      if (tag === "select") e.options = e.kids.map((k) => ({ value: k.value }));
    };
    e.replaceChildren = (...c: El[]) => {
      e.kids = [];
      (e.append as (...x: El[]) => void)(...c);
    };
    Object.defineProperty(e, "textContent", {
      set: (v: string) => {
        e.text = v;
      },
      get: () => e.text,
    });
    e.classList = { contains: () => false };
    return e;
  };
  const els = new Map<string, El & Record<string, unknown>>();
  for (const idn of [
    "gSearch",
    "gCat",
    "gCountry",
    "gProject",
    "gSort",
    "gCards",
    "gCount",
    "gUpdated",
    "gStatus",
  ]) {
    const e = make(
      idn === "gSearch"
        ? "input"
        : idn.startsWith("g") && ["gCat", "gCountry", "gProject", "gSort"].includes(idn)
          ? "select"
          : "div",
    );
    e.id = idn;
    els.set(idn, e);
  }
  (els.get("gSort") as El).options = ["images", "checked", "name"].map((value) => ({ value }));
  (els.get("gSort") as El).value = "images";
  const handlers: Record<string, ((e: unknown) => void)[]> = {};
  const document = {
    getElementById: (i: string) => els.get(i) ?? null,
    createElement: make,
    addEventListener: (t: string, f: (e: unknown) => void) => {
      handlers[t] = [...(handlers[t] ?? []), f];
    },
  };
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };
  return { els, handlers, document, localStorage, Node, games, store };
}

test("games directory script: search, filters, sort, remembered view, empty state; text only as text", async () => {
  const { GAMES_SCRIPT } = await import("../src/view/games-script.ts");
  const { FLAG_SCRIPT } = await import("../src/view/flags.ts");
  const evil = "<img src=x onerror=alert(1)>";
  const g = (
    appId: string,
    name: string,
    images: number,
    category: string,
    gl: string,
    project: string,
    checked: string,
  ) => ({
    appId,
    name,
    icon: null,
    category,
    images,
    countries: 1,
    analysed: 0,
    aso: evil,
    asoDiffers: 0,
    pages: [{ gl, hl: "en", images, checked, status: "ok" }],
    keywords: [{ gl, terms: ["battle"] }],
    uses: [
      {
        projectId: project,
        project: `${project} name`,
        role: "direct competitor",
        archived: false,
        ranks: [],
      },
    ],
    latestCheck: checked,
    search: `${name} ${appId}`.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, ""),
  });
  const games = [
    g("com.a.capy", "Capybara Gó", 64, "Role Playing", "jp", "p1", "2026-09-27"),
    g("com.b.arch", "Archero 2", 12, "Action", "us", "p2", "2026-09-29"),
    g("com.c.evil", evil, 30, "Action", "kr", "p1", "2026-09-28"),
  ];
  const page = fakePage(games);
  const run = new Function(
    "document",
    "localStorage",
    "Node",
    "getJson",
    "send",
    "act",
    "actLine",
    "actReason",
    "actEsc",
    "location",
    `${FLAG_SCRIPT}\n${GAMES_SCRIPT}\nreturn { gRender: () => gRender(), setGames: (x) => { GAMES = x; gFill(); } };`,
  );
  const api = run(
    page.document,
    page.localStorage,
    page.Node,
    () => new Promise(() => {}),
    async () => ({}),
    async () => {},
    () => {},
    (e: Error) => e.message,
    (s: string) => s,
    { protocol: "http:" },
  ) as { gRender: () => void; setGames: (x: unknown) => void };
  api.setGames(games);
  const names = () =>
    (page.els.get("gCards") as El).kids.map((k) => k.kids[0]?.kids[1]?.kids[0]?.text);
  const fire = (type: string, target: unknown) => {
    for (const f of page.handlers[type] ?? []) f({ target });
  };
  api.gRender();
  assert.deepEqual(names(), ["Capybara Gó", evil, "Archero 2"], "most images first");
  const sort = page.els.get("gSort") as El;
  sort.value = "name";
  fire("change", sort);
  assert.deepEqual(names(), [evil, "Archero 2", "Capybara Gó"]);
  sort.value = "checked";
  fire("change", sort);
  assert.deepEqual(names(), ["Archero 2", evil, "Capybara Gó"]);
  // Accent- and case-insensitive search.
  const search = page.els.get("gSearch") as El;
  search.value = "CAPYBARA GO";
  fire("input", search);
  assert.deepEqual(names(), ["Capybara Gó"]);
  search.value = "";
  const cat = page.els.get("gCat") as El;
  cat.value = "Action";
  fire("change", cat);
  assert.equal(names().length, 2);
  const country = page.els.get("gCountry") as El;
  country.value = "kr";
  fire("change", country);
  assert.deepEqual(names(), [evil]);
  const proj = page.els.get("gProject") as El;
  proj.value = "p2";
  fire("change", proj);
  const cards = page.els.get("gCards") as El;
  assert.match(cards.kids[0]?.kids[0]?.text ?? "", /No games match/);
  assert.equal(cards.kids[0]?.kids[1]?.attrs.id, "gClear");
  assert.match(
    page.store.get("games-library-view") ?? "",
    /"project":"p2"/,
    "the view is remembered",
  );
  fire("click", { id: "gClear" });
  assert.equal(names().length, 3);
  // The hostile name is only ever text (never parsed): the card's link goes to a checked address.
  const all = (e: El): El[] => [e, ...e.kids.flatMap(all)];
  for (const e of all(cards)) {
    assert.ok(
      !["img", "script"].includes(e.tag) || e.attrs.class === "flag",
      `no ${e.tag} from data`,
    );
    if (e.attrs.href) assert.match(e.attrs.href, /^\/games\/com\.[a-z]\.[a-z]+$/);
  }
});

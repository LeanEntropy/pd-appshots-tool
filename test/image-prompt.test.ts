import assert from "node:assert/strict";
import { test } from "node:test";
import { countLine, deckPrompts, imagePrompt } from "../src/reports/image-prompt.ts";
import { storeRules } from "../src/reports/image-prompt-rules.ts";
import type {
  ImageFacts,
  PromptPlace,
  PromptSlot,
  SlotSpec,
} from "../src/reports/image-prompt-types.ts";
import { withPromptLinks } from "../src/server/image-prompt-api.ts";
import { IMAGE_PROMPT_SCRIPT, ipButtonsHtml } from "../src/view/image-prompt-ui.ts";

const place: PromptPlace = {
  game: "Rogue Legend",
  storeName: "Google Play",
  country: "United States (English)",
  language: "English",
  english: true,
  deckLength: 6,
};

const facts = (name: string, x: Partial<ImageFacts> = {}): ImageFacts => ({
  name,
  screen: "Title screen / full-screen art",
  orientation: "portrait",
  size: "",
  structure: "art + marketing layer",
  layout: "Full-screen art (title / loading style)",
  layer: true,
  logo: true,
  headline: "ROLL THE DICE",
  headlineEn: "",
  headlineStyle: "huge, at the bottom",
  headlineFont: "heavy rounded sans",
  band: "band (navy) at the bottom",
  cutOut: "",
  focus: "story / art: the hero facing a golem",
  focusMatch: "",
  description: "Key art of two heroes over a lake",
  ...x,
});

const spec: SlotSpec = {
  screen: "Title screen / full-screen art",
  screenType: "title_image",
  source: "keep our current position 1",
  orientation: "portrait",
  whatToCapture: "Our title art: the elf hero facing the rune golem",
  action: "The hero stands ready.",
  atmosphere: "Dark and adventurous.",
  mainColours: "navy #0e1e3a",
  layerPresent: true,
  layout: "full-screen art (title / loading style)",
  mask: "band; navy; bottom 26%",
  texts: [{ role: "headline", text: "ROLL, FIGHT, LEVEL UP!", style: "huge heavy italic" }],
  elements: ["ROGUE LEGEND logo, at the top"],
  logo: { show: true, why: "4 of 5 competitors show the logo." },
  why: "Follows the opening pattern.",
  local: null,
};

const slot: PromptSlot = {
  position: 1,
  competitors: [
    facts("Archero 2"),
    facts("Capybara Go", { orientation: "landscape", logo: false }),
  ],
  ours: { ...facts("Rogue Legend"), verdict: "slightly different", issues: ["no headline"] },
  spec,
};

test("the prompt holds the store rules, the competitor summary and the recommended spec", () => {
  const p = imagePrompt(place, slot, storeRules("play"));
  for (const want of [
    "Google Play hard requirements",
    "maximum dimension 3840px",
    "Metadata policy",
    'Never write "Free"',
    "What competitors show at position 1 (2 games)",
    "1 of 2: landscape; 1 of 2: portrait",
    "Game logo on the image: 1 of 2",
    "Archero 2: Title screen",
    "Screen to capture from OUR game (portrait): Our title art",
    'Headline (English, exactly): "ROLL, FIGHT, LEVEL UP!"',
    "Game logo: yes. 4 of 5",
    "What to fix:",
    "Never invent gameplay",
    "Exact size: 1080 x 1920 px (9:16 portrait)",
    "Checklist",
  ])
    assert.ok(p.includes(want), `missing: ${want}`);
  assert.ok(!p.includes("Mood: Dark and adventurous.."), "no doubled full stop");
});

test("App Store: Guideline 2.3.3, the iPhone size, and a note on a title-art spec", () => {
  const p = imagePrompt({ ...place, storeName: "App Store" }, slot, storeRules("appstore"));
  assert.ok(p.includes("App Store hard requirements"));
  assert.ok(p.includes("Guideline 2.3.3"));
  assert.ok(p.includes("show the app in use"));
  assert.ok(p.includes("put the logo and headline over a real gameplay capture"));
  assert.ok(p.includes("1290 x 2796 px"));
  assert.ok(!p.includes("Metadata policy"));
});

test("a country line gives the local headline and its English meaning", () => {
  const jp = { ...place, country: "Japan (Japanese)", language: "Japanese", english: false };
  const local = {
    headline: "強敵ボスに挑め！",
    english: "Take on the boss!",
    subline: "",
    band: "",
    notes: "",
  };
  const p = imagePrompt(jp, { ...slot, spec: { ...spec, local } }, storeRules("play"));
  assert.ok(p.includes('Headline (Japanese, exactly): "強敵ボスに挑め！"'));
  assert.ok(p.includes('English meaning: "Take on the boss!"'));
  const all = deckPrompts(jp, [slot, { ...slot, position: 2, spec: null }], storeRules("play"));
  assert.equal(all.split("\n---\n").length, 3);
  assert.ok(all.includes("No recommendation is written for this position yet"));
});

test("counts are out of the known values and say so", () => {
  assert.equal(countLine(["a", "a", "b", ""], 4), "2 of 3: a; 1 of 3: b (known for 3 of 4)");
  assert.equal(countLine(["x", "y"]), "1 of 2: x; 1 of 2: y");
});

test("each country's data gets the address of its prompts", () => {
  const body = {
    country: { countries: [{ gl: "jp", data: { a: 1 } }], advice: [{ gl: "jp", advice: null }] },
  };
  const out = withPromptLinks(body, "r-x", "v1") as typeof body & {
    country: {
      countries: { data: { imagePrompts: string } }[];
      advice: { imagePrompts: string }[];
    };
  };
  assert.equal(
    out.country.countries[0]?.data.imagePrompts,
    "reports/r-x/versions/v1/image-prompts?gl=jp",
  );
  assert.equal(out.country.advice[0]?.imagePrompts, "reports/r-x/versions/v1/image-prompts?gl=jp");
  assert.match(
    ipButtonsHtml('a"<b', [["1", "Write <it>"]]),
    /data-ip="a&#34;&#60;b".*Write &#60;it&#62;/,
  );
});

// A small DOM: enough for the prompt box (classes, children, attributes, closest).
class El {
  children: El[] = [];
  attrs: Record<string, string> = {};
  dataset: Record<string, string> = {};
  className = "";
  hidden = false;
  value = "";
  textContent = "";
  readOnly = false;
  rows = 0;
  spellcheck = true;
  type = "";
  selected = false;
  html: string[] = [];
  parent: El | null = null;
  constructor(public tag: string) {}
  set innerHTML(v: string) {
    this.html.push(v);
  }
  append(...k: El[]) {
    for (const x of k) {
      x.parent = this;
      this.children.push(x);
    }
  }
  appendChild(x: El) {
    this.append(x);
    return x;
  }
  setAttribute(k: string, v: unknown) {
    this.attrs[k] = String(v);
  }
  getAttribute(k: string) {
    return this.attrs[k] ?? null;
  }
  matches(sel: string) {
    const s = sel.replace(/^:scope > /, "");
    return s.startsWith(".") ? this.className.split(" ").includes(s.slice(1)) : this.tag === s;
  }
  all(): El[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel: string) {
    return (sel.startsWith(":scope") ? this.children : this.all()).filter((e) => e.matches(sel));
  }
  closest(sel: string) {
    for (let e: El | null = this; e; e = e.parent) if (e.matches(sel)) return e;
    return null;
  }
  focus() {}
  select() {
    this.selected = true;
  }
}

function load(clipboard: { writeText: (t: string) => Promise<void> }, execOk = true) {
  const msgs: string[] = [];
  const document = {
    createElement: (t: string) => new El(t),
    addEventListener: () => {},
    execCommand: () => execOk,
  };
  const act = async (_b: unknown, o: { run: () => Promise<unknown>; done: unknown }) => {
    const r = await o.run();
    const m = typeof o.done === "function" ? o.done(r) : o.done;
    if (m) msgs.push(String(m));
    return r;
  };
  const EVIL = '</textarea><script>alert(1)</script> & "quotes"';
  const getJson = async () => ({ prompts: [{ position: 2, text: EVIL }], all: `ALL ${EVIL}` });
  const actEsc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fn = new Function(
    "document",
    "navigator",
    "act",
    "getJson",
    "actEsc",
    `${IMAGE_PROMPT_SCRIPT}; return { ipClick, ipCopyClick, ipButtons };`,
  );
  const api = fn(document, { clipboard }, act, getJson, actEsc);
  const box = new El("div");
  box.className = "ip";
  const btn = new El("button");
  btn.className = "ip-btn";
  btn.dataset = { ip: "reports/r/versions/v/image-prompts", ipPos: "2" };
  const line = new El("span");
  line.className = "act-msg";
  box.append(btn, line);
  return { api, box, btn, msgs, EVIL };
}

test("the prompt goes into the textarea as its value only, and Copy says Copied", async () => {
  const copied: string[] = [];
  const { api, box, btn, msgs, EVIL } = load({ writeText: async (t) => void copied.push(t) });
  await api.ipClick(btn);
  const ta = box.querySelector("textarea") as El;
  assert.equal(ta.value, EVIL);
  assert.equal(ta.readOnly, true);
  assert.ok(
    box.all().every((e) => e.html.every((h) => !h.includes("alert(1)"))),
    "never as HTML",
  );
  assert.equal(btn.getAttribute("aria-pressed"), "true");
  await api.ipCopyClick(box.querySelector(".ip-copy"));
  assert.deepEqual(copied, [EVIL]);
  assert.deepEqual(msgs, ["Copied"]);
  // The same button again hides the box.
  await api.ipClick(btn);
  assert.equal((box.querySelector(".ip-out") as El).hidden, true);
  assert.match(api.ipButtons('x"y', [["all", "Copy all prompts"]]), /data-ip="x&#34;y"/);
  assert.equal(api.ipButtons("", [["1", "a"]]), "");
});

test("without clipboard access the text is selected for a manual copy", async () => {
  const refuse = { writeText: async () => Promise.reject(new Error("denied")) };
  const { api, box, btn, msgs } = load(refuse, false);
  await api.ipClick(btn);
  await api.ipCopyClick(box.querySelector(".ip-copy"));
  assert.equal((box.querySelector("textarea") as El).selected, true);
  assert.deepEqual(msgs, ["Selected: press Ctrl+C to copy"]);
});

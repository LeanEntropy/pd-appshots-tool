import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ART_SCREEN, artWording, artWordingDeep } from "../src/analysis/art-wording.ts";
import { COMPOSITION } from "../src/analysis/info-text.ts";
import { PROPORTION } from "../src/analysis/patterns.ts";
import { PROMPT_FILES, PROMPT_VERSIONS } from "../src/analysis/prompts.ts";

const REPO = join(import.meta.dirname, "..");

// Claims the user forbids: an art screen may be the game's own title, loading or splash screen.
const FORBIDDEN = [
  /no in-game (ui )?(or )?(screenshot|capture)/i,
  /no gameplay (capture|screenshot)/i,
  /not from the game/i,
  /in-game capture: none/i,
  /no screenshot/i,
  /art only/i,
  /not an? (in-game|gameplay) (screenshot|capture|screen)/i,
  /without (an? |any )?(in-game|gameplay) (screenshot|capture)/i,
  /zero (in-game|gameplay) (screenshots|captures)/i,
  /rather than an? (in-game |game )(screen|screenshot|capture)/i,
];
const claims = (s: string) => FORBIDDEN.some((re) => re.test(s));

test("older text is reworded for display, by code only", () => {
  const old = [
    "marketing image, no screenshot",
    "Art only, no in-game screenshot",
    "Art only (no screenshot)",
    "the other 27% are pure marketing art with no screenshot in it.",
    "27% are marketing images with no screenshot.",
    "Pure promotional art with no in-game capture; the banner is social proof.",
    "No in-game capture; illustrated promotional art of the hero.",
    "Pure painted key art with the game logo; no in-game UI or capture.",
    "it explicitly contains no in-game capture and instead requires a composite",
    "taxonomy mapping: no capture, shows the game logo or title",
    "In-game capture: none",
    "This image is not from the game.",
    "It is not an in-game screenshot.",
    "Promotional art without a gameplay screenshot.",
    "Zero gameplay captures in this deck.",
    "Only promotional art, rather than a game screen.",
  ];
  for (const s of old) assert.equal(claims(artWording(s)), false, `${s} -> ${artWording(s)}`);
  assert.equal(artWording("marketing image, no screenshot"), ART_SCREEN);
  assert.equal(artWording("Art only (no screenshot)"), "Full-screen art (title / loading style)");
  const plain = "Gameplay / Battle: EPIC BOSS FIGHTS! (no gameplay UI is shown)";
  assert.equal(artWording(plain), plain, "text without such claims is unchanged");
  const deep = artWordingDeep({ a: ["Art only (no screenshot)"], n: 3, b: { c: "ok" } });
  assert.deepEqual(deep, { a: ["Full-screen art (title / loading style)"], n: 3, b: { c: "ok" } });
});

test("labels never claim an image is not from the game", () => {
  for (const v of [...Object.values(COMPOSITION), ...Object.values(PROPORTION)])
    assert.equal(claims(v), false, v);
  const tax = readFileSync(join(REPO, "taxonomies", "mobile-rpg.v3.json"), "utf8");
  const t = JSON.parse(tax) as { screenTypes: { id: string; label: string }[] };
  assert.ok(t.screenTypes.some((s) => s.id === "loading_screen" && s.label === "Loading screen"));
  // Only the rule's own "never ..." sentences may quote the forbidden words.
  for (const line of tax.split("\n")) if (!/never/i.test(line)) assert.equal(claims(line), false);
});

test("the current prompts carry the rule and never make the claim themselves", () => {
  for (const f of Object.values(PROMPT_FILES)) {
    const text = readFileSync(join(REPO, "prompts", "analysis", `${f}.md`), "utf8");
    for (const line of text.split("\n"))
      if (!/never/i.test(line)) assert.equal(claims(line), false, `${f}: ${line}`);
  }
  for (const f of [PROMPT_FILES.fullAnalysis, PROMPT_FILES.adjudicate, PROMPT_FILES.recommend])
    assert.match(
      readFileSync(join(REPO, "prompts", "analysis", `${f}.md`), "utf8"),
      /Never state or imply that an image is not from the game/,
    );
});

test("the reworded prompts keep their contract versions: saved analyses stay valid", () => {
  assert.equal(PROMPT_VERSIONS.fullAnalysis, "full-analysis.v4");
  assert.equal(PROMPT_VERSIONS.adjudicate, "adjudicate.v3");
  // The text steps (2026-09-29: one full-screen art category, the logo decision per image):
  // text only, no image, so every analysis key stays the same.
  // 2026-10-30: the copy and drop directives; 2026-10-31: the engine's skeleton contract (text
  // steps only, same reasoning).
  assert.equal(PROMPT_VERSIONS.patterns, "patterns.v6");
  assert.equal(PROMPT_VERSIONS.recommend, "recommend.v6");
  assert.equal(PROMPT_VERSIONS.recommendReview, "recommend-review.v5");
  assert.equal(PROMPT_VERSIONS.abTests, "ab-tests.v4");
  for (const f of Object.values(PROMPT_FILES))
    assert.ok(existsSync(join(REPO, "prompts", "analysis", `${f}.md`)), f);
});

test("page and report code never write the claim", () => {
  const dirs = ["src/view", "src/analysis"];
  for (const d of dirs)
    for (const f of readdirSync(join(REPO, d)).filter((x) => x.endsWith(".ts"))) {
      if (f === "art-wording.ts") continue;
      for (const line of readFileSync(join(REPO, d, f), "utf8").split("\n")) {
        const code = line.replace(/^\s*(\*|\/\/).*$/, "").replace(/\/\*\*.*$/, "");
        if (!/never/i.test(code)) assert.equal(claims(code), false, `${d}/${f}: ${line.trim()}`);
      }
    }
});

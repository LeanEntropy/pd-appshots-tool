import assert from "node:assert/strict";
import { test } from "node:test";
import { renderGalleryHtml } from "../src/steps/deck-view.ts";
import { tempProject } from "./helpers/project.ts";
import { CORE, cmp, LIST, PILOT, page, rep, titles } from "./helpers/report-cards.ts";

test("one card per report type: Full check first, the others by their newest report, the Pilot last", () => {
  const { t, boxes } = page();
  t.setList(LIST);
  t.render();
  const cards = boxes.reportCards?.innerHTML ?? "";
  assert.deepEqual(titles(cards), [
    "Full check",
    "Compare countries",
    "Japan",
    "South Korea",
    "Pilot",
  ]);
  // A one-country card carries the country's flag in its title.
  assert.match(
    cards,
    /<h4><span class="cty"><img class="flag"[^>]*src="\/flags\/jp.svg"[^>]*>Japan<\/span><\/h4>/,
  );
  assert.equal((cards.match(/class="rtcard /g) ?? []).length, 5);
  // The report drawn below: its card says so (disabled); the others offer Open.
  assert.equal((cards.match(/>Open<\/button>/g) ?? []).length, 4);
  assert.equal((cards.match(/class="rt-open" disabled[^>]*>Showing<\/button>/g) ?? []).length, 1);
});

test("big reports first: the one-country cards follow the comparison's country order, the rest after them", () => {
  const { t, boxes } = page();
  const tw = { markets: ["tw"], countryNames: ["Taiwan"], countryLabels: ["Taiwan"] };
  t.setList([
    PILOT,
    rep({ id: "r-tw", name: "Taiwan vs 2", ...tw, generatedAt: "2026-09-29T12:00:00.000Z" }),
    rep({ id: "r-jp", name: "Japan vs 2" }),
    cmp("r-cmp", { markets: ["kr", "jp"], countryNames: ["South Korea", "Japan"] }),
    rep({
      id: "r-kr",
      name: "South Korea vs 2",
      markets: ["kr"],
      countryNames: ["South Korea"],
      countryLabels: ["South Korea"],
    }),
    CORE,
  ]);
  t.render();
  assert.deepEqual(titles(boxes.reportCards?.innerHTML ?? ""), [
    "Full check",
    "Compare countries",
    "South Korea",
    "Japan",
    "Taiwan",
    "Pilot",
  ]);
});

test("a dropdown only when a type has more than one report, newest first with date and status", () => {
  const { t, boxes } = page();
  t.setList(LIST);
  t.render();
  const cards = (boxes.reportCards?.innerHTML ?? "").split('<div class="rtcard ').slice(1);
  const withSel = cards.filter((c) => c.includes("<select"));
  assert.equal(withSel.length, 2, "Compare countries and Japan only");
  const japan = cards.find((c) => c.includes(">Japan</span></h4>")) ?? "";
  const opts = [...japan.matchAll(/<option value="([^"]+)"[^>]*>([^<]+)</g)].map((m) => [
    m[1],
    m[2],
  ]);
  assert.deepEqual(
    opts.map((o) => o[0]),
    ["r-jp-2", "r-jp-1"],
  );
  assert.match(opts[0]?.[1] ?? "", /^Japan vs 2 \(2\) · 2 competitors · [^·]*2026 · Partial$/);
  assert.match(opts[1]?.[1] ?? "", / · Ready$/);
  const compare = cards.find((c) => c.includes("<h4>Compare countries")) ?? "";
  assert.match(compare, /Not generated yet · Draft/);
  assert.match(compare, /class="pill none">Draft</, "the newest (the draft) is the default");
});

test("only one report is drawn: the newest one (Pilot only when alone), kept and in the hash", () => {
  const { t, boxes, store, hashes } = page();
  t.setList(LIST);
  t.render();
  const shown = boxes.reportList?.innerHTML ?? "";
  assert.equal((shown.match(/<section class="rcard /g) ?? []).length, 1);
  assert.match(shown, /id="rc-r-cmp-draft"/);
  assert.equal(t.open(), "r-cmp-draft");
  assert.equal(store.get("ssr.report.open:/p/x/api"), "r-cmp-draft");
  assert.equal(hashes.at(-1), "#report/r-cmp-draft");
  assert.match(shown, />Continue setting up</);
  assert.match(shown, /class="rc-delete danger"/);
  assert.match(boxes.reportCards?.innerHTML ?? "", /class="rtcard t-compare is-open"/);
  // The Pilot only when it is the only report.
  const one = page();
  one.t.setList([PILOT]);
  one.t.render();
  assert.match(one.boxes.reportList?.innerHTML ?? "", /id="rc-r-pilot"/);
});

test("the link wins, then the report kept in this browser; a removed report shows the next one", () => {
  const kept = page({ kept: "r-kr" });
  kept.t.setList(LIST);
  kept.t.render();
  assert.equal(kept.t.open(), "r-kr");
  const linked = page({ kept: "r-kr", hash: "#report/r-core" });
  linked.t.setList(LIST);
  linked.t.render("r-core");
  assert.equal(linked.t.open(), "r-core");
  // Deleted: the list no longer has it, and the default is shown instead.
  linked.t.forget("r-core");
  linked.t.setList(LIST.filter((r) => r.id !== "r-core"));
  linked.t.render();
  assert.equal(linked.t.open(), "r-cmp-draft");
  assert.doesNotMatch(linked.boxes.reportCards?.innerHTML ?? "", /<h4>Full check/);
  // Archived: hidden with the archived ones, so the next one shows.
  const arch = page({ kept: "r-kr" });
  arch.t.setList(LIST.map((r) => (r.id === "r-kr" ? { ...r, archived: true } : r)));
  arch.t.render();
  assert.equal(arch.t.open(), "r-cmp-draft");
  assert.match(arch.boxes.reportCards?.innerHTML ?? "", />Show archived \(1\)</);
});

test("the What next options follow the report cards in their own colour", () => {
  const { t, boxes } = page();
  t.setList(LIST);
  t.setNext({
    types: { country: { open: true } },
    coreReady: true,
    main: { gl: "us", hl: "en", label: "United States (English)" },
    pick: [],
  });
  t.render();
  const cards = boxes.reportCards?.innerHTML ?? "";
  assert.deepEqual(titles(cards).slice(-3), [
    "Pilot",
    "Compare countries",
    "Add more competitors in the United States",
  ]);
  assert.equal((cards.match(/class="rtcard rt-act /g) ?? []).length, 2);
  assert.equal((cards.match(/>Cost shown first</g) ?? []).length, 2);
  // The title leads, the chip follows it, and the button does not repeat the title.
  assert.match(cards, /<h4>Compare countries<\/h4><span class="chip">Cost shown first<\/span>/);
  assert.match(cards, /aria-label="Set up a country comparison">Set up<\/button>/);
  assert.match(cards, /data-next="more">Add competitors<\/button>/);
});

const cardOf = (html: string, title: string) =>
  html.split('<div class="rtcard ').find((c) => c.includes(`<h4>${title}`)) ?? "";
const metaOf = (card: string) => card.match(/<p class="rt-meta">(.*?)<\/p>/)?.[1] ?? "";
const flagsOf = (meta: string) =>
  [
    ...meta.matchAll(
      /<span class="rt-flag" role="img" title="([^"]+)" aria-label="([^"]+)"><img class="flag" src="\/flags\/(\w+)\.svg"/g,
    ),
  ].map((m) => [m[3], m[1], m[2]]);

test("each card's meta line: competitors, and flags named in tooltips where the title has none", () => {
  const { t, boxes } = page();
  t.setList([
    cmp("r-cmp", {
      markets: ["jp", "hk"],
      countryNames: ["Japan", "Hong Kong"],
      countryLabels: ["Japan", "Hong Kong (Traditional Chinese)"],
      competitors: 8,
    }),
    rep({ id: "r-jp", competitors: 1 }),
    PILOT,
    { ...CORE, competitors: 6 },
  ]);
  t.render();
  const cards = boxes.reportCards?.innerHTML ?? "";
  const compare = metaOf(cardOf(cards, "Compare countries"));
  assert.match(compare, /^<span>8 competitors<\/span><span class="rt-flags">/);
  assert.deepEqual(flagsOf(compare), [
    ["jp", "Japan", "Japan"],
    ["hk", "Hong Kong (Traditional Chinese)", "Hong Kong (Traditional Chinese)"],
  ]);
  const full = metaOf(cardOf(cards, "Full check"));
  assert.match(full, /^<span>6 competitors<\/span>/);
  assert.deepEqual(flagsOf(full), [["us", "United States", "United States"]]);
  const pilot = metaOf(cardOf(cards, "Pilot"));
  assert.match(pilot, /^<span>2 competitors<\/span>/);
  assert.deepEqual(flagsOf(pilot), [["us", "United States", "United States"]]);
  // One country: the count only (its flag is in the title), singular for one.
  const japan = cardOf(cards, '<span class="cty">');
  assert.equal(metaOf(japan), "<span>1 competitor</span>");
});

test("choosing another report in a dropdown updates its meta line and its option counts", () => {
  const { t, boxes, choose } = page();
  t.setList([
    cmp("r-new", {
      name: "Asia",
      markets: ["jp", "kr", "tw"],
      countryNames: ["Japan", "South Korea", "Taiwan"],
      countryLabels: ["Japan", "South Korea", "Taiwan"],
      competitors: 5,
    }),
    cmp("r-old", { name: "Japan, South Korea vs 2 competitors" }),
    cmp("r-long", { name: "Our launch countries in Asia, second round after the update" }),
    CORE,
  ]);
  t.render();
  const compare = () => cardOf(boxes.reportCards?.innerHTML ?? "", "Compare countries");
  assert.equal(flagsOf(metaOf(compare())).length, 3);
  assert.match(metaOf(compare()), /5 competitors/);
  // The counts join an option only when its name does not already give them.
  assert.match(compare(), /<option value="r-new"[^>]*>Asia · 3 countries · 5 competitors · /);
  assert.match(
    compare(),
    /<option value="r-old"[^>]*>Japan, South Korea vs 2 competitors · [^·]*2026 · Ready</,
  );
  // A long name leaves no room: the counts stay in the meta line only.
  assert.match(
    compare(),
    /<option value="r-long"[^>]*>Our launch countries in Asia, second round after the update · [^·]*2026 · Ready</,
  );
  choose("compare", "r-old");
  assert.match(metaOf(compare()), /^<span>2 competitors<\/span>/);
  assert.deepEqual(
    flagsOf(metaOf(compare())).map((f) => f[0]),
    ["jp", "kr"],
  );
  assert.match(compare(), /class="rt-open primary" data-rid="r-old"[^>]*>Open</);
});

test("the served Reports tab: cards row, no helper sentence, no What next block", async () => {
  const loaded = await tempProject({});
  const html = renderGalleryHtml(loaded, "t");
  assert.match(html, /<div id="reportCards" class="noprint"><\/div><div id="builder"/);
  assert.doesNotMatch(html, /All reports of this project|id="expansion"/);
  const script = html.split("<script>")[1]?.split("</script>")[0] ?? "";
  assert.doesNotThrow(() => new Function(script));
});

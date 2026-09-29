import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { flagSvg } from "../src/storage/index.ts";
import { countryLabel, FLAG_SCRIPT, flagImg } from "../src/view/flags.ts";
import { wizardServer } from "./helpers/wizard.ts";

const actEsc = (s: unknown) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

type Page = {
  countryLabel: (gl: string, name?: string) => string;
  withFlag: (label: string) => string;
  flagText: (text: string) => string;
};

function page(protocol: string): Page {
  const ctx: Record<string, unknown> = { actEsc, location: { protocol } };
  runInNewContext(
    `${FLAG_SCRIPT}\nthis.countryLabel = countryLabel; this.withFlag = withFlag; this.flagText = flagText;`,
    ctx,
  );
  return ctx as unknown as Page;
}

test("countryLabel: the flag picture (served by the tool) plus the name, escaped", () => {
  assert.equal(
    countryLabel("jp"),
    '<span class="cty"><img class="flag" src="/flags/jp.svg" alt="" width="20" height="15">Japan</span>',
  );
  assert.match(
    countryLabel("PH", "Philippines (Filipino)"),
    /flags\/ph\.svg.*Philippines \(Filipino\)/,
  );
  assert.equal(flagImg("zz"), "", "no picture for a code that is not a country");
  assert.equal(countryLabel("zz"), '<span class="cty">ZZ</span>');
  assert.match(countryLabel("us", "<b>"), /&#60;b&#62;/);
});

test("the page's helpers: the same label, flags in sentences, none when opened as a file", () => {
  const p = page("http:");
  assert.match(p.countryLabel("kr"), /src="\/flags\/kr\.svg".*South Korea<\/span>$/);
  assert.match(p.withFlag("Hong Kong (Traditional Chinese)"), /flags\/hk\.svg/);
  assert.match(p.withFlag("the United States"), /flags\/us\.svg/);
  assert.equal(p.withFlag("All countries"), "All countries");
  const t = p.flagText(
    "Skip the Philippines: 100% of the images are reused from the United States <ok>",
  );
  assert.equal((t.match(/<img class="flag"/g) ?? []).length, 2);
  assert.match(t, /the <span class="cty"><img[^>]*flags\/ph\.svg[^>]*>Philippines<\/span>:/);
  assert.match(t, /&lt;ok&gt;$/, "the text is escaped");
  assert.doesNotMatch(p.flagText("Indiana Jones and Omania"), /<img/, "whole words only");
  assert.doesNotMatch(page("file:").countryLabel("jp"), /<img/);
});

test("flag pictures come from the flag-icons package through the tool's own server", async () => {
  assert.match(flagSvg("jp")?.toString("utf8") ?? "", /<svg/);
  assert.equal(flagSvg("../x"), undefined);
  const w = await wizardServer();
  try {
    const ok = await fetch(`${w.origin}/flags/tw.svg`);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/svg+xml");
    assert.match(await ok.text(), /<svg/);
    assert.equal((await w.get("/flags/zz.svg")).status, 404);
    assert.equal((await w.get("/flags/JP.svg")).status, 404);
    assert.equal((await w.get("/flags/..%2Fpackage.json")).status, 404);
  } finally {
    w.server.close();
  }
});

test("the Space Grotesk headline font is served locally and the pages use it", async () => {
  const w = await wizardServer();
  try {
    const f = await fetch(`${w.origin}/fonts/space-grotesk-latin-700.woff2`);
    assert.equal(f.status, 200);
    assert.equal(f.headers.get("content-type"), "font/woff2");
    assert.equal((await f.arrayBuffer()).byteLength > 1000, true);
    assert.equal((await w.get("/fonts/space-grotesk-latin-400.woff2")).status, 404);
    const home = await (await fetch(`${w.origin}/`)).text();
    assert.match(home, /font-display: swap/);
    assert.match(home, /App Shots Optimizer/);
    assert.doesNotMatch(home, /Store Screenshot Recipe/);
  } finally {
    w.server.close();
  }
});

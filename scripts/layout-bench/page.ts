/**
 * Result page of the layout benchmark: per image the answer key, the model's layout and the
 * measured layout as wireframes drawn by the tool's own drawer, the scores, cost and gates.
 * Usage: npx tsx scripts/layout-bench/page.ts  (writes docs/samples/layout-benchmark/index.html)
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { applyMeasure } from "../../src/layout/measure/index.ts";
import type { Layout } from "../../src/layout/schema.ts";
import { wireframeSvg } from "../../src/layout/wireframe-svg.ts";
import { OUT, readOut } from "./common.ts";

// biome-ignore lint/suspicious/noExplicitAny: benchmark JSON read back as written by score.ts
type Any = any;

const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : "n/a");

function keyLayout(k: Any): Layout {
  const el = (e: Any) => ({ ...e, capture: null, textRef: null, text: e.text, covers: e.covers ?? [], note: "" });
  return { inGame: k.inGame.map(el), marketing: k.marketing.map(el), composition: { ...k.composition, summary: "" } };
}

function main(): void {
  const s = readOut<Any>("scores.json");
  const r = readOut<Any>("results.json");
  if (!s || !r) throw new Error("Run score.ts and gates.ts first.");
  const g = r.gates;
  const gate = (n: string, ok: boolean | undefined, what: string) =>
    `<tr><td>${n}</td><td class="${ok === undefined ? "" : ok ? "ok" : "bad"}">${ok === undefined ? "reported" : ok ? "pass" : "FAIL"}</td><td>${what}</td></tr>`;
  const cards = (s.images as Any[]).map((i) => {
    const k = readOut<Any>(`answer-keys/${i.name}.json`);
    const size = { width: k.width, height: k.height };
    const measured = applyMeasure(i.layout, i.measure);
    const pts = (p: Any) => Object.entries(p).map(([a, b]) => `${a} ${f(b as number)}`).join(" · ");
    return `<section><h2>${esc(i.name)}</h2><p>${esc(i.why)} · <a href="../wireframe-${esc(i.name)}/index.html">agent breakdown</a></p>
<div class="row"><figure>${wireframeSvg(keyLayout(k), size, null, 200)}<figcaption>Answer key</figcaption></figure>
<figure>${wireframeSvg(i.layout, size, null, 200)}<figcaption>Model only: ${f(i.modelOnly.total)}</figcaption></figure>
<figure>${wireframeSvg(measured, size, i.measure, 200)}<figcaption>After measuring: ${f(i.measured.total)}</figcaption></figure></div>
<p>Points after measuring: ${pts(i.measured.pts)}</p>
<p>Summary: ${esc(i.layout.composition.summary)}</p>
</section>`;
  });
  const cost = (g.g4.perImage as Any[])
    .map((p) => `<tr><td>${esc(p.image)}</td><td>$${f(p.costUsd, 3)}</td><td>${f(p.wallS)}</td><td>${p.outputTokens}</td><td>${p.layoutOutputTokens}</td><td>$${f(p.addedUsd, 3)}</td><td>${f(p.addedS)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Layout benchmark</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:16px;max-width:1100px;background:#fff;color:#111}table{border-collapse:collapse;margin:8px 0}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}.ok{background:#e3f5e1}.bad{background:#fbe3e1}.row{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}section{border-top:1px solid #ddd;margin-top:16px}</style></head><body>
<h1>Layout benchmark (4 images, 2026-09-29)</h1>
<p><strong>Verdict: ${r.go ? "GO" : "NO-GO"}</strong>. Separate layout call, spent $${f(r.spentUsd, 2)} of the $0.80 cap. Earlier same-call version: <a href="same-call/index.html">same-call/</a>.</p>
<table><tr><th>Gate</th><th>Result</th><th>Numbers</th></tr>
${gate("1. Each part", g.g1.pass, `elements F1 ${g.g1.elementsF1}, placement error ${g.g1.placementError} points, text character error ${f(g.g1.textCharacterError * 100)}%, band tilt and edges within tolerance ${g.g1.geometryWithinTolerance}`)}
${gate("2. Total", g.g2.pass, `mean ${g.g2.mean} after measuring; ${g.g2.totals.map((t: Any) => `${t.image} ${t.measured}`).join(", ")}`)}
${gate("3. Main analysis unchanged", g.g3.pass, g.g3.checked ? `the layout is its own call after the analysis is saved; main-call files identical to master: ${g.g3.changed.length ? `NO (${g.g3.changed.join(", ")})` : "yes"} (${g.g3.checked.length} files)` : "")}
${gate("4. Cost and time", g.g4.pass, g.g4.separate ? `the layout call per image: $${g.g4.separate.warmUsdMean} on average with a warm prompt cache ($${g.g4.separate.usdMean} as run; the first call of a batch also writes the prompt, $${g.g4.separate.oncePerBatchUsd}), ${g.g4.separate.wallSMean} s; approved at up to $${g.g4.limitUsd}` : "")}
${gate("5. Valid answers, cap", g.g5.pass, "all 4 valid on the first call, at most 7 boxes per layer")}
${gate("6. Measuring never worse by more than 2 points", g.g6.pass, g.g6.worse.map((w: Any) => `${w.image} ${w.what}: model off by ${w.model}, measured off by ${w.measured}`).join("; ") || "none worse")}
${gate("7. Experimental (glyph height, contrast)", undefined, "not validated: the key has a glyph height for one image only, where the tool found none")}
</table>
<h2>Cost and time per image</h2><table><tr><th>Image</th><th>Cost</th><th>Wall s</th><th>Output tokens</th><th>Layout tokens</th><th>Added $</th><th>Added s</th></tr>${cost}</table>
${cards.join("\n")}
</body></html>`;
  writeFileSync(join(OUT, "index.html"), html);
  console.log(`wrote ${join(OUT, "index.html")}`);
}

main();

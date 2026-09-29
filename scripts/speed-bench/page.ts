/**
 * The judging page: every scored field where the saved analysis, today's pipeline (Control) and
 * the new one do not all agree, with the screenshot and a crop of the marketing layer, and the
 * three answers side by side in a hidden order. The person picks the right one(s) and copies the
 * answers back. Writes judge.html next to results.json.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { AnalysisRecord } from "../../src/analysis/records.ts";
import { modelCopy } from "../../src/analysis/run-chunk.ts";
import { type LoadedConfig, projectPaths } from "../../src/config/load.ts";
import { openImageDb } from "../../src/store/imagedb.ts";
import { sha256 } from "../../src/util/hash.ts";
import type { ArmResult } from "./arms.ts";
import { OUT } from "./common.ts";

interface Case {
  id: string;
  field: string;
  group: string;
  key: string;
  new: string;
  control: string | null;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

async function pictures(img: Buffer, r: AnalysisRecord): Promise<{ whole: string; crop: string | null }> {
  const meta = await sharp(img).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const whole = (await sharp(img).resize({ width: 360, height: 360, fit: "inside" }).jpeg({ quality: 80 }).toBuffer()).toString("base64");
  const boxes = [...(r.final?.marketingLayer.texts ?? []), ...(r.final?.marketingLayer.backgroundMasks ?? [])].map((x) => x.region);
  if (!boxes.length) return { whole, crop: null };
  const x1 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 2);
  const y1 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 2);
  const x2 = Math.min(100, Math.max(...boxes.map((b) => b.x + b.w)) + 2);
  const y2 = Math.min(100, Math.max(...boxes.map((b) => b.y + b.h)) + 2);
  const left = Math.floor((x1 / 100) * W);
  const top = Math.floor((y1 / 100) * H);
  const width = Math.max(1, Math.min(W - left, Math.ceil(((x2 - x1) / 100) * W)));
  const height = Math.max(1, Math.min(H - top, Math.ceil(((y2 - y1) / 100) * H)));
  const crop = await sharp(img).extract({ left, top, width, height }).resize({ width: 700, height: 500, fit: "inside" }).jpeg({ quality: 85 }).toBuffer();
  return { whole, crop: crop.toString("base64") };
}

export async function writePage(
  loaded: LoadedConfig,
  results: { cases: Case[] },
  key: ReadonlyMap<string, AnalysisRecord>,
  _n: ArmResult,
  _c: ArmResult,
): Promise<void> {
  const paths = projectPaths(loaded);
  const db = openImageDb(paths);
  const pics = new Map<string, { whole: string; crop: string | null }>();
  for (const id of new Set(results.cases.map((c) => c.id))) {
    const img = await modelCopy(paths, db, id);
    pics.set(id, await pictures(img.bytes(), key.get(id) as AnalysisRecord));
  }
  const hidden: Record<string, Record<string, string>> = {};
  const blocks = results.cases.map((c, i) => {
    const r = key.get(c.id) as AnalysisRecord;
    const answers = [
      { who: "saved", text: c.key },
      { who: "new", text: c.new },
      ...(c.control !== null ? [{ who: "control", text: c.control }] : []),
    ];
    // Hidden order: sorted by a hash of the case and the answer's source.
    answers.sort((a, b) => (sha256(`${i}${a.who}`) < sha256(`${i}${b.who}`) ? -1 : 1));
    const caseId = `c${i + 1}`;
    hidden[caseId] = Object.fromEntries(answers.map((a, j) => [String.fromCharCode(65 + j), a.who]));
    const p = pics.get(c.id);
    const opts = answers
      .map((a, j) => {
        const L = String.fromCharCode(65 + j);
        return `<label class="opt"><input type="checkbox" name="${caseId}" value="${L}"> <b>${L}</b> <span>${esc(a.text) || "<i>(empty)</i>"}</span></label>`;
      })
      .join("");
    return `<section><h2>${caseId}. ${esc(r.identity?.game ?? r.appId)} ${r.gl.toUpperCase()} #${r.position}: ${esc(c.field)} <small>(${c.group})</small></h2>
<div class="row"><img src="data:image/jpeg;base64,${p?.whole ?? ""}" alt="screenshot">${p?.crop ? `<img class="crop" src="data:image/jpeg;base64,${p.crop}" alt="marketing layer">` : ""}</div>
<p>Which answer is right? Tick every answer that is fine.</p>${opts}
<label class="opt"><input type="checkbox" name="${caseId}" value="none"> none is right</label></section>`;
  });
  writeFileSync(join(OUT, "judge-key.json"), JSON.stringify(hidden, null, 1));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Speed benchmark: your judgement</title><style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a66;--card:#fff;--line:#e3e1db;--acc:#0f766e}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe7;--mute:#a3a29d;--card:#1f1f1d;--line:#34332f;--acc:#5eead4}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0;padding:16px;max-width:1100px;margin-inline:auto}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:14px 0}
h1{font-size:22px}h2{font-size:17px;margin:0 0 8px}small{color:var(--mute);font-weight:400}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start}.row img{max-width:100%;border-radius:6px;border:1px solid var(--line)}
.row img:first-child{max-height:360px}.crop{max-width:min(700px,100%)}
.opt{display:flex;gap:8px;padding:6px 8px;border-top:1px solid var(--line);align-items:baseline}.opt span{white-space:pre-wrap;word-break:break-word}
button{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:15px;cursor:pointer}
textarea{width:100%;height:120px;margin-top:8px;background:var(--card);color:var(--fg);border:1px solid var(--line)}
</style></head><body><h1>Speed benchmark: which answer is right?</h1>
<p>${results.cases.length} places where the saved analysis, today's pipeline and the new pipeline do not all agree. The answers are shown in a hidden order (A, B, C). Tick every answer that is correct for the screenshot, then press the button and paste the text back to Claude.</p>
${blocks.join("\n")}
<section><button id="go">Copy my answers</button><textarea id="out" readonly></textarea></section>
<script>document.getElementById("go").onclick=function(){var o={};document.querySelectorAll("input[type=checkbox]:checked").forEach(function(i){(o[i.name]=o[i.name]||[]).push(i.value)});var t=JSON.stringify(o);document.getElementById("out").value=t;try{navigator.clipboard.writeText(t)}catch(e){}};</script>
</body></html>`;
  writeFileSync(join(OUT, "judge.html"), html);
}

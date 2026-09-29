/**
 * Exact backfill scope for user decision D3 (free, reads a scratch copy of the records only):
 * images with a usable analysis and no layout that are ours (any country) or at store
 * positions 1-3 of a competitor (any country the project analysed).
 * Usage: BENCH_ROOT=<scratch>/backfill-root npx tsx scripts/layout-bench/backfill-count.ts
 */
import { isUsable, readRecords } from "../../src/analysis/records.ts";
import { projectPaths } from "../../src/config/load.ts";
import { layoutStatus } from "../../src/layout/store.ts";
import { load, need, writeOut } from "./common.ts";

/** Per image: measured layout output (991 tokens mean) at $50/M, plus the image and the core
 * reading written to the 1-hour cache (about 3,600 tokens at $20/M), plus cached reads. */
const PER_IMAGE_USD = { low: 0.1, mid: 0.125, high: 0.15 };

function main(): void {
  need();
  const loaded = load();
  const paths = projectPaths(loaded);
  const ours = loaded.config.ourApp.id;
  const rows: { imageId: string; game: string; ours: boolean; where: string[] }[] = [];
  let usable = 0;
  for (const r of readRecords(paths).values()) {
    if (!isUsable(r)) continue;
    usable++;
    if (layoutStatus(paths, r).status === "current") continue;
    const apps = r.identity?.appearances ?? [{ appId: r.appId, gl: r.gl, hl: r.hl, position: r.position, game: r.appId }];
    const isOurs = apps.some((a) => a.appId === ours) || r.appId === ours;
    const top3 = apps.filter((a) => a.appId !== ours && a.position <= 3);
    if (!isOurs && !top3.length) continue;
    rows.push({
      imageId: r.imageId,
      game: r.identity?.game ?? r.appId,
      ours: isOurs,
      where: apps.map((a) => `${a.gl.toUpperCase()}-${a.hl} #${a.position}`),
    });
  }
  const n = rows.length;
  const byGame: Record<string, number> = {};
  for (const x of rows) byGame[x.game] = (byGame[x.game] ?? 0) + 1;
  const out = {
    usableImages: usable,
    backfill: n,
    ours: rows.filter((x) => x.ours).length,
    competitorsTop3: rows.filter((x) => !x.ours).length,
    byGame,
    costUsd: { low: n * PER_IMAGE_USD.low, mid: n * PER_IMAGE_USD.mid, high: n * PER_IMAGE_USD.high },
    rows,
  };
  writeOut("backfill-scope.json", out);
  console.log(JSON.stringify({ ...out, rows: undefined }, null, 1));
}

main();

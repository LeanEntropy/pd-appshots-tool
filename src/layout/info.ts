import type { AnalysisRecord } from "../analysis/records.ts";
import type { ProjectPaths } from "../config/load.ts";
import { applyMeasure } from "./measure/index.ts";
import { layoutStatus, readLayoutMeasure } from "./store.ts";
import { wireframeSvg } from "./wireframe-svg.ts";

/** What the (i) popover shows about an image's layout. */
export interface LayoutView {
  status: "current" | "missing" | "outdated";
  /** The combined wireframe (both layers), drawn by code; null without a layout. */
  svg: string | null;
  summary: string;
  /** Marketing coverage measured from the pixels (an upper bound), or null. */
  coverageUpTo: number | null;
}

/** The layout part of an analysed image's (i) popover (read from its files; no AI). */
export function layoutView(paths: ProjectPaths, r: AnalysisRecord): LayoutView {
  const s = layoutStatus(paths, r);
  if (!s.file) return { status: s.status, svg: null, summary: "", coverageUpTo: null };
  const m = readLayoutMeasure(paths, r);
  const img = r.identity?.image;
  const size = img ? { width: img.width, height: img.height } : { width: 9, height: 16 };
  return {
    status: "current",
    svg: wireframeSvg(m ? applyMeasure(s.file.layout, m) : s.file.layout, size, m, 150),
    summary: s.file.layout.composition.summary,
    coverageUpTo: m?.coverageUpTo ?? null,
  };
}

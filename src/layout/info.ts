import type { AnalysisRecord } from "../analysis/records.ts";
import type { ProjectPaths } from "../config/load.ts";
import { type FocusView, focusView } from "./focus.ts";
import { applyMeasure } from "./measure/index.ts";
import { layoutNotes } from "./notes.ts";
import { type LayoutStatus, layoutStatus, readLayoutMeasure, readOlderLayout } from "./store.ts";
import { type Wireframe, wireframe } from "./wireframe-svg.ts";

/** What the (i) popover shows about an image's layout. */
export interface LayoutView {
  status: LayoutStatus;
  /** The two wireframes (screenshot, marketing) as checked data the page draws with DOM calls. */
  wireframe: Wireframe | null;
  summary: string;
  /** Marketing coverage measured from the pixels (an upper bound), or null. */
  coverageUpTo: number | null;
  /** What the screenshot highlights and whether the marketing layer says the same, or null. */
  focus: FocusView | null;
  /** Drawn from a layout saved by an older layout version (kept until a new one is made). */
  older: boolean;
  /** Where the current layout disagrees with the analysis (never a reason to redo it). */
  notes: string[];
}

/** The layout part of an analysed image's (i) popover (read from its files; no AI). */
export function layoutView(paths: ProjectPaths, r: AnalysisRecord): LayoutView {
  const s = layoutStatus(paths, r);
  const old = !s.file && s.status === "outdated" ? readOlderLayout(paths, r) : null;
  const file = s.file ?? old?.file ?? null;
  if (!file)
    return {
      status: s.status,
      wireframe: null,
      summary: "",
      coverageUpTo: null,
      focus: null,
      older: false,
      notes: [],
    };
  const m = s.file ? readLayoutMeasure(paths, r) : (old?.measure ?? null);
  const img = r.identity?.image;
  const size = img ? { width: img.width, height: img.height } : { width: 9, height: 16 };
  return {
    status: s.status,
    wireframe: wireframe(m ? applyMeasure(file.layout, m) : file.layout, size, m, undefined, {
      screenshot: { description: r.final?.screenshot.description },
      marketing: { elements: r.final?.marketingLayer.elements },
    }),
    summary: file.layout.composition?.summary ?? "",
    coverageUpTo: m?.coverageUpTo ?? null,
    focus: focusView(file.layout, r.final),
    older: !s.file,
    // Saved with the layout; a layout saved before notes existed gets them worked out now.
    notes: s.file && r.final ? (s.file.notes ?? layoutNotes(s.file.layout, r.final)) : [],
  };
}

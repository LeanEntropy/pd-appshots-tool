import type { ProjectPaths } from "../config/load.ts";
import type { Layout } from "../layout/schema.ts";
import { libraryKey, projectKey, type Storage } from "../storage/index.ts";
import { isEnglish, readEnglish } from "./english-store.ts";
import type { LayerDiffRecord } from "./layer-diff.ts";
import type { AnalysisRecord } from "./records.ts";

/**
 * Every text block of a picture's marketing layer with its English, from what is already saved
 * (free, no model call): an English original needs none; else the saved layer comparison's
 * back-translation, the layout's English meaning, or the paid English step's saved answer.
 * Game-UI text is never here: only the marketing layer's texts are listed.
 */
export interface TextRow {
  role: string;
  text: string;
  language: string;
  english: string;
  from: "original" | "layer comparison" | "layout" | "English step" | "";
}

const ROLE: Record<string, string> = {
  headline: "Headline",
  subheadline: "Subheadline",
  label: "Label",
  badge: "Badge",
  legal: "Legal line",
  other: "Text",
};

/** Back-translations of this picture's saved layer comparisons, by local text (newest wins). */
function layerEnglish(paths: ProjectPaths, storage: Storage, sha: string): Map<string, string> {
  const dir = paths.library ? libraryKey("layer-diff", sha) : projectKey(paths, "layer-diff", sha);
  const recs: LayerDiffRecord[] = [];
  for (const k of storage.list(dir)) {
    if (!k.endsWith(".json")) continue;
    try {
      const r = storage.getJson(k) as LayerDiffRecord | undefined;
      if (r?.status === "ok" && r.diff && Array.isArray(r.diff.texts)) recs.push(r);
    } catch {}
  }
  recs.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)));
  const out = new Map<string, string>();
  for (const r of recs)
    for (const t of r.diff?.texts ?? [])
      if (typeof t.localText === "string" && t.localText && typeof t.backTranslation === "string")
        out.set(t.localText, t.backTranslation);
  return out;
}

/** The layout's English meaning per marketing text index (its textRef). */
function layoutEnglish(layout: Layout | null): Map<number, string> {
  const out = new Map<number, string>();
  for (const e of Array.isArray(layout?.marketing) ? layout.marketing : []) {
    const ref = e?.textRef;
    if (typeof ref === "number" && typeof e.textEn === "string" && e.textEn.trim())
      out.set(ref, e.textEn.trim());
  }
  return out;
}

export function textRows(
  paths: ProjectPaths,
  storage: Storage,
  r: AnalysisRecord,
  layout: Layout | null,
): TextRow[] {
  const texts = r.final?.marketingLayer.present ? r.final.marketingLayer.texts : [];
  if (!texts.length) return [];
  const diff = layerEnglish(paths, storage, r.imageId);
  const lay = layoutEnglish(layout);
  return texts.map((t, i) => {
    const base = { role: ROLE[t.role] ?? "Text", text: t.text, language: t.language };
    if (isEnglish(t.language)) return { ...base, english: t.text, from: "original" as const };
    const d = diff.get(t.text);
    if (d) return { ...base, english: d, from: "layer comparison" as const };
    const l = lay.get(i);
    if (l) return { ...base, english: l, from: "layout" as const };
    const s = readEnglish(storage, t.text, t.language);
    if (s) return { ...base, english: s, from: "English step" as const };
    return { ...base, english: "", from: "" as const };
  });
}

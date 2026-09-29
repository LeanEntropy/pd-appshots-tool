import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { labeler } from "../analysis/labels.ts";
import { infoViews, summaries } from "../analysis/records.ts";
import { storeTextViews } from "../analysis/store-compare.ts";
import { coreOrder, type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { workspaceStorage } from "../storage/index.ts";
import { openImageDb } from "../store/imagedb.ts";
import { ensureDir } from "../util/fsx.ts";
import { type GalleryServed, galleryHtml } from "../view/gallery-html.ts";
import { deckFile, deckMarkdown, indexMarkdown } from "../view/markdown.ts";
import { buildViewModel, latestRun, type ViewModel } from "../view/model.ts";

export interface DeckViewResult {
  gallery: string;
  index: string;
  deckPages: number;
}

export function viewModel(loaded: LoadedConfig): ViewModel {
  const paths = projectPaths(loaded);
  const run = latestRun(paths.runs);
  if (!run) throw new Error("No download run found yet. Run the download step first.");
  const db = openImageDb(paths);
  const vm = buildViewModel(
    loaded.config,
    run,
    db,
    coreOrder(loaded, paths),
    summaries(paths, labeler(loadTaxonomy(loaded).taxonomy)),
    infoViews(paths, labeler(loadTaxonomy(loaded).taxonomy)),
  );
  const storage = workspaceStorage(paths.workspace);
  const storeText: Record<string, ReturnType<typeof storeTextViews>> = {};
  for (const a of [...vm.ours, ...vm.named, ...vm.chart]) {
    const v = storeTextViews(storage, a.appId, loaded.config.markets);
    if (v.length) storeText[a.appId] = v;
  }
  return { ...vm, storeText };
}

/** The gallery page, built fresh from the latest download, the saved pick and analyses. */
export function renderGalleryHtml(
  loaded: LoadedConfig,
  token = "",
  served?: GalleryServed,
): string {
  return galleryHtml(viewModel(loaded), token, served);
}

/** Offline markdown per deck plus one static HTML gallery, all from the latest download run. */
export function runDeckView(loaded: LoadedConfig): DeckViewResult {
  const paths = projectPaths(loaded);
  const vm = viewModel(loaded);
  let deckPages = 0;
  for (const a of [...vm.ours, ...vm.named, ...vm.chart]) {
    for (const d of a.decks) {
      const file = join(paths.views, deckFile(a, d));
      ensureDir(dirname(file));
      writeFileSync(file, deckMarkdown(a, d));
      deckPages++;
    }
  }
  const index = join(paths.views, "index.md");
  ensureDir(paths.views);
  writeFileSync(index, indexMarkdown(vm));
  const gallery = join(paths.views, "gallery.html");
  writeFileSync(gallery, galleryHtml(vm));
  return { gallery, index, deckPages };
}

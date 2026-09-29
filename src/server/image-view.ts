import { dirname } from "node:path";
import { type TextRow, textRows } from "../analysis/image-texts.ts";
import { labeler } from "../analysis/labels.ts";
import { infoView, isUsable, readRecord } from "../analysis/records.ts";
import { type LoadedConfig, loadTaxonomy, projectPaths } from "../config/load.ts";
import { REGISTRY_KEY } from "../config/registry.ts";
import { mainMarket } from "../core/targets.ts";
import type { FocusView } from "../layout/focus.ts";
import { applyMeasure } from "../layout/measure/index.ts";
import type { Layout } from "../layout/schema.ts";
import { layoutStatus, readLayoutMeasure, readOlderLayout } from "../layout/store.ts";
import { type NumberedWireframe, numberedWireframe } from "../layout/wireframe-numbered.ts";
import {
  buildImageUses,
  byRecent,
  type ImageUses,
  type ProjectInfo,
  projectInfos,
} from "../library/image-uses.ts";
import { readFacts } from "../library/imagedb.ts";
import { countryName, gameNames, latestDecks } from "../library/project-decks.ts";
import { previewOnly } from "../share/originals.ts";
import type { InfoView } from "../view/model.ts";
import type { AppContext } from "./app-context.ts";
import {
  type ColourSet,
  coloursOf,
  footerOf,
  type History,
  headerOf,
  historyOf,
  measuredOf,
  type Pairs,
  rawOf,
} from "./image-parts.ts";
import { type Ctx, imageHref, type WhereUsed, whereUsed } from "./image-where.ts";

/** Everything the image page shows, as one project sees the picture (plan-games-library 2). */
export interface ImagePage {
  sha: string;
  project: { id: string; name: string };
  /** The "Shown as" choices: every project that uses the picture (archived last). */
  choices: { id: string; name: string; archived: boolean; href: string }[];
  /** The amber band: what the address asked for and what is shown instead, or "". */
  notice: string;
  context: Ctx & { game: string; country: string };
  header: { screen: string; screenHint: string; size: string; logo: string };
  picture: { src: string; previewOnly: boolean; overview: string };
  focus: FocusView | null;
  /** Why there is no focus or wireframe ("Not analysed yet ..."), or "". */
  layoutNote: string;
  wireframe: NumberedWireframe | null;
  summary: string;
  older: boolean;
  texts: TextRow[];
  where: WhereUsed;
  footer: string;
  measured: Pairs;
  colours: ColourSet[];
  raw: Pairs;
  /** The (i) popover's view of the reading (the Raw fields fold), without its wireframe. */
  info: InfoView | null;
  history: History;
}

export type ImageQuery = Partial<Record<"project" | "app" | "gl" | "hl" | "pos", string>>;

/** The workspace folder (for the data stamp of the in-memory map). */
export const workspaceOf = (app: AppContext) => dirname(app.storage.localPath(REGISTRY_KEY));

/** sha -> every appearance, in every project; rebuilt only after a data change (single flight). */
export function imageUses(app: AppContext): Promise<ImageUses> {
  return app.computed.get(workspaceOf(app), "library:image-uses", () =>
    buildImageUses(app.storage, projectInfos(app.storage)),
  );
}

const loadedOf = (app: AppContext, id: string): LoadedConfig | null => {
  const f = app.load(id);
  return f && "loaded" in f ? f.loaded : null;
};

/** The image page's data, or null when no project we hold uses the picture. */
export async function imagePage(
  app: AppContext,
  sha: string,
  q: ImageQuery,
): Promise<ImagePage | null> {
  const uses = await imageUses(app);
  const list = uses.get(sha) ?? [];
  const infos = projectInfos(app.storage).sort(byRecent);
  const using = infos.filter((p) => list.some((u) => u.projectId === p.id) && loadedOf(app, p.id));
  if (!using.length) return null;
  const nameOf = (id: string) => infos.find((p) => p.id === id)?.name ?? app.names(id);
  const asked = q.project ? using.find((p) => p.id === q.project) : undefined;
  const viewed = asked ?? (using[0] as ProjectInfo);
  const loaded = loadedOf(app, viewed.id) as LoadedConfig;
  const paths = projectPaths(loaded);
  const mine = list.filter((u) => u.projectId === viewed.id);
  const pos = q.pos ? Number(q.pos) : 0;
  const fits = (u: (typeof mine)[number]) =>
    (!q.app || u.appId === q.app) &&
    (!q.gl || u.gl === q.gl) &&
    (!q.hl || u.hl === q.hl) &&
    (!pos || u.position === pos);
  const main = mainMarket(loaded.config);
  const byMain = [...mine].sort(
    (a, b) =>
      Number(b.gl === main.gl && b.hl === main.hl) - Number(a.gl === main.gl && a.hl === main.hl) ||
      a.position - b.position,
  );
  const hit = asked || !q.project ? byMain.find(fits) : undefined;
  const shown = hit ?? byMain[0];
  if (!shown) return null;
  const decks = latestDecks(app.storage, viewed.id);
  const names = gameNames(decks, loaded.config);
  const game = names.get(shown.appId) ?? shown.appId;
  const current: Ctx = {
    project: viewed.id,
    app: shown.appId,
    gl: shown.gl,
    hl: shown.hl,
    pos: shown.position,
  };
  const supplied = q.project || q.app || q.gl || q.hl || q.pos;
  let notice = "";
  if (supplied && !hit) {
    const want = [
      q.gl ? countryName(q.gl) : "",
      pos ? `position ${pos}` : "",
      q.app ? `in ${q.app === shown.appId ? game : q.app}` : "",
      q.project ? `(project ${q.project === viewed.id ? viewed.name : q.project})` : "",
    ]
      .filter(Boolean)
      .join(", ");
    const why =
      asked || !q.project
        ? "That place does not show this picture"
        : "That project does not use this picture";
    notice = `This address asks for ${want || "another place"}. ${why}; shown as ${viewed.name} sees it (${countryName(shown.gl)}, position ${shown.position}).`;
  }
  const r = readRecord(paths, sha);
  const label = labeler(loadTaxonomy(loaded).taxonomy);
  const info = infoView(paths, sha, label);
  const facts = readFacts(app.storage, sha);
  const preview = previewOnly(app.storage, viewed.id, [sha]).includes(sha);
  const base = `/p/${encodeURIComponent(viewed.id)}`;
  const file = facts ? (preview ? facts.thumb : facts.file) : `thumb/${sha}.webp`;
  // The numbered wireframes, from the same saved layout the (i) popover draws.
  let wf: NumberedWireframe | null = null;
  let layoutNote = "";
  // The layout drawn (current, or the older one kept): the texts band reads its English too.
  let drawn: Layout | null = null;
  if (!r) layoutNote = "Not analysed yet: this project has not analysed this picture.";
  else if (!isUsable(r))
    layoutNote = `Not analysed yet: ${r.status === "failed" ? "the analysis failed; the next run tries it again" : "the saved analysis is out of date"}.`;
  else {
    const s = layoutStatus(paths, r);
    const old = !s.file && s.status === "outdated" ? readOlderLayout(paths, r) : null;
    const lf = s.file ?? old?.file ?? null;
    if (lf) {
      drawn = lf.layout;
      const m = s.file ? readLayoutMeasure(paths, r) : (old?.measure ?? null);
      const img = r.identity?.image;
      wf = numberedWireframe(
        m ? applyMeasure(lf.layout, m) : lf.layout,
        img ? { width: img.width, height: img.height } : (facts ?? { width: 9, height: 16 }),
        m,
        {
          screenshot: { description: r.final.screenshot.description },
          marketing: { elements: r.final.marketingLayer.elements },
          texts: r.final.marketingLayer.texts,
        },
      );
    } else
      layoutNote =
        s.status === "stale"
          ? "The saved layout no longer matches this analysis."
          : "Not analysed yet: analysed before layouts existed. Add it on the project's Analysis page.";
  }
  const lv = info?.layout ?? null;
  return {
    sha,
    project: { id: viewed.id, name: viewed.name },
    choices: using.map((p) => ({
      id: p.id,
      name: p.name,
      archived: p.archived,
      href: imageHref(sha, { project: p.id }),
    })),
    notice,
    context: { ...current, game, country: countryName(shown.gl) },
    header: headerOf(app.storage, sha, r, info?.screen ?? "", game),
    picture: {
      src: `${base}/images/${file}`,
      previewOnly: preview,
      overview: `${base}/views/gallery.html#overview`,
    },
    focus: lv?.focus ?? null,
    layoutNote,
    wireframe: wf,
    summary: lv?.summary ?? "",
    older: lv?.older ?? false,
    texts: r && isUsable(r) ? textRows(paths, app.storage, r, drawn) : [],
    where: whereUsed({
      storage: app.storage,
      loaded,
      sha,
      uses,
      current,
      names,
      projectName: nameOf,
      otherConfig: (id) => loadedOf(app, id),
    }),
    footer: footerOf(paths, r, nameOf),
    measured: measuredOf(app.storage, sha, lv?.coverageUpTo ?? null),
    colours: coloursOf(paths, r),
    raw: rawOf(r),
    info: info ? { ...info, layout: null, file: null } : null,
    history: historyOf(app.storage, paths, r, sha),
  };
}

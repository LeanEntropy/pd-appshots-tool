import { type AnalysisRecord, readRecord } from "../analysis/records.ts";
import type { StoreTextView } from "../analysis/store-compare.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import { mainMarket } from "../core/targets.ts";
import { appIconSrc, appIconStale } from "../library/app-icon.ts";
import { type Platform, platformOf, storesOf } from "../library/games-parts.ts";
import { byRecent, projectInfos } from "../library/image-uses.ts";
import { readFacts } from "../library/imagedb.ts";
import { countryName, latestDecks, roleIn } from "../library/project-decks.ts";
import { pairKey, samePicture } from "../reports/anchors.ts";
import { readDifferentPairs } from "../reports/match-check.ts";
import { pixelLookup, pixelSettings } from "../reports/pixel-pairs.ts";
import { hamming } from "../store/identity.ts";
import { pixelVerdict } from "../store/pixel-diff.ts";
import { readSameScreen, sameScreenCandidate, sameScreenKey } from "../store/same-screen.ts";
import type { InfoView, ViewApp } from "../view/model.ts";
import type { AppContext } from "./app-context.ts";
import { imageHref } from "./image-where.ts";
import { pageView } from "./project-data.ts";

/**
 * The game page (plan-games-library 4): one game's screenshots per country as one project sees
 * them, each picture marked against the main country's page by code, its store text and
 * keywords, and every picture linking to its image page. Free: saved data only.
 */
export interface Thumb {
  position: number;
  sha: string | null;
  thumb: string;
  href: string;
  mark: string;
  markHint: string;
  sameScreenAs: number | null;
}

export interface Strip {
  gl: string;
  hl: string;
  label: string;
  main: boolean;
  status: string;
  checked: string;
  thumbs: Thumb[];
}

export interface GamePage {
  appId: string;
  name: string;
  icon: string | null;
  /** True when the page should ask for the icon in the background. */
  iconStale: boolean;
  /** The stores we hold pages for, with plain country names. */
  stores: { platform: Platform; countries: string[] }[];
  category: string;
  images: number;
  analysed: number;
  project: { id: string; name: string };
  choices: { id: string; name: string; archived: boolean; href: string }[];
  uses: { id: string; name: string; role: string; archived: boolean }[];
  notice: string;
  strips: Strip[];
  storeText: StoreTextView[];
  info: Record<string, InfoView>;
}

const gameHref = (appId: string, project: string) =>
  `/games/${encodeURIComponent(appId)}?project=${encodeURIComponent(project)}`;

export async function gamePage(
  app: AppContext,
  appId: string,
  project: string,
): Promise<GamePage | null> {
  const infos = projectInfos(app.storage).sort(byRecent);
  const loadedOf = (id: string): LoadedConfig | null => {
    const f = app.load(id);
    return f && "loaded" in f ? f.loaded : null;
  };
  const using = infos.filter(
    (p) => latestDecks(app.storage, p.id).some((d) => d.appId === appId) && loadedOf(p.id),
  );
  if (!using.length) return null;
  const asked = using.find((p) => p.id === project);
  const viewed = asked ?? using[0];
  if (!viewed) return null;
  const loaded = loadedOf(viewed.id) as LoadedConfig;
  const vm = await pageView(app, loaded);
  const a: ViewApp | undefined = [...vm.ours, ...vm.named, ...vm.chart].find(
    (x) => x.appId === appId,
  );
  if (!a) return null;
  const own = latestDecks(app.storage, viewed.id).filter((d) => d.appId === appId);
  // The strips are Google Play pages: their check dates come from Play decks only.
  const fetched = new Map(
    own
      .filter((d) => platformOf((d as { platform?: unknown }).platform) === "play")
      .map((d) => [`${d.gl}|${d.hl}`, (d.fetchedAt ?? "").slice(0, 10)]),
  );
  const stores = storesOf(
    own.map((d) => ({
      gl: d.gl,
      status: d.status,
      images: (d.slots ?? []).filter((s) => s.imageId).length,
      platform: (d as { platform?: unknown }).platform,
    })),
  ).map((s) => ({ ...s, countries: s.countries.map(countryName) }));
  const main = mainMarket(loaded.config);
  const decks = [...a.decks].sort(
    (x, y) =>
      Number(y.gl === main.gl && y.hl === main.hl) - Number(x.gl === main.gl && x.hl === main.hl),
  );
  const mainDeck = decks.find((d) => d.gl === main.gl && d.hl === main.hl && d.status === "ok");
  const paths = projectPaths(loaded);
  const different = readDifferentPairs(loaded);
  const settings = pixelSettings(loaded.config);
  // Only this game's pictures are read (never every record of the project).
  const recs = new Map<string, AnalysisRecord>();
  for (const d of a.decks)
    for (const i of d.images)
      if (i.imageId && !recs.has(i.imageId)) {
        const r = readRecord(paths, i.imageId);
        if (r) recs.set(i.imageId, r);
      }
  const look = pixelLookup(loaded, recs);
  const mainName = countryName(main.gl);
  const base = `/p/${encodeURIComponent(viewed.id)}/images/`;
  const strips: Strip[] = decks.map((d) => {
    const isMain = d === mainDeck;
    const mainIds = new Set(mainDeck?.images.flatMap((i) => (i.imageId ? [i.imageId] : [])) ?? []);
    const used = new Set<string>();
    const thumbs: Thumb[] = d.images.map((i) => {
      const t: Thumb = {
        position: i.position,
        sha: i.imageId,
        thumb: i.thumb ? base + i.thumb : "",
        href: i.imageId
          ? imageHref(i.imageId, {
              project: viewed.id,
              app: appId,
              gl: d.gl,
              hl: d.hl,
              pos: i.position,
            })
          : "",
        mark: "",
        markHint: "",
        sameScreenAs: null,
      };
      if (!i.imageId || !i.thumb || isMain) return t;
      if (!mainDeck) {
        t.mark = `Not in ${mainName}`;
        t.markHint = `The game has no store page in ${mainName}, so nothing to compare with.`;
      } else if (mainIds.has(i.imageId)) {
        t.mark = `Same file as ${mainName}`;
        t.markHint = `Exactly the same file is on the ${mainName} page.`;
      } else {
        const me = readFacts(app.storage, i.imageId);
        let best: { id: string; bits: number; dist: number; pos: number } | null = null;
        for (const m of mainDeck.images) {
          if (!m.imageId || used.has(m.imageId) || different.has(pairKey(i.imageId, m.imageId)))
            continue;
          const f = readFacts(app.storage, m.imageId);
          if (!me || !f) continue;
          const r = look(i.imageId, m.imageId) ?? look(m.imageId, i.imageId);
          const same = r ? pixelVerdict(r, settings) !== "different" : samePicture(me, f);
          if (!same) continue;
          const c = {
            id: m.imageId,
            bits: hamming(me.phash, f.phash),
            dist: Math.abs(m.position - i.position),
            pos: m.position,
          };
          if (
            !best ||
            c.bits < best.bits ||
            (c.bits === best.bits &&
              (c.dist < best.dist || (c.dist === best.dist && c.pos < best.pos)))
          )
            best = c;
        }
        if (best) {
          used.add(best.id);
          t.mark = "Same picture, new text";
          t.markHint = `The same picture as ${mainName} #${best.pos}, with other text on it.`;
        } else {
          t.mark = "New picture";
          t.markHint = `Not on the ${mainName} page.`;
        }
      }
      return t;
    });
    // Same screen uploaded twice within this page (stored results only).
    for (let j = 0; j < thumbs.length; j++)
      for (let k = 0; k < j; k++) {
        const x = thumbs[k];
        const y = thumbs[j];
        if (!x?.sha || !y?.sha || x.sha === y.sha || y.sameScreenAs) continue;
        const fx = readFacts(app.storage, x.sha);
        const fy = readFacts(app.storage, y.sha);
        if (!fx || !fy) continue;
        if (!sameScreenCandidate({ ...fx, id: x.sha }, { ...fy, id: y.sha })) continue;
        if (readSameScreen(app.storage, sameScreenKey(paths, x.sha, y.sha))?.same)
          y.sameScreenAs = x.position;
      }
    return {
      gl: d.gl,
      hl: d.hl,
      label: d.label,
      main: isMain,
      status: d.status,
      checked: fetched.get(`${d.gl}|${d.hl}`) ?? "",
      thumbs,
    };
  });
  const shas = new Set(strips.flatMap((s) => s.thumbs.flatMap((t) => (t.sha ? [t.sha] : []))));
  const info: Record<string, InfoView> = {};
  for (const s of shas) if (vm.info[s]) info[s] = vm.info[s] as InfoView;
  const storeText = vm.storeText?.[appId] ?? [];
  return {
    appId,
    name: a.name,
    icon: appIconSrc(app.storage, appId),
    iconStale: appIconStale(app.storage, appId),
    stores,
    category: storeText[0]?.category ?? "",
    images: shas.size,
    analysed: [...shas].filter((s) => info[s] && !info[s]?.pending).length,
    project: { id: viewed.id, name: viewed.name },
    choices: using.map((p) => ({
      id: p.id,
      name: p.name,
      archived: p.archived,
      href: gameHref(appId, p.id),
    })),
    uses: using.map((p) => {
      const l = loadedOf(p.id);
      return {
        id: p.id,
        name: p.name,
        role: l ? roleIn(l.config, appId) : "",
        archived: p.archived,
      };
    }),
    notice:
      project && !asked
        ? `This address asks for the project ${project}, which does not hold this game; shown as ${viewed.name} sees it.`
        : "",
    strips,
    storeText,
    info,
  };
}

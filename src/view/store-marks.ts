import { escHtml as esc } from "./shell.ts";

/**
 * Small store marks next to a game's name (plan-app-store 13.5: generic icons with tooltips,
 * never the stores' own logos): a play triangle for Google Play, a drawn "A" for the App Store.
 * The tooltip names the store and the countries we hold for it. Server HTML and the pages'
 * script share the same drawings.
 */
const TILE = (fill: string, mark: string) =>
  `<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><rect width="16" height="16" rx="4" fill="${fill}"/>${mark}</svg>`;

export const STORE_MARKS = {
  play: {
    name: "Google Play",
    svg: TILE("#1d7f4e", '<path d="M6 4.3v7.4L12 8z" fill="#fff"/>'),
  },
  appstore: {
    name: "App Store",
    svg: TILE(
      "#2166c4",
      '<path d="M5 12 8 4l3 8M6.1 9.4h3.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    ),
  },
} as const;

export type StoreMarkPlatform = keyof typeof STORE_MARKS;

export const STORE_MARK_CSS = `
.store-marks { display: inline-flex; gap: 4px; align-items: center; vertical-align: middle; }
.store-mark { display: inline-flex; line-height: 0; border-radius: 4px; box-shadow: 0 0 0 1px rgba(255,255,255,.35); }
`;

/** "Google Play: United States, Japan" (or "nothing held yet" when none was read). */
export function storeTip(platform: StoreMarkPlatform, countries: readonly string[]): string {
  const n = STORE_MARKS[platform].name;
  return `${n}: ${countries.length ? countries.join(", ") : "nothing held yet"}`;
}

/** The marks for a game; countries are already plain names. */
export function storeMarksHtml(
  stores: readonly { platform: StoreMarkPlatform; countries: readonly string[] }[],
): string {
  if (!stores.length) return "";
  const marks = stores.map((s) => {
    const tip = esc(storeTip(s.platform, s.countries));
    return `<span class="store-mark ${s.platform}" role="img" title="${tip}" aria-label="${tip}">${STORE_MARKS[s.platform].svg}</span>`;
  });
  return `<span class="store-marks">${marks.join("")}</span>`;
}

/** The same in the pages' script: storeMark(platform, countryNames) builds one mark element. */
export const STORE_MARK_SCRIPT = `
const STORE_MARKS = ${JSON.stringify(STORE_MARKS).replace(/</g, "\\u003c")};
function storeMark(platform, countries) {
  const m = STORE_MARKS[platform];
  if (!m) return null;
  const tip = m.name + ": " + (countries.length ? countries.join(", ") : "nothing held yet");
  const el = document.createElement("span");
  el.setAttribute("class", "store-mark " + platform);
  el.setAttribute("role", "img");
  el.setAttribute("title", tip);
  el.setAttribute("aria-label", tip);
  el.innerHTML = m.svg; // a fixed drawing from this file, never data
  return el;
}
`;

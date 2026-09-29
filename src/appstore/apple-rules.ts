/**
 * Apple App Store rules the tool applies (plan-app-store 2), in one place so a change on Apple's
 * side is one edit. Every entry keeps Apple's exact words, its page, the date it was checked and
 * one of four labels: "hard" (breaking it means rejection: never recommended against), "review"
 * (App Review applies it case by case: avoided, with the reason), "guidance" (official advice:
 * may be overridden when the evidence says it helps, said plainly) and "heuristic" (the tool's
 * own method, never presented as Apple's rule). The quotes are the knowledge base's App Store
 * entries (kb/inbox/entries-app-store.json, ids in `kb`); once the KB ships them, they move there.
 */
export const APPLE_SOURCE = {
  guidelines: "https://developer.apple.com/app-store/review/guidelines/",
  productPage: "https://developer.apple.com/app-store/product-page/",
  ppo: "https://developer.apple.com/app-store/product-page-optimization/",
  ppoCreate:
    "https://developer.apple.com/help/app-store-connect/create-product-page-optimization-tests/create-a-test/",
  ppoResults:
    "https://developer.apple.com/help/app-store-connect-analytics/acquisition/product-page-optimization/",
  customPages: "https://developer.apple.com/app-store/custom-product-pages/",
  checked: "2026-09-29",
} as const;

export type AppleLabel = "hard" | "review" | "guidance" | "heuristic";

export interface AppleRule {
  id: string;
  label: AppleLabel;
  /** Plain name shown in reports. */
  name: string;
  /** Apple's exact words. */
  quote: string;
  url: string;
  checked: string;
  /** The knowledge-base entry holding the same quote. */
  kb: string;
}

const G = APPLE_SOURCE.guidelines;
const C = APPLE_SOURCE.checked;

export const APPLE_RULES = [
  {
    id: "2.3.3",
    label: "hard",
    name: "Screenshots show the app in use",
    quote:
      "Screenshots should show the app in use, and not merely the title art, login page, or splash screen.",
    url: G,
    checked: C,
    kb: "ap-002",
  },
  {
    id: "2.3.4",
    label: "hard",
    name: "Previews are screen captures of the app",
    quote: "previews may only use video screen captures of the app itself.",
    url: G,
    checked: C,
    kb: "ap-004",
  },
  {
    id: "2.3.2",
    label: "review",
    name: "Say when featured items need a purchase",
    quote:
      "make sure your app description, screenshots, and previews clearly indicate whether any featured items, levels, subscriptions, etc. require additional purchases.",
    url: G,
    checked: C,
    kb: "ap-006",
  },
  {
    id: "2.3.7",
    label: "review",
    name: "No prices or unrelated terms in screenshots",
    quote:
      "Metadata such as app names, subtitles, screenshots, and previews should not include prices, terms, or descriptions that are not specific to the metadata type.",
    url: G,
    checked: C,
    kb: "ap-007",
  },
  {
    id: "2.3.10",
    label: "review",
    name: "No other platforms or stores",
    quote:
      "don't include names, icons, or imagery of other mobile platforms or alternative app marketplaces in your app or metadata, unless there is specific, approved interactive functionality.",
    url: G,
    checked: C,
    kb: "ap-013",
  },
  {
    id: "search-1-3",
    label: "heuristic",
    name: "Positions 1 to 3 can appear in search results",
    quote:
      "Depending on the orientation of your screenshots, the first one to three images will appear in search results when no app preview is available",
    url: APPLE_SOURCE.productPage,
    checked: C,
    kb: "ap-033",
  },
] as const satisfies readonly AppleRule[];

export type AppleRuleId = (typeof APPLE_RULES)[number]["id"];

export function appleRule(id: AppleRuleId): AppleRule {
  return APPLE_RULES.find((r) => r.id === id) as AppleRule;
}

/** A check date older than 6 months: the builder warns that the rules need a fresh look. */
export function rulesStale(now = new Date()): boolean {
  const oldest = Math.min(...APPLE_RULES.map((r) => Date.parse(r.checked)));
  return now.getTime() - oldest > 183 * 24 * 3600 * 1000;
}

/**
 * The rules as prompt lines (hard rules as constraints, review risks avoided with a reason):
 * the Apple recommendation and A/B test steps read them, never a paraphrase.
 */
export function appleRulesPrompt(): string {
  const line = (r: AppleRule) => `- ${r.name} (Guideline ${r.id}): "${r.quote}"`;
  const hard = APPLE_RULES.filter((r) => r.label === "hard").map(line);
  const review = APPLE_RULES.filter((r) => r.label === "review").map(line);
  return [
    "App Store rules. Never recommend breaking an enforced rule:",
    ...hard,
    "Review risks (avoid them and say why):",
    ...review,
    "On the App Store the first one to three screenshots can appear in search results, so they carry extra weight. Every image, including a title or logo image, must show the game in use: put the logo over a real gameplay capture instead of a title-art-only image.",
  ].join("\n");
}

/** Screen types that are art only: title screen, key art, splash (never "the app in use"). */
export const TITLE_ART_TYPES: ReadonlySet<string> = new Set([
  "key_art",
  "title_image",
  "feature_image",
  "loading_screen",
]);

/** Words of a free-text screen description that mean title art, splash or logo only. */
const ART_WORDS =
  /\b(title (?:art|screen|image)|key ?(?:art|visual)|splash(?: screen)?|logo(?:[- ]only)?|loading screen|login (?:page|screen)|poster|illustration|character (?:art|showcase|line-?up)|cinematic|full-screen art|artwork)\b/i;
/** Words that show the game in use under the art (a real capture behind the logo). */
const IN_USE =
  /\b(gameplay|battle|fight|combat|in[- ]game|capture|boss|stage|run|dungeon|screen of|hud|skill|upgrade|progression|map|shop)\b/i;

/** A free-text screen description that is merely title art (no game in use), by words. */
export function merelyTitleArt(screen: string): boolean {
  return ART_WORDS.test(screen) && !IN_USE.test(screen.replace(ART_WORDS, ""));
}

interface SpecSlot {
  position: number;
  screenType: string;
}

/**
 * Guideline 2.3.3 on an Apple image recommendation, by code: an image spec that is art only
 * (title art, key art, splash) is refused in every position, and so is a gallery of art only.
 * A title or logo image is fine when it shows the game in use: an in-game screen type with the
 * logo over it.
 */
export function titleArtProblems(slots: readonly SpecSlot[]): string[] {
  const out: string[] = [];
  const art = slots.filter((s) => TITLE_ART_TYPES.has(s.screenType));
  if (slots.length && art.length === slots.length)
    out.push(
      `App Store Guideline 2.3.3: every image is title art; screenshots must show the game in use`,
    );
  for (const s of art)
    out.push(
      `position ${s.position}: App Store Guideline 2.3.3 ("${appleRule("2.3.3").quote}"): show the game in use, e.g. the logo over a real gameplay capture, and label it with that screen's type`,
    );
  return out;
}

/** The same check on the free-text slots of an A/B variant. */
export function variantTitleArtProblems(
  slots: readonly { position: number; screen: string }[],
): string[] {
  return slots
    .filter((s) => merelyTitleArt(s.screen))
    .map(
      (s) =>
        `position ${s.position} is title art only, which App Store Guideline 2.3.3 does not allow: show the game in use`,
    );
}

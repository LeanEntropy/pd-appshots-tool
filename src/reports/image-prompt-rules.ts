import { APPLE_RULES } from "../appstore/apple-rules.ts";

/**
 * The store's part of an image prompt (user, 2026-10-30): the hard upload specs and the policy
 * lines, per store. Each line is a knowledge-base entry (official Google or Apple page); the
 * wording is the entry's claim when the KB holds it, else the same claim kept here, so a prompt
 * never lacks its rules. Enforced rules are never to be broken; review risks are avoided.
 */
export type PromptStore = "play" | "appstore";

export interface StoreRules {
  name: string;
  /** Exact output size for an orientation, e.g. "1080 x 1920 px (9:16 portrait)". */
  size: (orientation: string) => string;
  format: string;
  hard: string[];
  risks: string[];
  /** Notes for this slot (e.g. App Store 2.3.3 on a title-art spec). */
  slotNotes: (screenType: string, position: number) => string[];
}

/** id -> claim, from the knowledge base when it is loaded (missing ids keep the text below). */
export type KbClaims = ReadonlyMap<string, string>;

const PLAY_FALLBACK: Record<string, string> = {
  "gp-017":
    "Play screenshots must be JPEG or 24-bit PNG with no alpha, with minimum dimension 320px and maximum dimension 3840px, and the long side no more than twice the short side.",
  "gp-018":
    "To be eligible for recommendation in Play formats that use screenshots, games need at least three 16:9 landscape screenshots (minimum 1920x1080) or three 9:16 portrait screenshots (minimum 1080x1920) that depict the in-game experience.",
  "gp-007":
    "The Metadata policy forbids text or images in the app title, icon and developer name that indicate store performance or ranking, price or promotional information, or relations to Google Play programs.",
  "gp-009":
    "The Metadata policy lists images or text indicating store performance or ranking (such as App of the year, #1, Best of Play 20XX, Popular, award icons) and price or promotional text as common violations.",
  "gp-004":
    "Google recommends that screenshots contain nothing that suggests Play performance, ranking, accolades, awards, user testimonials or price and promotional information, such as Best, #1, Top, New, Discount, Sale or Million Downloads.",
  "gp-013":
    "Google recommends avoiding device imagery, third-party trademarked characters or logos without permission, and other stores' badges in screenshots and the feature graphic.",
};

const APPLE_FALLBACK: Record<string, string> = {
  "ap-017":
    "App Store screenshots must be 1 to 10 images in .jpeg, .jpg or .png format and cannot contain alpha channels or transparency.",
  "ap-018":
    "iPhone 6.9-inch screenshots are required for apps that run on iPhone (6.5-inch accepted when 6.9-inch are not provided), and 13-inch iPad screenshots are required for apps that run on iPad.",
  "ap-001":
    "Guideline 2.3 requires that app metadata, including description, screenshots and previews, accurately reflects the app's core experience and is kept up to date with new versions.",
  "ap-011":
    "Guideline 2.3.8 requires icons, screenshots and previews to adhere to a 4+ age rating even if the app is rated higher, for example avoiding a gruesome death or a gun pointed at a specific character.",
};

const claim = (kb: KbClaims, id: string, fallback: Record<string, string>) =>
  kb.get(id) ?? fallback[id] ?? "";

const isLandscape = (o: string) => /landscape/i.test(o);

function playRules(kb: KbClaims): StoreRules {
  const c = (id: string) => claim(kb, id, PLAY_FALLBACK);
  return {
    name: "Google Play",
    size: (o) =>
      isLandscape(o) ? "1920 x 1080 px (16:9 landscape)" : "1080 x 1920 px (9:16 portrait)",
    format: "24-bit PNG or JPEG, no transparency (no alpha channel)",
    hard: [c("gp-017"), c("gp-018"), c("gp-007"), c("gp-009")],
    risks: [
      `High risk on screenshots (official guidance, also listed as Metadata-policy violations): ${c("gp-004")} Never write "Free", a price, a ranking or an award on the image.`,
      c("gp-013"),
    ],
    slotNotes: () => [],
  };
}

const TITLE_ART = new Set(["title_image", "loading_screen", "key_art", "feature_image"]);

function appleRules(kb: KbClaims): StoreRules {
  const c = (id: string) => claim(kb, id, APPLE_FALLBACK);
  const quote = (r: (typeof APPLE_RULES)[number]) =>
    `${r.name} (Guideline ${r.id}): "${kb.get(r.kb) ?? r.quote}"`;
  const by = (label: string) => APPLE_RULES.filter((r) => r.label === label && r.id !== "2.3.4");
  return {
    name: "App Store",
    // The iPhone 6.9-inch shape (the required size; it scales down to the smaller iPhones).
    size: (o) =>
      isLandscape(o)
        ? "2796 x 1290 px (iPhone 6.9-inch, landscape)"
        : "1290 x 2796 px (iPhone 6.9-inch, portrait)",
    format: "PNG or JPEG, no transparency (no alpha channel)",
    hard: [...by("hard").map(quote), c("ap-017"), c("ap-018"), c("ap-001"), c("ap-011")],
    risks: by("review").map(quote),
    slotNotes: (screenType, position) => [
      ...(TITLE_ART.has(screenType)
        ? [
            "The spec below is title art. On the App Store an image must show the app in use (Guideline 2.3.3): put the logo and headline over a real gameplay capture instead of title art alone.",
          ]
        : []),
      ...(position <= 3
        ? [
            "Positions 1 to 3 can appear in App Store search results, so this image must read at search-result size.",
          ]
        : []),
    ],
  };
}

export function storeRules(store: PromptStore, kb: KbClaims = new Map()): StoreRules {
  return store === "appstore" ? appleRules(kb) : playRules(kb);
}

/** The KB ids the prompt quotes (the server loads only these). */
export const PROMPT_KB_IDS = [
  ...Object.keys(PLAY_FALLBACK),
  ...Object.keys(APPLE_FALLBACK),
  ...APPLE_RULES.map((r) => r.kb),
];

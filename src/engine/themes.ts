/**
 * Headline and store-text themes by a per-language lexicon (plan 5.1), by code at no cost. A
 * theme is what a line promises the player (offline play, relaxing, brain training). "mechanic"
 * marks a line that only names an action of play (match, clear, merge): competitors sell
 * benefits, so a mechanic-only line of ours is a MESSAGE item.
 */
export const THEMES = {
  offline: "offline play",
  relax: "relaxing / calm",
  sleep: "better sleep",
  brain: "brain training",
  large_tiles: "large tiles / easy on the eyes",
  levels: "many levels",
  daily: "daily challenge",
  no_timer: "no timers / no pressure",
  themes: "new themes / content",
  classic: "classic game",
  free: "free to play",
  collect: "collect",
  battle: "battle / combat",
  boss: "boss fights",
  upgrade: "upgrade / grow stronger",
  skills: "skill combos",
  explore: "adventure / explore",
  pvp: "compete with players",
  idle: "idle / auto play",
  rewards: "rewards",
  mechanic: "names a play action only",
} as const;
export type Theme = keyof typeof THEMES;

const W = (s: string) => new RegExp(s, "iu");
/** Shared by every language (English words appear in most stores' lines). */
const BASE: [Theme, RegExp][] = [
  [
    "offline",
    W(
      "off-?line|no (?:wi-?fi|internet)|sin conexi[oó]n|hors (?:ligne|connexion)|senza (?:rete|connessione)|ohne internet|ilman nett",
    ),
  ],
  [
    "relax",
    W(
      "relax|calm|cozy|cosy|comfy|peace|escape|unwind|entspann|ruhig|d[ée]tend|calme|rilass|rentoutt|tranquil",
    ),
  ],
  ["sleep", W("sleep|bedtime|schlaf|sommeil|dormir|sonno|uni\\b|unta")],
  ["brain", W("brain|mind|sharp|smart|iq\\b|logic|gehirn|cerveau|mente|cervello|aivo|\\b[äa]ly")],
  [
    "large_tiles",
    W(
      "large tiles|big tiles|eye[- ]?friendly|easy on the eyes|gro[ßs]en? (?:steine|kacheln)|grandes (?:tuiles|fichas)|tessere grandi|azulejos grandes|isot laatat",
    ),
  ],
  [
    "levels",
    W(
      "\\d[\\d,.]*\\+? ?levels|thousands of levels|levels?\\b.*\\d|niveaux|livelli|niveles|level\\b",
    ),
  ],
  [
    "daily",
    W("daily|every ?day|t[äa]glich|quotidien|chaque jour|cada d[ií]a|ogni giorno|p[äa]ivitt"),
  ],
  [
    "no_timer",
    W(
      "no tim(?:er|e limit)s?|no rush|no pressure|kein zeitlimit|sans limite de temps|sin l[ií]mite de tiempo|senza limiti di tempo",
    ),
  ],
  ["themes", W("new themes|themes?\\b|new content|seasons?\\b|th[eè]mes")],
  ["classic", W("classic|klassisch|classique|cl[aá]sico|classico|klassinen")],
  ["free", W("\\bfree\\b|gratis|gratuit|kostenlos|ilmai")],
  ["collect", W("collect|catch|gather|sammle|collectionn|colecciona|colleziona")],
  ["battle", W("battle|fight|combat|attack|war\\b|kampf|bataille|batalla|battaglia")],
  ["boss", W("boss")],
  ["upgrade", W("upgrade|level up|evolve|stronger|power|grow|evolution|merge")],
  ["skills", W("\\bskills?\\b|\\bcombos?\\b|\\bclass(?:es)?\\b")],
  ["explore", W("adventure|explore|journey|world|quest|abenteuer|aventure|aventura|avventura")],
  ["pvp", W("pvp|arena|compete|versus|\\bvs\\b|rank")],
  ["idle", W("idle|afk|auto")],
  ["rewards", W("reward|gift|summon|prize")],
];
const MECHANIC = W(
  "^(?:match|clear|merge|tap|swipe|connect|pair|combine|match (?:&|and) clear|play)[\\s!&,.]*(?:(?:&|and)\\s*(?:match|clear|merge|tap|swipe|connect|pair|combine)[\\s!.]*)?$",
);

/** Themes one line (or a whole text) promises, in any of the supported languages. */
export function themesOf(text: string): Theme[] {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const out = BASE.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (!out.length && MECHANIC.test(t)) return ["mechanic"];
  return out;
}

/** A line that names a play action only (e.g. "MATCH & CLEAR"). */
export const mechanicOnly = (text: string) => {
  const th = themesOf(text);
  return th.length === 1 && th[0] === "mechanic";
};

export const themeLabel = (t: Theme) => THEMES[t];

import { reshapedPair } from "../analysis/layer-crops.ts";
import { hamming, NEAR_IDENTICAL_BITS } from "../store/identity.ts";
import { pairKey } from "./anchors.ts";
import { RESHAPED_BITS } from "./cross-store.ts";
import type {
  AppleSlotIn,
  Mark,
  PairInput,
  PairResult,
  Reading,
  Row,
  StorePattern,
  StoreSlot,
} from "./stores-types.ts";

/** Every marketing text of an image, normalised, in reading order. */
const words = (r: Reading) => norm(r.texts.length ? r.texts.join(" ") : r.headline);
/** Proven the same screen: the same file, the same picture, or checked by the user or the text comparison. */
const proven = (m: Mark) => m === "same-file" || m === "same-picture" || m === "same-screen";

/**
 * The deterministic core of the "Google Play vs App Store" report (plan-app-store 7.2): per game
 * and country, each App Store image marked against the same game's Google Play images, the
 * position table, count, order, orientation, text and title-art differences; then the patterns
 * across competitors with n and the counting rule. `same`: pairs known to be the same screen
 * (answered by the user, or compared text-only and found the same screen).
 */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();

function markOf(
  a: AppleSlotIn,
  play: readonly StoreSlot[],
  same: ReadonlySet<string>,
): { mark: Mark; playPosition: number | null } {
  const at = (id: string) => play.find((p) => p.imageId === id)?.position ?? null;
  if (play.some((p) => p.imageId === a.imageId))
    return { mark: "same-file", playPosition: at(a.imageId) };
  if (a.sameAs && play.some((p) => p.imageId === a.sameAs))
    return { mark: "same-picture", playPosition: at(a.sameAs) };
  const known = play.find((p) => same.has(pairKey(p.imageId, a.imageId)));
  if (known) return { mark: "same-screen", playPosition: known.position };
  const near = play
    .filter((p) => p.phash && p.phash.length === a.phash.length)
    .map((p) => ({ p, bits: hamming(p.phash, a.phash) }))
    .filter((x) => x.bits <= (reshapedPair(x.p, a) ? RESHAPED_BITS : NEAR_IDENTICAL_BITS))
    .sort((x, y) => x.bits - y.bits)[0];
  if (near) return { mark: "probably-same", playPosition: near.p.position };
  return { mark: "new", playPosition: null };
}

const shape = (slots: readonly StoreSlot[]) => {
  const l = slots.filter((s) => s.orientation === "landscape").length;
  if (!slots.length) return "none";
  return l === 0 ? "portrait" : l === slots.length ? "landscape" : "mixed";
};

const leadArt = (slots: readonly StoreSlot[]) => {
  const lead = slots.slice(0, 3);
  if (!lead.length || lead.some((s) => !s.reading)) return null;
  return lead.filter((s) => s.reading?.art).length;
};

export function comparePair(x: PairInput, same: ReadonlySet<string>): PairResult {
  const play = [...x.play.slots].sort((a, b) => a.position - b.position);
  const apple = [...x.apple.slots].sort((a, b) => a.position - b.position);
  const marks: Record<Mark, number> = {
    "same-file": 0,
    "same-picture": 0,
    "same-screen": 0,
    "probably-same": 0,
    new: 0,
  };
  const marked = apple.map((a) => ({ ...a, ...markOf(a, play, same) }));
  for (const a of marked) marks[a.mark]++;
  const rows: Row[] = [];
  let compared = 0;
  let changed = 0;
  for (let n = 1; n <= Math.max(play.length, apple.length); n++) {
    const p = play[n - 1] ?? null;
    const a = marked[n - 1] ?? null;
    const twin = a?.playPosition ? play.find((s) => s.position === a.playPosition) : undefined;
    let text: Row["text"] = null;
    // Only proven pairs are compared (a fingerprint alone never proves the same screen).
    if (a && twin && proven(a.mark) && a.reading && twin.reading)
      if (words(a.reading) || words(twin.reading)) {
        text = words(a.reading) === words(twin.reading) ? "same" : "changed";
        compared++;
        if (text === "changed") changed++;
      }
    rows.push({ n, play: p, apple: a, text });
  }
  const seq = marked
    .filter((a) => proven(a.mark))
    .map((a) => a.playPosition)
    .filter((v): v is number => v !== null);
  const order =
    seq.length < 2
      ? "not-comparable"
      : seq.every((v, i) => i === 0 || v > (seq[i - 1] as number))
        ? "same"
        : "reordered";
  const reused = apple.length - marks.new - marks["probably-same"];
  return {
    appId: x.appId,
    name: x.name,
    ours: x.ours,
    gl: x.gl,
    country: x.country,
    state: { play: x.play.state, apple: x.apple.state },
    count: { play: play.length, apple: apple.length },
    rows,
    marks,
    reuseShare: apple.length ? reused / apple.length : 0,
    newShare: apple.length ? marks.new / apple.length : 0,
    unconfirmed: marks["probably-same"],
    order,
    orientation: { play: shape(play), apple: shape(apple) },
    reshaped: marked.filter((a) => {
      const t = play.find((p) => p.position === a.playPosition);
      return proven(a.mark) && !!t && reshapedPair(t, a);
    }).length,
    text: { compared, changed },
    leadArt: { play: leadArt(play), apple: leadArt(apple) },
    appleArt: apple.filter((a) => a.reading?.art).map((a) => a.position),
  };
}

/** Both decks exist and hold images: a pair the patterns can count. */
export const comparable = (r: PairResult) =>
  r.state.play === "ok" && r.state.apple === "ok" && r.count.play > 0 && r.count.apple > 0;

interface Rule {
  id: string;
  /** "{n} of {of} competitors …" */
  statement: string;
  has: (r: PairResult) => boolean | null;
}

/** The counting rules, each in plain words (the report shows the rule next to the number). */
export const PATTERN_RULES: Rule[] = [
  {
    id: "reuse",
    statement: "use mostly the same screens on both stores (80% or more of the App Store images)",
    // Unchecked pairs could go either way: counted only once the answer cannot change it.
    has: (r) =>
      r.reuseShare >= 0.8
        ? true
        : r.reuseShare + r.unconfirmed / r.count.apple >= 0.8
          ? null
          : false,
  },
  {
    id: "adapt",
    statement: "made mostly new pictures for the App Store (half or more of its images)",
    has: (r) =>
      r.newShare >= 0.5 ? true : r.newShare + r.unconfirmed / r.count.apple >= 0.5 ? null : false,
  },
  {
    id: "fewer",
    statement: "show fewer images on the App Store than on Google Play",
    has: (r) => r.count.apple < r.count.play,
  },
  {
    id: "same-order",
    statement: "keep the Google Play order for the screens both stores share",
    has: (r) => (r.order === "not-comparable" ? null : r.order === "same"),
  },
  {
    id: "reshape",
    statement: "reshape shared screens to the App Store's format",
    has: (r) => (r.reuseShare === 0 ? null : r.reshaped > 0),
  },
  {
    id: "text",
    statement: "change the text on screens both stores share",
    has: (r) => (r.text.compared ? r.text.changed > 0 : null),
  },
  {
    id: "lead-play",
    statement: "lead with game screens on the App Store (no title art in positions 1 to 3)",
    has: (r) => (r.leadArt.apple === null ? null : r.leadArt.apple === 0),
  },
];

/** The patterns of one country: competitors only; ours is compared against them. */
export function storePatterns(pairs: readonly PairResult[], gl: string): StorePattern[] {
  const here = pairs.filter((r) => r.gl === gl && comparable(r));
  const them = here.filter((r) => !r.ours);
  const ours = here.find((r) => r.ours);
  const out: StorePattern[] = [];
  for (const rule of PATTERN_RULES) {
    const counted = them.filter((r) => rule.has(r) !== null);
    const yes = counted.filter((r) => rule.has(r) === true);
    if (!counted.length) continue;
    const mine = ours ? rule.has(ours) : null;
    const pattern = yes.length >= 3 && yes.length * 2 >= counted.length;
    out.push({
      id: rule.id,
      country: here[0]?.country ?? gl,
      gl,
      statement: rule.statement,
      n: yes.length,
      of: counted.length,
      pattern,
      games: yes.map((r) => r.name),
      ours: !pattern || mine === null ? "n/a" : mine ? "fits" : "different",
      oursNote: mine === null ? "not comparable" : mine ? "we do" : "we do not",
    });
  }
  return out;
}

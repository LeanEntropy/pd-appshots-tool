import type { CountryHabits, Habit, HabitId, LocalRow } from "./localisation.ts";
import type { MarketRef } from "./types.ts";

/**
 * Localisation habits (plan-reports 3, point 4): for each, the share of competitors who do it in
 * a country and whether we do, marked same or different with the reason. Code only.
 */
const base = (lang: string) => lang.toLowerCase().split(/[-_]/)[0] ?? "";

export const HABITS: Record<HabitId, { label: string; definition: string }> = {
  translate: {
    label: "Translate the text on the images",
    definition: "At least one image carries its headline in the country's own language.",
  },
  "keep-text": {
    label: "Keep text in the main country's language",
    definition: "At least one image with text keeps the main country's language (not translated).",
  },
  swap: {
    label: "Use different pictures",
    definition: "At least one image is a picture the main-country page does not use.",
  },
  reorder: {
    label: "Change the order",
    definition: "At least one picture sits at another position than on the main-country page.",
  },
  colours: {
    label: "Change band colours or extras",
    definition:
      "The text band's colour, shape or place, or a character or item next to it, changes.",
  },
};

export const does: Record<HabitId, (r: LocalRow) => boolean> = {
  translate: (r) => r.translated > 0,
  "keep-text": (r) => r.keptText > 0,
  swap: (r) => r.different > 0,
  reorder: (r) => r.moved > 0,
  colours: (r) => r.bandChanged > 0 || r.swapped > 0,
};

/** Our habits vs the competitors' in one country ([V] same as most, [X] different). */
export function habitsOf(rows: readonly LocalRow[], m: MarketRef, main: MarketRef): CountryHabits {
  const here = rows.filter((r) => r.gl === m.gl && r.state === "ok");
  const comps = here.filter((r) => !r.ours);
  const ours = here.find((r) => r.ours);
  const sameLanguage = base(m.hl) === base(main.hl);
  const ids = (Object.keys(HABITS) as HabitId[]).filter(
    (id) => !(sameLanguage && (id === "translate" || id === "keep-text")),
  );
  const habits = ids.map((id): Habit => {
    const yes = comps.filter(does[id]);
    const o = ours ? does[id](ours) : null;
    const most = yes.length * 2 >= comps.length;
    const fits = comps.length < 2 || o === null ? null : o === most;
    const who = `${yes.length} of ${comps.length} competitors`;
    const reason =
      comps.length < 2
        ? "fewer than 2 competitors to compare here"
        : o === null
          ? `${who} do it; our game has no page to compare here`
          : `${who} do it; we ${o ? "do" : "do not"}`;
    return {
      id,
      ...HABITS[id],
      n: yes.length,
      of: comps.length,
      games: yes.map((r) => r.game),
      ours: o,
      fits,
      reason,
    };
  });
  return { gl: m.gl, country: m.label, habits };
}

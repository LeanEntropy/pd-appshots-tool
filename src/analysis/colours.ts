/** Colour families by code, so "#1f6fd0" and "royal blue" count as the same thing in patterns. */
export type Family =
  | "red"
  | "orange"
  | "yellow"
  | "green"
  | "teal"
  | "blue"
  | "purple"
  | "pink"
  | "brown"
  | "black"
  | "white"
  | "grey";

const NAMES: [RegExp, Family][] = [
  [/black|dark|night/, "black"],
  [/white|cream|ivory/, "white"],
  [/gr[ae]y|silver/, "grey"],
  [/brown|beige|tan|wood|bronze/, "brown"],
  [/pink|magenta|rose/, "pink"],
  [/purple|violet|lilac|lavender/, "purple"],
  [/teal|cyan|turquoise|aqua/, "teal"],
  [/blue|navy|azure/, "blue"],
  [/green|lime|olive|emerald/, "green"],
  [/yellow|gold/, "yellow"],
  [/orange|amber/, "orange"],
  [/red|crimson|scarlet|maroon/, "red"],
];

export function hexFamily(hex: string): Family | null {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => Number.parseInt(x as string, 16) / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l < 0.12) return "black";
  if (l > 0.92 && s < 0.5) return "white";
  if (s < 0.15) return l > 0.75 ? "white" : l < 0.25 ? "black" : "grey";
  let h = 0;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if ((h < 15 || h >= 345) && l < 0.35) return "brown";
  if (h >= 15 && h < 45 && l < 0.4) return "brown";
  if (h < 15 || h >= 345) return "red";
  if (h < 45) return "orange";
  if (h < 70) return "yellow";
  if (h < 160) return "green";
  if (h < 195) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

/** Family from a hex, else from the colour's name, else null. */
export function colourFamily(name: string, hex: string): Family | null {
  const byHex = hexFamily(hex);
  if (byHex) return byHex;
  const n = name.toLowerCase();
  for (const [re, f] of NAMES) if (re.test(n)) return f;
  return null;
}

/** Family from free text such as "yellow #f7f704" (text colour fields). */
export function textColourFamily(s: string): Family | null {
  const hex = /#[0-9a-f]{6}/i.exec(s)?.[0] ?? "";
  return colourFamily(s, hex);
}

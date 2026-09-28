import { loadCountries } from "../config/countries.ts";
import { escHtml } from "./shell.ts";

/**
 * Country flags next to country names (Windows shows no flag emoji, so these are real pictures:
 * the flag-icons SVGs served by the tool at /flags/<code>.svg, nothing from the internet).
 * One helper, countryLabel(code) = flag + name, in TypeScript for server-made HTML and the same
 * in the pages' script, plus flagText() that puts a flag before each country name in a title.
 * Flags go only next to country names in titles and headings, never in running text (user,
 * 2026-09-29): sentences, notes and descriptions use the plain name.
 */
const NAMES: Record<string, string> = Object.fromEntries(
  loadCountries().countries.map((c) => [c.gl, c.label]),
);

export const FLAG_CSS = `
.cty { white-space: nowrap; }
img.flag { display: inline-block; width: 20px; height: 15px; margin-right: 5px; vertical-align: -2px; border-radius: 2px; object-fit: cover; box-shadow: 0 0 0 1px rgba(0,0,0,.18); }
`;

/** The flag picture of a Google Play country code, or "" for a code without one. */
export function flagImg(gl: string): string {
  const code = gl.toLowerCase();
  return NAMES[code]
    ? `<img class="flag" src="/flags/${code}.svg" alt="" width="20" height="15">`
    : "";
}

/** Flag plus name: "Japan" by default, or the name given (e.g. "Philippines (Filipino)"). */
export function countryLabel(gl: string, name?: string): string {
  const code = gl.toLowerCase();
  return `<span class="cty">${flagImg(code)}${escHtml(name ?? NAMES[code] ?? code.toUpperCase())}</span>`;
}

/** The same helpers in the pages' script (needs actEsc from the action helper). */
export const FLAG_SCRIPT = `
const FLAG_NAMES = ${JSON.stringify(NAMES).replace(/</g, "\\u003c")};
const FLAGS_ON = typeof location === "undefined" || String(location.protocol).startsWith("http");
function flagImg(gl) {
  const code = String(gl || "").toLowerCase();
  return FLAGS_ON && FLAG_NAMES[code] ? '<img class="flag" src="/flags/' + code + '.svg" alt="" width="20" height="15">' : "";
}
function countryLabel(gl, name) {
  const code = String(gl || "").toLowerCase();
  return '<span class="cty">' + flagImg(code) + actEsc(name || FLAG_NAMES[code] || code.toUpperCase()) + "</span>";
}
// The code of a label such as "Japan", "Philippines (Filipino)" or "the United States", or "".
function glOfLabel(label) {
  const n = String(label || "").replace(/\\s*\\([^)]*\\)\\s*$/, "").replace(/^the /i, "").trim().toLowerCase();
  for (const gl in FLAG_NAMES) if (FLAG_NAMES[gl].toLowerCase() === n) return gl;
  return "";
}
// A country label with its flag (escaped); a label that is not a country stays plain text.
function withFlag(label) { const gl = glOfLabel(label); return gl ? countryLabel(gl, label) : actEsc(label); }
const FLAG_RE = new RegExp("(^|[^A-Za-z])(" + Object.values(FLAG_NAMES).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^$()|[\\]\\\\{}]/g, "\\\\$&")).join("|") + ")(?![A-Za-z])", "g");
const FLAG_BY_NAME = Object.fromEntries(Object.entries(FLAG_NAMES).map(([gl, n]) => [n, gl]));
// Plain text (escaped) with a flag before every country name it mentions.
function flagText(text) {
  return actEsc(text).replace(FLAG_RE, (m, pre, name) => pre + '<span class="cty">' + flagImg(FLAG_BY_NAME[name]) + name + "</span>");
}
`;

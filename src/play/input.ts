/** What the user typed into a "link, package ID or name" box (plan 3.1). */
export type PlayInput =
  | { kind: "id"; appId: string }
  | { kind: "search"; term: string }
  | { kind: "bad"; message: string };

/** A Google Play package ID, at most 150 characters (it becomes a storage key segment). */
export const PACKAGE_ID = /^(?=.{3,150}$)[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

const NOT_A_GAME_PAGE =
  "This is not a game's page. Open the game on Google Play and copy that link.";
const EMPTY = "Paste a Google Play link or a package ID, or type a game's name.";

function idFromUrl(text: string): PlayInput | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol === "market:") {
    const id = url.searchParams.get("id") ?? "";
    return PACKAGE_ID.test(id)
      ? { kind: "id", appId: id }
      : { kind: "bad", message: NOT_A_GAME_PAGE };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "play.google.com" && host !== "m.play.google.com")
    return {
      kind: "bad",
      message: "This is not a Google Play link. Open the game on Google Play and copy that link.",
    };
  const path = url.pathname.replace(/\/+$/, "");
  const id = url.searchParams.get("id") ?? "";
  if (path === "/store/apps/details" && PACKAGE_ID.test(id)) return { kind: "id", appId: id };
  return { kind: "bad", message: NOT_A_GAME_PAGE };
}

/** A link or package ID becomes an ID; other text of 2 to 100 characters is a name search. */
export function parsePlayInput(raw: string): PlayInput {
  const text = raw.trim();
  if (!text) return { kind: "bad", message: EMPTY };
  if (/^(https?|market):/i.test(text))
    return idFromUrl(text) ?? { kind: "bad", message: NOT_A_GAME_PAGE };
  if (/^(play\.google\.com|m\.play\.google\.com)\//i.test(text))
    return idFromUrl(`https://${text}`) ?? { kind: "bad", message: NOT_A_GAME_PAGE };
  if (PACKAGE_ID.test(text)) return { kind: "id", appId: text };
  if (text.length < 2)
    return { kind: "bad", message: "Type at least 2 letters of the game's name." };
  if (text.length > 100) return { kind: "bad", message: "That is too long for a game's name." };
  return { kind: "search", term: text };
}

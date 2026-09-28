/**
 * The order difference of one game's deck in one country against its main-country deck, in
 * plain words ("positions 3 and 4 swapped; a new picture at 5; 7 images instead of 6"), from
 * the matched pictures (localisation.ts). Code only.
 */
export function orderNote(
  lines: readonly { position: number; mainPosition: number | null }[],
  mainLength: number,
): string {
  const parts: string[] = [];
  const moved = lines.filter((l) => l.mainPosition !== null && l.mainPosition !== l.position);
  const done = new Set<number>();
  for (const l of moved) {
    if (done.has(l.position)) continue;
    const back = moved.find((o) => o.position === l.mainPosition && o.mainPosition === l.position);
    if (back) {
      const [a, b] = [l.position, back.position].sort((x, y) => x - y);
      parts.push(`positions ${a} and ${b} swapped`);
      done.add(l.position).add(back.position);
      continue;
    }
    parts.push(`the main page's image ${l.mainPosition} is at ${l.position}`);
    done.add(l.position);
  }
  const fresh = lines.filter((l) => l.mainPosition === null).map((l) => l.position);
  if (fresh.length)
    parts.push(
      fresh.length === 1
        ? `a picture not used on the main page at ${fresh[0]}`
        : `pictures not used on the main page at ${fresh.join(", ")}`,
    );
  const used = new Set(lines.map((l) => l.mainPosition).filter((p) => p !== null));
  const unused = Array.from({ length: mainLength }, (_, i) => i + 1).filter((p) => !used.has(p));
  if (unused.length && unused.length < mainLength)
    parts.push(
      `the main page's image${unused.length > 1 ? "s" : ""} ${unused.join(", ")} not used`,
    );
  if (lines.length !== mainLength) parts.push(`${lines.length} images instead of ${mainLength}`);
  return parts.length ? parts.join("; ") : "same order as the main page";
}

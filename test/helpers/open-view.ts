/** What a reader sees without opening anything: every closed <details> keeps only its summary. */
export function openView(html: string): string {
  const out: string[] = [];
  const re = /<details\b[^>]*>|<\/details>|<summary\b[^>]*>|<\/summary>/g;
  const stack: { open: boolean; inSummary: boolean }[] = [];
  const shown = () => stack.every((s) => s.open || s.inSummary);
  let last = 0;
  for (const m of html.matchAll(re)) {
    if (shown()) out.push(html.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("<details")) stack.push({ open: /\sopen[\s>]/.test(t), inSummary: false });
    else if (t === "</details>") stack.pop();
    else if (t.startsWith("<summary")) {
      const top = stack[stack.length - 1];
      if (top) top.inSummary = true;
    } else {
      const top = stack[stack.length - 1];
      if (top) top.inSummary = false;
    }
    last = (m.index ?? 0) + t.length;
  }
  if (shown()) out.push(html.slice(last));
  return out.join("");
}

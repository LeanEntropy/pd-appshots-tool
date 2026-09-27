/**
 * Renders the tool's own report markdown (headings, paragraphs, lists, tables, bold, image links)
 * to escaped HTML for the gallery. Report image paths (../../images/) become server paths, and
 * every thumbnail gets the (i) button that shows its analysis.
 */
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

const src = (p: string) => (p.startsWith("../../images/") ? `/images/${p.slice(13)}` : "");

function inline(text: string): string {
  const parts: string[] = [];
  const re = /\[!\[([^\]]*)\]\(([^)\s]+)\)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    parts.push(bold(esc(text.slice(last, m.index))));
    const [alt, img, href] = [m[1] ?? "", src(m[2] ?? ""), src(m[3] ?? "")];
    const id = /thumb\/([0-9a-f]{64})\.webp$/.exec(img)?.[1];
    parts.push(
      img
        ? `<span class="rimg"><a href="${esc(href)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(img)}" alt="${esc(alt)}"></a>${id ? `<button type="button" class="info" data-info="${id}" aria-label="Show analysis" aria-expanded="false" aria-controls="infoPop">i</button>` : ""}</span>`
        : esc(alt),
    );
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(bold(esc(text.slice(last))));
  return parts.join("").replace(/\\\|/g, "|");
}

const bold = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

function cells(row: string): string[] {
  return row
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    const h = /^(#{1,4}) (.*)$/.exec(line);
    if (h) {
      const level = Math.min(6, (h[1] as string).length + 1);
      out.push(`<h${level}>${inline(h[2] as string)}</h${level}>`);
      i++;
    } else if (line.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && (lines[i] as string).startsWith("|"))
        rows.push(lines[i++] as string);
      const [head, , ...body] = rows;
      out.push(
        `<div class="tablewrap"><table class="rtable"><thead><tr>${cells(head ?? "")
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>${body
          .map(
            (r) =>
              `<tr>${cells(r)
                .map((c) => `<td>${inline(c)}</td>`)
                .join("")}</tr>`,
          )
          .join("")}</tbody></table></div>`,
      );
    } else if (line.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && (lines[i] as string).startsWith("- "))
        items.push(`<li>${inline((lines[i++] as string).slice(2))}</li>`);
      out.push(`<ul>${items.join("")}</ul>`);
    } else if (line.trim()) {
      out.push(`<p>${inline(line)}</p>`);
      i++;
    } else i++;
  }
  return out.join("\n");
}

import { join } from "node:path";
import { safeName } from "../util/fsx.ts";
import type { ViewApp, ViewDeck, ViewModel } from "./model.ts";

/** Relative path from views/decks/<app>/ to the images folder. */
const IMG = "../../../images/";

function groupLabel(a: ViewApp): string {
  if (a.group === "ours") return "Our game";
  if (a.group === "named") return `Named competitor (${a.tier.replace("_", " ")})`;
  return "Chart game (shown raw, not analysed)";
}

function ranks(a: ViewApp): string {
  const r = Object.entries(a.chartRanks).map(([gl, n]) => `${gl.toUpperCase()} #${n}`);
  return r.length ? r.join(", ") : "not in the configured charts";
}

export function deckMarkdown(a: ViewApp, d: ViewDeck): string {
  const lines = [
    `# ${a.name}: ${d.label}`,
    "",
    `- Package: \`${a.appId}\``,
    `- Group: ${groupLabel(a)}`,
    `- Chart position: ${ranks(a)}`,
  ];
  if (d.status !== "ok") {
    lines.push(
      `- Status: ${d.status === "unavailable" ? "not available in this country" : "could not be read"}`,
      "",
    );
    return lines.join("\n");
  }
  const same = d.images.filter((i) => i.sameAsBaseline).length;
  lines.push(
    `- Screenshots: ${d.length} (store order; the store listed ${d.rawCount} entries including repeats)`,
    `- Identical to the English deck: ${same} of ${d.length}`,
    "",
    "| Position | Screenshot | Size | Device guess | Same as English |",
    "|---|---|---|---|---|",
  );
  for (const i of d.images) {
    const pic =
      i.thumb && i.full
        ? `[![position ${i.position}](${IMG}${i.thumb})](${IMG}${i.full})`
        : "download failed";
    lines.push(
      `| ${i.position} | ${pic} | ${i.width}x${i.height} | ${i.device} | ${i.sameAsBaseline ? "yes" : ""} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

export function indexMarkdown(vm: ViewModel): string {
  const lines = [
    `# Raw decks: ${vm.project}`,
    "",
    `Run \`${vm.runId}\`. No AI analysis; images shown as downloaded.`,
    "",
  ];
  const section = (title: string, apps: ViewApp[]) => {
    lines.push(
      `## ${title} (${apps.length})`,
      "",
      "| Game | Chart position | English deck | Locales |",
      "|---|---|---|---|",
    );
    for (const a of apps) {
      const locs = a.decks
        .map(
          (d) =>
            `[${d.gl.toUpperCase()}${d.status === "ok" ? ` ${d.length}` : " n/a"}](${deckFile(a, d)})`,
        )
        .join(" ");
      const english = a.notInBaseline
        ? `not on Google Play in ${vm.coreMarket.label}: not in the core check`
        : a.baselineLength || "n/a";
      lines.push(`| ${a.name} | ${ranks(a)} | ${english} | ${locs} |`);
    }
    lines.push("");
  };
  section("Our game", vm.ours);
  section("Named competitors", vm.named);
  section("Chart games", vm.chart);
  return lines.join("\n");
}

/** Path of a deck page relative to the views folder. */
export function deckFile(a: ViewApp, d: ViewDeck): string {
  return join("decks", safeName(a.appId), `${d.gl}-${safeName(d.hl)}.md`)
    .split("\\")
    .join("/");
}

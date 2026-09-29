import { ACTION_SCRIPT } from "./action.ts";
import { APP_ICON_CSS } from "./app-icon.ts";
import { FLAG_CSS, FLAG_SCRIPT } from "./flags.ts";
import { GAMES_SCRIPT } from "./games-script.ts";
import { LIB_CSS } from "./library-css.ts";
import { page } from "./pages-html.ts";
import { appBar } from "./shell.ts";

const GAMES_CSS = `
.gtools { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; padding: 12px 16px; }
.gtools input[type=search] { flex: 1 1 220px; min-width: 0; font: inherit; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--text); }
.gtools select { font: inherit; padding: 5px 6px; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--text); max-width: 100%; }
.gtools .grow { flex: 1; }
.gcards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 12px; padding: 0 16px; }
.gcard { background: var(--a-surface); border: 1px solid var(--a-div); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.gcard:hover { border-color: var(--a-h); }
.gcard .ghead { display: flex; gap: 10px; align-items: center; text-decoration: none; color: inherit; }
.gcard .icon { width: 44px; height: 44px; flex: none; border-radius: 10px; display: grid; place-items: center; font-weight: 800; font-size: 20px; color: #fff; background: var(--a-head); }
.gcard h2 { margin: 0; font-size: 17px; color: var(--a-h); overflow-wrap: anywhere; }
.gcard .gmeta { font-size: 13px; color: var(--a-muted); }
.gcard p { margin: 0; font-size: 13.5px; }
.gcard details summary { cursor: pointer; font-size: 13px; color: var(--a-h); }
.gcard details p { margin: 4px 0; }
.gempty { padding: 30px 16px; text-align: center; }
`;

/** The games directory (plan-games-library 3): every game we hold data for, metadata only. */
export function gamesHtml(token: string): string {
  const body = `${appBar(null, '<a class="btn-new" href="/">All projects</a>')}
<main class="lib">
<nav class="lib-crumbs" aria-label="Where you are"><a href="/">All projects</a> / <span>Games library</span></nav>
<header class="lib-head"><h1>Games library</h1><span class="sub">Every game any project holds: store pages, pictures and where it is used.</span></header>
<div class="gtools">
<input type="search" id="gSearch" placeholder="Search games, ASO words, keywords..." aria-label="Search games">
<label>Category <select id="gCat"><option value="">All</option></select></label>
<label>Country <select id="gCountry"><option value="">All</option></select></label>
<label>Project <select id="gProject"><option value="">All</option></select></label>
<label>Sort <select id="gSort"><option value="images">Most images</option><option value="checked">Latest store check</option><option value="name">Name</option></select></label>
</div>
<div class="gtools"><span id="gCount" class="meta" aria-live="polite"></span><span class="grow"></span><span id="gUpdated" class="meta" title="A second store read on the same day, or a change made in a terminal, shows after Update the list."></span><button type="button" class="btn" id="gRebuild">Update the list</button></div>
<p id="gStatus" class="act-msg" hidden></p>
<div id="gCards" class="gcards" aria-live="polite"><p class="meta">Loading the games...</p></div>
</main>
<style>${LIB_CSS}${FLAG_CSS}${APP_ICON_CSS}${GAMES_CSS}</style>`;
  return page("Games library", body, token, `${ACTION_SCRIPT}${FLAG_SCRIPT}${GAMES_SCRIPT}`);
}

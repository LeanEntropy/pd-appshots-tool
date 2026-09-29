# Plan: a knowledge base for the store-page expert

Date: 2026-09-29. Status: **draft for user approval, revised after review**. Reviewed once by gpt-5.6-sol on the finished draft (full text: `docs/reviews/plan-knowledge-base-review-gpt.md`; what was applied or declined is at the end). No code yet. The web research is paused until this plan is approved; what was already collected is in section 12.
Authority: `memory/PILLARS.md`. Builds on `docs/plan-reports.md` (3B voice and A/B tests, 3C summary first, frozen inputs, versions), `docs/plan-cross-country.md` (groups, finding kinds, evidence thresholds) and the current synthesis prompts (`patterns.v5`, `recommend.v5`, `recommend-review.v4`, `ab-tests.v2`, `country-advice.v1`, `country-advice-review.v1`, `voice-cmo.v1`).

## 0. Bottom line

- **What changes:** the AI steps that word patterns, recommend decks, review them, write A/B tests and advise per country get a small, relevant slice of a **knowledge base (KB)**: store facts, evidence-backed rules of thumb, market notes, genre notes, published A/B test cases and a glossary. Today they know only the competitor data and one voice paragraph, so every recommendation is "follow the majority", with no "why", no market knowledge when the sample is small, and no sense of what tends to win in tests.
- **Data first (user rule), but honest about what data shows.** Competitor data shows what is *common*, not what *converts*. The competitor data still decides the recommended deck; the KB explains why, shapes specs, fills gaps where data is thin, and where outcome evidence disagrees with a convention, the conflict becomes a high-priority A/B test with both sides shown. Our own valid test results outrank both.
- **Trust is counted, not asserted (user rule).** Each entry is **one atomic claim** with all its sources. Independence is decided by a reviewed "evidence origin" per source (same study, same dataset, same funder count once; unknown provenance counts once), and code counts origins to set the level: **unverified** (1), **corroborated** (2+), **established** (3+ incl. an official document or independent data). Only corroborated and above may be stated as fact or back a recommendation; unverified may only inspire a labelled test idea. No exceptions by default (an optional exception for official store specs is a decision for you, 15.1).
- **The model picks, code writes the "why".** The model cites short handles; the visible "why" line, source names, dates and trust badges are rendered by code from the approved entry, so the KB's wording and numbers cannot be distorted. Structural rules are checked by code; meaning ("does this claim follow from that entry") is checked by the cross-family reviewer, and its error rate is measured, not assumed.
- **Retrieval is by code, balanced by facet, within a fixed budget.** Each step asks for specific facets (store constraints, applicable heuristics, counter-claims, market notes, regulation) using tags from its computed facts; every entry travels with its linked counter-claims. Retrieval recall is tested on a hand-labelled set before any prompt uses it.
- **Stored as reviewed, versioned releases in the repo (`kb/`)**; every report pins an immutable copy of the release it used, so old reports can be rebuilt. New entries and our own results live in the project data until promoted by review and approval.
- **Proven before it is trusted:** a blind comparison, with and without the KB, on the saved Rogue Legend reports plus crafted hard cases (conflicts, thin data), judged by you and by gpt-5.6-sol with measurable gates. Ships behind a Settings switch only if it passes.
- **Cost:** per report, the KB adds about 10k (Pilot) to 45k (five-country comparison) input tokens across its calls (section 11 has the call graph); the tool prices it from token counts at current prices and shows it in the approval, with a hard cap per report.
- **Decisions for you:** section 15.

## 1. What the expert lacks today

| Step | What it knows now | What goes wrong |
|---|---|---|
| Pattern wording | computed patterns, voice | Says what is common, never why it matters or whether a common habit is a good one |
| Recommendations | patterns, readings, taxonomy, voice | Specs are "follow the majority"; no rules for legibility, caption length per script, what the store shows first, store limits and text rules in images |
| Review | same inputs | Checks completeness, not whether a spec is sound practice or allowed by the store |
| A/B tests | computed gaps | No sense of which variables usually move conversion, of effect sizes, of test duration and traffic, or of experiment rules beyond a few constants |
| Country advice | facts per country, words used | With 8 competitors per country, market conventions (script, text density, events, regulation) are invisible unless competitors happen to show them |
| Cross-country groups | group evidence | Cannot explain a group difference |

## 2. Content model

### 2.1 Entry kinds

| Kind | What it holds |
|---|---|
| `store_fact` | How a store works: specs, what shows where, experiment and custom listing rules, metrics, policies (e.g. Google Play's limits on text in graphics and on ranking claims) |
| `heuristic` | An evidence-backed rule of thumb about store images |
| `market_note` | One country: culture, script and typography, orientation habits, text density, social proof, events, regulation, store share |
| `genre_note` | Roguelike, RPG, idle, casual, survivor-like conventions |
| `ab_case` | One published test: app, store, market, control vs variant, metric, result, duration, who reported it. Always "one case" |
| `glossary` | A term, its plain definition, where it is used |
| `own_result` | Our own test result (section 9). Lives in the project data, never in `kb/` directly |

### 2.2 Entry fields

- `id` (stable; never shown to the user), `kind`.
- `claim`: **one atomic proposition** in one plain sentence. Compound claims are rejected at review and split.
- `facts`: optional structured numbers, each `{ value, unit, of, context }` (e.g. 20, "% of image area", "text overlay", "Play screenshot policy"). The only numbers the report may repeat from the KB, rendered by code.
- `appliesWhen`: the condition under which the claim holds.
- `scope`: `store`, `genre`, `market` (global, or **an explicit country list**; a region name is only a label, and a country is covered only when the entry's evidence covers it), `position` (1, 1-3, all, feature_graphic, video, icon, search_result), `asset`.
- `tags`: from the fixed, versioned tag list (`kb/tags.json`).
- `support`: one record per source that supports **this exact claim and scope**: source id, a short excerpt or structured observation (within quotation limits), whether the page was fetched and read in full (a search snippet does not count), and who checked it.
- `contradicts`: ids of counter-claim entries (counter-evidence is itself an atomic entry with its own sources and trust).
- `validFor`: for store facts and A/B cases, the period and store version the claim is known to hold for (e.g. "Play Console, checked 2026-09"; a 2021 case "Play store layout before 2023").
- Computed by code, never typed: `origins` (independent evidence origins), `trust`, `vendorOnly`, `contested`, `stale`.
- `reviewBy`, `addedBy` (agent model and prompt version, or person), `approvedBy`, `approvedOn`.

### 2.3 Source registry and independence

`kb/sources.json`, one record per source: title, publisher, URL, type (official, independent_data, vendor, vendor_case_study, press, talk, community), published date or "unknown", accessed date, archived metadata (title, date, a hash of the fetched text), and the **provenance fields, set at review, never guessed by code**: `evidenceOrigin` (the study, dataset or experiment the numbers come from), `commissionedBy` / `fundedBy`, `parentOrg`, `independenceReviewedBy`.

- **Code counts, reviewers decide.** Code counts distinct `evidenceOrigin` values among a claim's support records; it never infers independence from URLs.
- **Conservative defaults:** unknown provenance, the same parent organisation, a commissioned study and its sponsor, or a vendor's case study of its own customer all count as **one** origin.
- A source added without a reviewed origin counts as its own origin only after a reviewer sets it; until then the claim stays at its previous level.

### 2.4 Trust levels (user rule; computed by code)

| Level | Rule | What the agent may do |
|---|---|---|
| **Unverified** | 1 independent origin | Only a labelled test idea or question ("unverified: one source"). Never a recommendation, never a stated fact |
| **Corroborated** | 2+ independent origins supporting the same claim | May be stated as fact with its sources; may support a recommendation together with the data |
| **Established** | 3+ independent origins, at least one official document or independent data | As corroborated; may also guide a spec where our data says nothing |

- **Official documents** count as one origin like any source. By default a single current Google or Apple page is **unverified**; the report may still quote it as an attributed statement ("Google Play's help page says …, checked 2026-09"), never as an unattributed fact or as the basis of a recommendation. Whether to allow an exception for store specs and policies is decision 15.1.
- **Vendor only:** when every origin is a vendor, the entry cannot reach established and shows "industry sources only".
- **Contested:** when a linked counter-claim is corroborated or established, both entries are contested: usable only as a test idea, with both sides shown.
- **Freshness is separate from trust.** Past `reviewBy`, an entry is `stale`: its trust level stays, but a stale store fact or regulation is never stated as current (it becomes "check in Play Console"), and a stale heuristic says "last checked <date>". A/B cases are historical: they may illustrate an effect, never establish current store mechanics.

### 2.5 Default review dates

Store facts and regulations 6 months; heuristics and market notes 12 months; glossary 24 months; A/B cases carry `validFor` instead.

## 3. Where the KB is used, step by step

Per-image analysis (full analysis, text-layer comparison, settling) is **not** changed: no KB in vision calls, so no analysis key changes and no image is re-analysed. Only text-only synthesis steps get KB, each through a new prompt version, behind a Settings switch.

| Step (new prompt) | Facets retrieved | Budget (tokens) | What the model does with it | New output fields |
|---|---|---|---|---|
| Pattern wording (`patterns.v6`) | heuristics and genre notes for the key points' dimensions; linked counter-claims | 1.5k | Picks, per key point, the entry that explains why it matters (or none) | `kbRefs` per key point |
| Recommendations (`recommend.v6`) | store constraints (specs, text rules, first images shown); heuristics by position and gap dimension; main-country script and typography; genre notes; counter-claims | 4k | Shapes each position's spec within store rules; picks the "why"; where outcome evidence disagrees with a convention, keeps the data-led choice and raises a test idea | `kbRefs` per position; `conflicts[]` (data fact ids, KB handles, which side the deck follows) |
| Recommendation review (`recommend-review.v5`, GPT) | **everything the recommendation call received**, plus the selection log | same + 1k | Checks each cited entry supports the statement it is attached to, that no eligible counter-claim or store rule was ignored, and that no convention was presented as proven effective | new finding types |
| A/B tests (`ab-tests.v3`) | experiment facts for the store; `ab_case` and heuristics for each candidate's variable and market; counter-claims | 3k | Sharper hypotheses and expected-impact reasons; may choose **one** KB-led test (4.5) | `kbRefs` per test |
| Country advice (`country-advice.v2`) and review (`country-advice-review.v2`) | that country's market notes (script, text density, events, social proof, regulation, store share); glossary terms; counter-claims | 3k per country (regulation within a reserved 0.8k) | Local rules the competitors cannot show: Thai and Vietnamese line height and font support, full-width punctuation, zh-TW vs zh-HK wording, what must not appear, seasonal timing | `kbRefs` per action and deck image |
| Cross-country groups (plan-cross-country C3) | market notes for the group's countries on the finding's dimension | 2k | Picks an entry that explains a "different in this group" finding, or none; never creates a finding | `kbRefs` per group finding |

## 4. How the agent uses the KB

### 4.1 Selection (code, deterministic, explainable)

1. **Eligibility:** store matches; the entry's countries include the step's country (or it is global); genre is all_games or one of the project's genres; approved; not retired.
2. **Facets:** each step declares the facets it needs (table above). The versioned map `kb/dimension-tags.json` turns each computed dimension, gap kind and fact kind into tags per facet (e.g. landscape → orientation, composition; logo in positions 1 to 3 → logo, branding, first_images; event line → events, offers; words used → localisation, lingo, typography).
3. **Ranking within a facet (additive):** tag match + trust (established 3, corroborated 2, unverified 1) + specificity (country 1, genre 1) − stale 1. An entry must match at least one query tag.
4. **Balanced fill:** each facet has a minimum and maximum share of the budget, so a flood of narrow market notes cannot push out an established store rule, and vice versa. Unverified entries at most a third, in a separate "Unverified ideas" block.
5. **Counter-claims travel together:** a selected entry always brings its linked counter-claims.
6. **Mandatory material** (regulations for the step's countries, the store rules the checks rely on) uses a reserved allocation; if it does not fit, the call is not made and the approval shows why ("Japan's regulation notes exceed the reserved space: raise the budget preset or review the entries"). Nothing is dropped silently.
7. **Saved with the call:** entry ids, KB release, scores and what was left out; shown in the report's "How we built this" note.
8. **Recall test before use (K2 gate):** a hand-labelled set of about 30 step contexts from the saved reports, each with the entries a careful expert would want; retrieval must find at least 80 % of the "must have" entries (the gate is set in Settings and reported). Embeddings are added as a re-ranker only if tags fail this test.

### 4.2 Prompt placement and caching

- Each synthesis prompt gains one shared block, `prompts/analysis/kb-rules.v1.md` (as `{{KB_RULES}}`): data first, the trust levels and what each allows, the conflict rule, how to cite.
- **System prompt (stable):** instructions, voice, KB rules, and the step's **core pack**: the mandatory store rules and the global and genre entries that are the same for every call of that step in the report.
- **User message, most stable first:** the per-report slice, then the per-call slice (one country's notes), then the computed data.
- **Entry rendering:** a handle for this call (K1, K2 …, mapped by code), trust label, the full claim, `appliesWhen`, `facts`, scope, "n independent origins, latest <year>". Claims are short by schema, so nothing is truncated. No URLs.
- **Answer cache key** adds the KB release id and the hash of the selected entries; a new release shows as "AI parts out of date" through the existing mechanism.
- With one or a few calls per step, prompt caching saves little; budgets and the answer cache keep cost down.

### 4.3 Weighing the KB against the competitor data

Each output item records its basis: `dataFactIds` (computed facts), `kbRefs`, and for conflicts both. Evidence states, using the thresholds already versioned in Settings (plan-cross-country 3.4: at least 5 games with a known value; the pattern strength rules):

| Our data | KB | What happens |
|---|---|---|
| Our own valid test for this market and variable | any | Our result decides; the KB may explain it |
| Clear pattern (strong / "clear") | agrees | Follow the data; one "why" line from the KB |
| Clear pattern | corroborated+ disagrees | Follow the data (user rule), say the pattern is a convention, not proof; the conflict becomes a test candidate with priority raised by the KB's trust |
| Thin or no data (below the thresholds, or not measurable) | corroborated+ | The KB may guide the spec, labelled "from general evidence, not from your competitors" |
| any | unverified or contested | Test idea only |

### 4.4 What code checks and what the reviewer checks

**Code (structural, reliable):**
- every `kbRefs` handle was provided in this call;
- items in recommendations, key points and country actions cite only corroborated or established, non-contested entries; otherwise the **whole item** is regenerated once with the problem listed, then dropped with "left out" (never only its citation);
- unverified or contested handles appear only in test ideas and A/B hypotheses;
- a conflict record exists whenever a cited entry is linked (by the entry's `contradictsConvention` tags) to a dimension where the data shows a clear pattern the other way;
- the "why" line, KB numbers (`facts`), source names, dates, links and badges are **rendered by code** from the entry, never written by the model;
- unexpected numbers in model text (not in the computed data or the cited entries' `facts`) raise a **warning** for the reviewer, not a hard failure.

**Reviewer (semantic, measured):** citation supports the statement; no convention sold as proven; no omitted counter-claim or store rule; right market and script. In evaluation (section 10) a human checks a sample of the reviewer's calls to measure its miss rate.

### 4.5 KB-led A/B tests

- Code adds **KB candidates** next to the gap candidates: a corroborated or established heuristic our deck breaks where data is thin, and every conflict from 4.3. Each has its evidence id, variable and positions; a KB-only candidate ranks below an equal data gap, a conflict candidate above.
- At most **one** test per report rests on a KB candidate alone, labelled "Idea from general evidence, not from your competitors".
- Existing test checks all apply; a KB candidate covers a country only when the entry's evidence covers that country.

### 4.6 In the report

- **"Why" line** under a recommendation, key point, country action or test: the entry's approved claim and badge ("Established: 3 independent sources, latest 2025"). Folded when there are more than two.
- **Worth testing:** each conflict with the data counts on one side and the KB sources on the other.
- **Sources list** at the end: each cited entry, its level, its sources (publisher, date, link); unverified ones separate.
- **"How we sort images"** gains "How we use general evidence": data first, the three levels, what "unverified" means, and that competitor habits show what is common, not what converts.
- Plain names only; no ids or tag codes in any text the user reads.

## 5. New things to measure (suggested by the KB)

**Not part of the first KB release or its evaluation**; each is a separate task with defined inputs, a small gold-labelled set, a precision target and an explicit "unknown" result. A detector enters the main dimensions only after it passes, and the KB evaluation is re-run when one changes the recommendation inputs.

| Detector | Measures | Input | Main risk |
|---|---|---|---|
| Images shown first (proxy) | Which images come first in the gallery given orientation and whether a video leads; a proxy, not the real visible area on every phone | store order, pixel sizes, store facts | layout differs by device and store version |
| Video and feature graphic | presence per game and country | store data | none major |
| Text area share | marketing text area vs image area (Play limits text overlays) | text boxes from the analysis or layout capture | box accuracy |
| Caption length per script | characters per caption (CJK and Thai as characters) | extracted text | none major |
| Ranking and award claims, download counts | "No.1", "1位", "#1", awards, "萬" downloads | extracted text, per-language lists | recall across languages; advisory only |
| Offer depth | "100 free pulls", "10連", gift codes | extracted text (event lines are already tagged) | wording variety |
| Store-policy flags | text the store's policy restricts in graphics; **advisory, "please check"**, versioned per policy | the above + store facts | never a legal verdict |
| Deck length vs store limit | used slots vs maximum | store data | none |
| Local script on images | text in the local script, English or mixed | extracted text | mixed scripts |
| Brightness, contrast, saturation | per image and position | pixels | information only |
| Character prominence | share of image a character takes | layout capture | needs layout step |

## 6. Storage, releases and ownership

```
kb/                          read-only releases, in the repo, reviewed like code
  release.json               release id, date, counts per level, changelog
  tags.json  sources.json  dimension-tags.json
  entries/  store-google-play.json, store-app-store.json, glossary.json,
            heuristics-images.json, genre-notes.json, ab-cases.json,
            market-jp.json, market-kr.json, market-tw.json, market-hk.json, market-th.json,
            market-vn.json, market-id.json, market-ph.json, market-us.json
workspace/kb/                project data, written by the tool (never in the repo)
  inbox/                     researched candidates awaiting review
  own-results/<project>/     our test results
  snapshots/<release hash>/  immutable copy of every release a report used
```

- JSON validated by Zod (`src/kb/`); code files under 300 lines; entry files under about 60 entries, split by topic when larger.
- **A report pins a release by content hash** and the tool stores an immutable snapshot of it in the shared library (like rendered prompts today), with the retrieval map, KB-rules prompt and renderer versions. An old report is rebuilt from its snapshot, not from the current files.
- **Ownership:** the tool only reads `kb/`. A new release is produced by a promotion step (a script run from Claude Code) that moves approved inbox entries into `kb/`, recomputes trust, writes `release.json` and shows how many saved reports it would mark "Knowledge updated"; it is committed like code.
- Game-agnostic and shared by all projects. A project's config gains `genres` (Rogue Legend: roguelike, rpg, idle), set in Settings.
- All access through `src/storage` (web-readiness rule).

## 7. How the KB is built and updated

1. **Collect** (research agent with web search, Asia first, local-language searches): candidate entries into the inbox; each support record with a short excerpt or structured observation, fetch date and text hash; pages that could not be read are recorded as such and do not count. Never invent numbers, sources or URLs.
2. **Corroborate** (a second agent that fetches every source itself, not trusting the first agent's notes): for each candidate that could affect a recommendation, look for a second independent origin and for counter-claims; trace copied statistics to their origin.
3. **Provenance review:** set `evidenceOrigin` and funding for each source (agent proposes, reviewer confirms); unknown stays conservative.
4. **Compute** (code): origins, trust, vendor-only, contested, stale; schema and link checks.
5. **Check** (gpt-5.6-sol, cross-family): per claim, with the excerpts: does each support record say this exact claim at this scope, do the numbers match, is it atomic, is anything overstated. The model and prompt version are recorded.
6. **Approve** (you): new and changed claims that could drive a recommendation (corroborated and above, regulations, store rules) need your approval; unverified entries can be approved in bulk. Until the Knowledge page exists, the tool shows a generated review list with approve and reject buttons (autosaved; no file handling).
7. **Promote and release** (section 6).
8. **Refresh:** "Check the knowledge base" is a user-triggered action (never in the background) that lists stale entries and dead links and runs steps 1 to 7 for them within an approved budget.

## 8. Settings

- KB on or off per AI step (off until evaluation passes).
- Budget **presets** (small, normal, large), tested in evaluation, instead of free token numbers, plus a hard cost cap per report. The approval says when mandatory material did not fit.
- The lowest level allowed as fact is fixed at corroborated (user rule): shown, not editable.
- KB-led tests: at most one per report (default) or none.

## 9. Learning from our own results

1. **Record result** on each A/B test card: store and listing, countries or languages, start and end dates, audience share, variants, installs per arm as Play Console shows them, the reported range and whether Play marked it conclusive, whether other changes ran at the same time, and a note. Autosaved in the project.
2. **Classified by code** with store-specific rules: **valid** (ran to Play's result, no overlapping change, conclusive), **inconclusive** (ran, no clear winner) or **invalid** (stopped early, overlapping change, too short). Only valid results become clear local evidence (4.3) for that game, market and variable.
3. **Generalising is never automatic:** a valid result can be proposed as a support record for a KB claim (or its counter-claim); it goes through the inbox, provenance review and approval like any source.
4. **Report feedback:** per-item ratings that mark a "why" line unhelpful flag its entry for review.
5. With few tests a year, the tool lists results; it never claims a win rate.

## 10. Evaluation (before the KB goes live)

- **Set:** (a) the saved Rogue Legend reports: Pilot and Full check (United States), the comparison of Japan, South Korea, Taiwan, Hong Kong and Thailand, and its per-country reports; (b) about 6 crafted hard cases: a KB-vs-clear-data conflict, thin data, a stale store fact, a contested claim, a regulation-heavy country, a script-heavy country (Thai). **Held out:** the next real comparison (e.g. Vietnam, Indonesia, Philippines), used only for the second run.
- **Method:** each enabled step is generated twice from the same frozen inputs, with and without the KB. Outputs are rendered without any sign of which arm is which ("why" lines and Sources are stripped from both, then shown as a separate appendix per arm for the claim check), in random order per step.
- **Judges:** you (primary) and gpt-5.6-sol, both blind, both given the same data packet and **no** KB material. Rubric per step, 1 to 5: meaningful; to the point; actionable; insightful; each claim tied to evidence; correct about the stores; right for the market; A/B tests sound. Plus an overall preference. Ties are allowed. Agreement between you and GPT is reported.
- **Claim check:** you (or a person you name) check a sample of 20 KB-backed claims against their sources; this also measures the reviewer's miss rate (4.4).
- **Gates:** you prefer the KB arm, or tie, on every step, and prefer it on at least half; no step scores lower on "correct about the stores" or "tied to evidence"; unsupported claims in the sample at most 1 of 20 and no critical error (a wrong store rule or regulation stated as fact); unverified-as-fact violations 0 (code); retrieval recall gate met; length at most 20 % longer; cost within the estimate. If it fails, revise once and re-run on the held-out comparison only.
- **Cost:** computed from the call graph (section 11) for every duplicated generation plus the judging calls, shown in one approval before it runs.

## 11. Cost (call graph)

KB input tokens added per report type, at the "normal" preset (the tool prices these at the current model prices; the approval shows the money):

| Report | KB-bearing calls | Added KB input tokens |
|---|---|---|
| Pilot / Full check | pattern wording, recommendations, recommendation review, A/B tests (+ 1 repair) | about 10k to 15k |
| One country | + country advice and its review | about 16k to 21k |
| Compare 5 countries | recommendations, review, A/B tests, 5 × (advice + review), group | about 38k to 45k |

Output grows only by the handles and conflict records (small). Evaluation: about 3 reports × 2 arms of synthesis, plus crafted cases and GPT judging; priced by the tool before approval. KB research and refresh: agent time plus the GPT check, each under its own approved budget.

## 12. What has been collected so far (paused)

Seed files from the paused research are in the session scratchpad (`kb/seed/`, format in `kb/seed/_SCHEMA.md.txt`, an earlier, simpler version of section 2). They are **not** part of the KB: they use the older entry-level trust (and some store facts are marked "established" on one official page, which this plan does not allow by default), so after approval they enter the inbox and go through steps 2 to 7. File list and counts are in the handover report.

## 13. Milestones

| # | What | AI cost |
|---|---|---|
| K0 | Schema, source registry with provenance, trust computed by code, tag list and dimension map, loader, validator, snapshotting, the generated review list with approve/reject; import of the seed files into the inbox | $0 |
| K1 | Research, corroboration and provenance review (Asia and Google Play first); GPT check; your approval; first release | agent time + GPT check (approved budget) |
| K2 | Retrieval with the recall test; prompts and checks for recommendations, their review and A/B tests; "why" lines, "Worth testing" and Sources in the report; Record result on A/B cards (minimal) | per-report tokens |
| K3 | Country advice, its review, pattern wording, cross-country groups | per-report tokens |
| K4 | Evaluation; go or no-go | priced before approval |
| K5 | Detectors, each with its own validation (section 5) | $0 mostly |
| K6 | Own results into the KB, the Knowledge page (browse, filter, approve) | $0 |
| K7 | "Check the knowledge base" refresh action | refresh budget |

## 14. Risks

| Risk | Guard |
|---|---|
| Outdated store facts | `reviewBy` and `validFor`; stale facts never stated as current; refresh action |
| Wrong advice from weak or copied sources | Atomic claims; reviewed provenance; conservative counting; unverified never recommends; GPT check; your approval |
| Generic advice | Entries need `appliesWhen` and scope; "insightful" in the rubric; one "why" line per item at most; none when the data says it all |
| KB drowns the data | Data-first table (4.3); code checks; conflicts shown, not resolved silently |
| Convention mistaken for effectiveness | Reports say competitor habits show what is common; conflicts become tests |
| Vendor bias | Vendor-only entries capped below established; badge |
| Misleading or manipulated source text | Second agent re-fetches; excerpts hashed; human approval for claims that drive recommendations |
| Link rot | Archived metadata and hashes; refresh lists dead links |
| Copyright | Short excerpts or paraphrased observations only; links, not copies |
| Wrong locale or script (zh-TW vs zh-HK, Thai) | Country lists on entries; script-heavy crafted cases in evaluation |
| Regulation stated as legal advice | Worded as "check", with the source; never a legal verdict |
| Source merge errors | Merge changes shown in the review list; provenance reviewed |
| A release invalidates many reports' AI parts | The promotion step shows how many saved reports it marks "Knowledge updated"; regenerating is always user-triggered |
| Token cost | Presets, hard cap per report, answer cache, cost in the approval |
| Western bias in sources | Asia-first research and local-language searches; thin markets reported as thin, not filled with global rules |

## 15. Decisions for you

1. **Official store pages:** keep the strict rule (a single Google or Apple page is "unverified", quoted only as "Google's page says …"), or allow an exception so one current official page counts as established **for the store's own specs and policies only** (not for advice on what converts). Recommended: allow the exception; Google and Apple are the only primary source for their own rules, and many rules (screenshot sizes, text limits) have no second source that is not copied from them.
2. **Data first vs outcome evidence:** keep "the data decides the deck, conflicts become tests" (recommended, as your rule says), or let a corroborated outcome finding change the deck when the data is only a convention.
3. **KB-led A/B tests:** at most one per report, labelled (recommended), or none.
4. **Approval load:** you approve every claim that can drive a recommendation (recommended) and unverified entries in bulk, or you approve everything one by one.
5. **Research order after approval:** Asia markets and Google Play first, App Store facts and cases second (recommended), or both at once.
6. **Cost cap per report** for the KB part (default: the approval shows it; a hard cap you set in Settings).
7. **Genres for Rogue Legend:** roguelike, rpg, idle (proposed); add casual or survivor-like?
8. **Knowledge page (K6):** build it, or keep the generated review list.

## Review outcome

One review by gpt-5.6-sol on the finished draft (2026-09-29), verdict **"rework"** (19 major, 9 minor findings). Full text: `docs/reviews/plan-knowledge-base-review-gpt.md`. Processed by Claude (Opus 5.5); no second review, per your instruction.

**Applied:**
- The official-page exception no longer overrides your rule by default; it is now decision 15.1 (2.4).
- Independence comes from reviewed provenance (evidence origin, funder, parent), with conservative counting; code only counts (2.3).
- One atomic claim per entry; support records tied to that exact claim; counter-evidence is its own entry, linked (2.2, 2.4).
- Code checks cut back to what code can check reliably; meaning is left to the reviewer, whose miss rate is measured; a failed item is regenerated or dropped whole; the "why" text and KB numbers are rendered by code (4.4).
- The number rule became a warning; KB numbers live in structured `facts` (2.2, 4.4).
- The reviewer gets everything the writer got plus the selection log (3).
- Retrieval by facet with minimum and maximum shares, additive ranking, counter-claims travelling together, a recall test before use (4.1).
- Regulation gets a reserved allocation; if mandatory material does not fit, the call is blocked with the reason; regions no longer imply countries (4.1, 2.2).
- "Data first" kept (your rule) but reports now say competitor habits show what is common, not what converts; conflicts become higher-priority tests; our own valid tests outrank both (0, 4.3).
- Thresholds reference the existing versioned ones in Settings (4.3).
- Own results: full design and outcome recorded, classified valid / inconclusive / invalid; generalising only through review (9).
- Detectors separated from the first release, each with validation and "unknown" results; "first impression" renamed to a proxy (5).
- Immutable KB snapshots per report; read-only releases in the repo, inbox and own results in project data, promotion step (6).
- Research protocol: second agent re-fetches, excerpts hashed, model and prompt recorded (7).
- Evaluation made blind (no KB material to judges, "why" lines stripped), crafted hard cases, held-out set, a human claim check, measurable gates (10).
- A call graph with token ranges per report type and a hard cap (11).
- Freshness separated from trust; A/B cases get `validFor` (2.4, 2.5).
- Budget presets instead of free numbers; mandatory overflow shown (8).
- Minimal review list and Record result moved earlier (K0, K2) (13).
- Missing risks added (14); decisions extended (15).

**Declined or partly declined:**
- "Clear local prevalence should not automatically decide the recommendation": declined as a default, because your rule is data first and the KB never overrules clear local evidence. Offered as decision 15.2 instead.
- "Remove the official exception" fully: kept as your choice (15.1) with a recommendation, because store specs and policies have only one primary source.
- "Include representative cases for all nine markets": partly. Evaluation covers the six countries with saved data plus crafted script and regulation cases; the other markets are covered by the held-out comparison when their data exists. Creating data for all nine only for evaluation would cost more than the benefit.
- "Generate all visible prose from structured fields": partly. Only the "why" line, the KB numbers and the source labels are rendered by code; the recommendation wording stays with the model, as it is today.

import { buildAnalysisPlan, type Stage } from "../analysis/plan.ts";
import { type LoadedConfig, projectPaths } from "../config/load.ts";
import type { ProjectSettings } from "../config/project-schema.ts";
import { fitFor } from "../core/selection.ts";
import { readJournal } from "../jobs/journal.ts";
import { analysisStatus } from "../jobs/status.ts";
import { presetOutcome } from "../reports/ready.ts";
import { type SuggestionsView, suggestionsView } from "../reports/suggest.ts";
import { workspaceStorage } from "../storage/index.ts";
import { latestRun } from "../view/model.ts";

/** Stages of a project, derived from what is on disk (plan 5.1); never stored as the truth. */
export type ProjectStage =
  | "setup"
  | "preview"
  | "pick"
  | "pilot"
  | "core"
  | "recommendations"
  | "expand";

export const STAGE_LABEL: Record<ProjectStage, string> = {
  setup: "Setting up",
  preview: "Ready to download",
  pick: "Pick competitors",
  pilot: "Pilot",
  core: "Core check",
  recommendations: "Recommendations ready",
  expand: "Expansions",
};

export type Substate = "ready" | "running" | "stopped" | "failed" | null;

export interface ProjectState {
  stage: ProjectStage;
  substate: Substate;
  /** One plain line for the home card ("Pilot ready: 17 images to analyse"). */
  line: string;
  /** Progress of the current step, e.g. analysed images of the batch. */
  progress: { done: number; total: number; label: string } | null;
  /** The next step, as a button label, and where it opens. */
  next: { label: string; href: string };
  notices: string[];
  /** Step bar: each step done, current or still to come. */
  steps: { label: string; state: "done" | "current" | "todo" }[];
  /** The home card's "Next" line: the top suggested research (only when asked for). */
  suggestion?: { text: string; href: string } | null;
}

const STEPS: { key: ProjectStage[]; label: string }[] = [
  { key: ["setup"], label: "Settings" },
  { key: ["preview"], label: "Download" },
  { key: ["pick"], label: "Pick competitors" },
  { key: ["pilot"], label: "Pilot" },
  { key: ["core"], label: "Core check" },
  { key: ["recommendations", "expand"], label: "Recommendations" },
];

/** With complete, the current step is done too (a Full check report with recommendations). */
function steps(stage: ProjectStage, complete = false): ProjectState["steps"] {
  const at = STEPS.findIndex((s) => s.key.includes(stage));
  return STEPS.map((s, i) => ({
    label: s.label,
    state: i < at || (i === at && complete) ? "done" : i === at ? "current" : "todo",
  }));
}

const SETUP_STEPS = ["Your game", "Competitors", "Countries", "Charts", "Review and create"];

/**
 * The state of a project still in its new-project steps, or with no competitor yet (it cannot be
 * loaded as a config). It reopens on the step where the user stopped.
 */
export function draftState(id: string, s?: ProjectSettings): ProjectState {
  const step = s?.setupStep;
  const line = step
    ? `Setting up: step ${step} of 5, ${SETUP_STEPS[step - 1]?.toLowerCase()}`
    : "Setting up: add at least one competitor";
  return {
    stage: "setup",
    substate: null,
    line,
    progress: null,
    next: { label: "Continue setting up", href: `/p/${id}/setup` },
    notices: [],
    steps: steps("setup"),
  };
}

/**
 * The project's state from its files: download, pick, batches and reports, plus the job journal
 * for a running or stopped analysis. Costs a plan build per stage (milliseconds to a second).
 */
export function projectState(
  loaded: LoadedConfig,
  names: (id: string) => string = (x) => x,
  o: { suggestion?: boolean } = {},
): ProjectState {
  const paths = projectPaths(loaded);
  const id = paths.projectId;
  const gallery = (hash: string) => `/p/${id}/views/gallery.html#${hash}`;
  const notices: string[] = [];
  const job = analysisStatus(loaded, names);
  if (job.otherAi) notices.push(job.otherAi);
  const base = (stage: ProjectStage, line: string, next: ProjectState["next"]): ProjectState => ({
    stage,
    substate: null,
    line,
    progress: null,
    next,
    notices,
    steps: steps(stage),
  });
  if (!latestRun(paths.runs)) {
    const preview = workspaceStorage(paths.workspace).exists(
      `projects/${id}/pending/download-plan.json`,
    );
    return preview
      ? base("preview", "Ready to download", { label: "Open", href: `/p/${id}/` })
      : // Settings are done (the project loads); the download preview is the step now.
        {
          ...base("setup", "Nothing downloaded yet", {
            label: "Next: download preview",
            href: `/p/${id}/`,
          }),
          steps: steps("preview"),
        };
  }
  const view = fitFor(loaded);
  if (view.fit.selected.length < loaded.config.core.pilotCompetitors)
    return base("pick", `Pick competitors: ${view.fit.message || "the pick does not fit yet"}`, {
      label: "Pick competitors",
      href: gallery("competitors"),
    });
  // Derived from the saved reports: a stage with a Ready report (recommendations written) is done,
  // and a Full check report also completes the Pilot. Newer data is the report's badge, not a step back.
  const core = presetOutcome(loaded, "core");
  const pilotReady = presetOutcome(loaded, "pilot").ready;
  for (const stage of ["pilot", "core"] as Stage[]) {
    const runningHere = job.running && job.stage === stage;
    if (!runningHere && (core.ready || (stage === "pilot" && pilotReady))) continue;
    if (stage === "core" && !view.fit.ok)
      return base("pick", `Pilot done. Pick competitors for the core check: ${view.fit.message}`, {
        label: "Pick competitors",
        href: gallery("competitors"),
      });
    const plan = buildAnalysisPlan(loaded, stage);
    if (!plan.synthesisNeeded) continue;
    const total = plan.items.length;
    const done = plan.counts.identical;
    const name = stage === "pilot" ? "Pilot" : "Core check";
    const mine = job.stage === stage ? job : null;
    const substate: Substate = mine?.running
      ? "running"
      : mine && (mine.state === "stopped" || mine.state === "failed") && mine.continuable
        ? mine.state
        : "ready";
    const p = mine?.progress;
    const line =
      substate === "running" && p
        ? `${name}: analysing image ${Math.min(p.done + 1, p.total)} of ${p.total} ($${p.spentUsd.toFixed(2)} so far)`
        : substate === "stopped" || substate === "failed"
          ? `${name} stopped: ${plan.counts.full} images left`
          : plan.counts.newImages
            ? `${name} ready: ${plan.counts.newImages} images to analyse`
            : `${name} ready: all images analysed, the report is still to write`;
    return {
      ...base(stage, line, {
        label:
          substate === "stopped" || substate === "failed"
            ? "Continue"
            : substate === "running"
              ? "Follow the run"
              : `Run the ${stage === "pilot" ? "pilot" : "core check"}`,
        href: gallery("analysis"),
      }),
      substate,
      progress: { done, total, label: `${done} of ${total} ${stage} images analysed` },
    };
  }
  // After any interrupted job (it returned above): the top suggested research, code only.
  const suggestion = o.suggestion ? topSuggestion(loaded, gallery("report")) : undefined;
  const increments = readJournal(workspaceStorage(paths.workspace), paths).increments;
  if (increments.length)
    return {
      ...base("expand", "Expansion chosen: it is a draft report in the Report tab", {
        label: "Open the reports",
        href: gallery("report"),
      }),
      steps: steps("expand", core.ready),
      ...(suggestion === undefined ? {} : { suggestion }),
    };
  const pct = core.score === null ? "" : ` (${Math.round(core.score * 100)}%)`;
  return {
    ...base(
      "recommendations",
      core.ready
        ? `Full check done${core.verdict ? `: ${core.verdict}${pct}` : ""}`
        : "Core check reported. Next: choose how to expand",
      { label: core.ready ? "Create a report" : "Open the report", href: gallery("report") },
    ),
    steps: steps("recommendations", core.ready),
    ...(suggestion === undefined ? {} : { suggestion }),
  };
}

function topSuggestion(loaded: LoadedConfig, href: string): ProjectState["suggestion"] {
  try {
    return topOf(suggestionsView(loaded), href);
  } catch {
    return null;
  }
}

/** The home card's "Next" line from computed suggestions (the first that is not "same"). */
export function topOf(view: SuggestionsView, href: string): ProjectState["suggestion"] {
  const top = view.suggestions.find((s) => s.category !== "same");
  return top ? { text: `${top.title} (${top.costText}): ${top.why}`, href } : null;
}

/** Stages whose home card shows the top suggested research. */
export const SUGGESTION_STAGES: readonly ProjectStage[] = ["recommendations", "expand"];

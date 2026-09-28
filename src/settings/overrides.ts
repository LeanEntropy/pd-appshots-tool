import { settingsToRawConfig } from "../config/project.ts";
import {
  type ProjectSettings,
  ProjectSettingsSchema,
  type ToolDefaults,
} from "../config/project-schema.ts";
import { type Config, ConfigSchema } from "../config/schema.ts";
import { stableStringify } from "../util/hash.ts";
import { type FieldDef, fieldsFor, fieldValue } from "./fields.ts";

/**
 * Reading, checking and changing the Settings page's values (plan-reports 5B). They live in
 * project.json under `overrides` (only values that differ from the tool defaults); every change
 * is checked with the project settings schema and the config's cross-field rules before it is
 * saved, and a refused change keeps the old value and says why in plain words.
 */
export type Overrides = NonNullable<ProjectSettings["overrides"]>;
type Tree = Record<string, unknown>;

const isTree = (v: unknown): v is Tree => typeof v === "object" && v !== null && !Array.isArray(v);

function setPath(t: Tree, path: string[], v: unknown): void {
  let cur = t;
  for (const k of path.slice(0, -1)) {
    if (!isTree(cur[k])) cur[k] = {};
    cur = cur[k] as Tree;
  }
  const last = path.at(-1);
  if (last) cur[last] = v;
}

/** Removes a value and any section it leaves empty. */
function deletePath(t: Tree, path: string[]): void {
  const [k, ...rest] = path;
  if (!k || !(k in t)) return;
  if (!rest.length) delete t[k];
  else if (isTree(t[k])) {
    deletePath(t[k] as Tree, rest);
    if (!Object.keys(t[k] as Tree).length) delete t[k];
  }
}

function hasPath(t: Tree | undefined, path: string[]): boolean {
  let cur: unknown = t;
  for (const k of path) {
    if (!isTree(cur) || !(k in cur)) return false;
    cur = cur[k];
  }
  return true;
}

/** The config of these settings, or the reasons it is refused. */
function check(s: ProjectSettings, d: ToolDefaults): Config | { issues: Issue[] } {
  const ps = ProjectSettingsSchema.safeParse(s);
  if (!ps.success) return { issues: ps.error.issues };
  const c = ConfigSchema.safeParse(settingsToRawConfig(ps.data, d));
  return c.success ? c.data : { issues: c.error.issues };
}
type Issue = { path: PropertyKey[]; message: string };

const PLAIN: [RegExp, string][] = [
  [
    /different model family/,
    "the second opinion must come from the other model family (Claude and GPT check each other)",
  ],
  [/GPT-6 Astra/, "GPT-6 Astra is kept for special screenshot-review cases only"],
  [/above the cap/, "the aim cannot be above the hard stop"],
];

function plain(issues: Issue[], fields: FieldDef[], own: FieldDef): string {
  const i = issues[0];
  if (!i) return "This value is not allowed.";
  const at = i.path.map(String).join(".");
  const f = fields.find((x) => x.paths.some((p) => p.join(".") === at)) ?? own;
  const msg = PLAIN.find(([re]) => re.test(i.message))?.[1] ?? i.message;
  return `${f.label}: ${msg.charAt(0).toUpperCase()}${msg.slice(1)}.`;
}

function rangeText(f: FieldDef, v: unknown): string {
  if (f.kind === "switch") return `${f.label}: choose on or off.`;
  if (f.choices) return `${f.label}: that is not one of the choices.`;
  const r = f.value.safeParse(v);
  const issue = r.success ? undefined : r.error.issues[0];
  const bound =
    issue && "minimum" in issue
      ? "too small"
      : issue && "maximum" in issue
        ? "too large"
        : "not a valid number";
  return `${f.label}: ${String(v)} is ${bound}.`;
}

export interface Change {
  field: FieldDef;
  /** The new settings to save (not saved yet). */
  settings: ProjectSettings;
  before: Config;
  after: Config;
}

/**
 * The settings after one field is set (or reset to the default), checked. A value equal to the
 * default is stored as "no override", so "Back to default" only shows for real changes.
 */
export function changeField(
  s: ProjectSettings,
  d: ToolDefaults,
  fieldId: string,
  change: { value: unknown } | { reset: true },
): Change | { problem: string } {
  const before = check(s, d);
  if ("issues" in before)
    return { problem: "This project's settings cannot be read. Reload the page." };
  const fields = fieldsFor(before);
  const field = fields.find((f) => f.id === fieldId);
  if (!field)
    return { problem: "The page sent a setting the tool does not know. Reload the page." };
  const over: Tree = structuredClone((s.overrides ?? {}) as Tree);
  for (const p of field.paths) deletePath(over, p);
  const defaults = check({ ...s, overrides: over as Overrides }, d);
  if ("value" in change) {
    const v = change.value;
    if (!field.value.safeParse(v).success) return { problem: rangeText(field, v) };
    const isDefault =
      !("issues" in defaults) &&
      stableStringify(fieldValue(field, defaults)) === stableStringify(v);
    if (!isDefault) {
      const values = field.write ? field.write(v) : [v];
      field.paths.forEach((p, i) => {
        setPath(over, p, values[i]);
      });
    }
  }
  const settings: ProjectSettings = { ...s };
  if (Object.keys(over).length) settings.overrides = over as Overrides;
  else delete settings.overrides;
  const after = check(settings, d);
  if ("issues" in after) return { problem: plain(after.issues, fields, field) };
  if ("value" in change && field.choices && !field.choices.some((c) => c.value === change.value))
    return { problem: rangeText(field, change.value) };
  return { field, settings, before, after };
}

export interface FieldView {
  id: string;
  label: string;
  help?: string;
  group: FieldDef["group"];
  kind: FieldDef["kind"];
  step?: string;
  value: unknown;
  defaultValue: unknown;
  /** The project has its own value (shows "Back to default"). */
  changed: boolean;
  choices?: { value: string; label: string }[];
}

/** Every field with its value, its default and whether it is changed. */
export function fieldViews(s: ProjectSettings, d: ToolDefaults, config: Config): FieldView[] {
  const over = s.overrides as Tree | undefined;
  const plainDefaults = check({ ...s, overrides: undefined }, d);
  return fieldsFor(config).map((f) => ({
    id: f.id,
    label: f.label,
    ...(f.help ? { help: f.help } : {}),
    group: f.group,
    kind: f.kind,
    ...(f.step ? { step: f.step } : {}),
    value: fieldValue(f, config),
    defaultValue: "issues" in plainDefaults ? null : fieldValue(f, plainDefaults),
    changed: f.paths.some((p) => hasPath(over, p)),
    ...(f.choices ? { choices: f.choices } : {}),
  }));
}

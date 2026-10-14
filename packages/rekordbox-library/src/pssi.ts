// PSSI phrase labels and §21 section normalization from one committed table
// (T-RBL-05, closes F-RBL-07). The JSON at
// analysis/tests/fixtures/pssi-labels.json is generated from
// analysis/src/autolight_analysis/native.py and is the single source: this
// module evaluates it, and the Python loader reads the same file, so one label
// edit changes both outputs. Mood and kind tables follow the Deep Symmetry
// crate-digger "Rekordbox export structure" notes (documentation only, no code
// copied); PSSI moods and kinds are §5.2.
//
// Locating: resolved relative to this module (src/ and dist/ sit at the same
// depth under the package), overridable for packaged builds with
// AUTOLIGHT_PSSI_LABELS.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const highVariantTemplateSchema = z.object({
  template: z.string(),
  flag: z.union([z.literal("k1"), z.literal("k2"), z.literal("k3")]),
  nWhenSet: z.number(),
  nWhenClear: z.number(),
}).strict();

const highVariantRulesSchema = z.object({
  rules: z.array(z.object({
    k1: z.number().optional(),
    k2: z.number().optional(),
    k3: z.number().optional(),
    label: z.string(),
  }).strict()),
  fallback: z.string(),
}).strict();

const labelTableSchema = z.object({
  schema: z.string(),
  generator: z.string(),
  source: z.string(),
  moods: z.record(z.string(), z.string()),
  high: z.record(z.string(), z.string()),
  mid: z.record(z.string(), z.string()),
  low: z.record(z.string(), z.string()),
  highVariants: z.record(z.string(), z.union([highVariantTemplateSchema, highVariantRulesSchema])),
  unknownTemplate: z.string(),
  sections: z.record(z.string(), z.string()),
  unknownSection: z.string(),
  cases: z.array(z.object({
    mood: z.number(),
    kind: z.number(),
    k1: z.number(),
    k2: z.number(),
    k3: z.number(),
    label: z.string(),
    section: z.string(),
  }).strict()),
}).strict();

type HighVariantTemplate = z.infer<typeof highVariantTemplateSchema>;

type HighVariantRules = z.infer<typeof highVariantRulesSchema>;

export type PssiCase = z.infer<typeof labelTableSchema>["cases"][number];

export type PssiLabelTable = z.infer<typeof labelTableSchema>;

const DEFAULT_LABELS_PATH = fileURLToPath(
  new URL("../../../analysis/tests/fixtures/pssi-labels.json", import.meta.url),
);

export function loadPssiLabels(path: string = process.env["AUTOLIGHT_PSSI_LABELS"] ?? DEFAULT_LABELS_PATH): PssiLabelTable {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const table = labelTableSchema.safeParse(parsed);

  if (!table.success) throw new TypeError(`pssi-labels.json is not a label table: ${path}: ${table.error.message}`);

  return table.data;
}

// Committed table, read once per process (labels never change at runtime).
// Keyed by resolved path: a custom table passed to loadPssiLabels must reach
// the lookups, and the suite must not see a stale table across cases.
const cachedByPath = new Map<string, PssiLabelTable>();

export function resetPssiLabelsForTest(): void {
  cachedByPath.clear();
}

function table(path?: string): PssiLabelTable {
  const key = path ?? process.env["AUTOLIGHT_PSSI_LABELS"] ?? DEFAULT_LABELS_PATH;
  const hit = cachedByPath.get(key);

  if (hit !== undefined) return hit;
  const loaded = loadPssiLabels(key);
  cachedByPath.set(key, loaded);

  return loaded;
}

// Three call sites, all needing the same "missing kind" spelling.
function labelOrUnknown(map: Record<string, string>, kind: number, path?: string): string {
  return map[String(kind)] ?? table(path).unknownTemplate.replace("{kind}", String(kind));
}

function isTemplateVariant(variant: HighVariantTemplate | HighVariantRules): variant is HighVariantTemplate {
  return "template" in variant;
}

// §5.2 high mood: k-flags expand Intro, Up, Chorus and Outro variants.
export function highPhraseLabel(kind: number, k1 = 0, k2 = 0, k3 = 0, path?: string): string {
  const t = table(path);
  const variant = t.highVariants[String(kind)];

  if (variant === undefined) return labelOrUnknown(t.high, kind, path);

  if (isTemplateVariant(variant)) {
    const flags = { k1, k2, k3 };
    const n = flags[variant.flag] === 0 ? variant.nWhenClear : variant.nWhenSet;

    return variant.template.replace("{n}", String(n));
  }

  const flags = { k1, k2, k3 };

  for (const rule of variant.rules) {
    if ((["k1", "k2", "k3"] as const).every((f) => rule[f] === undefined || rule[f] === flags[f])) return rule.label;
  }

  return variant.fallback;
}

export function phraseLabel(mood: number, kind: number, k1 = 0, k2 = 0, k3 = 0, path?: string): string {
  const t = table(path);
  const moodName = t.moods[String(mood)];

  if (moodName === "high") return highPhraseLabel(kind, k1, k2, k3, path);

  if (moodName === "mid") return labelOrUnknown(t.mid, kind, path);

  if (moodName === "low") return labelOrUnknown(t.low, kind, path);

  return labelOrUnknown({}, kind, path);
}

/** Normalized §21 section; the first word of the raw label decides ("Up 1" to build). */
export function normalizeSection(rawLabel: string): string {
  const t = table();
  const first = rawLabel.trim().split(/\s+/)[0] ?? "";

  return t.sections[first.toLowerCase()] ?? t.unknownSection;
}

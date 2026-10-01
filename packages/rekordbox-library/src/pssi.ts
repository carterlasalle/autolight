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

export interface HighVariantTemplate {
  template: string;
  flag: "k1" | "k2" | "k3";
  nWhenSet: number;
  nWhenClear: number;
}

export interface HighVariantRules {
  rules: { k1?: number; k2?: number; k3?: number; label: string }[];
  fallback: string;
}

export interface PssiCase {
  mood: number;
  kind: number;
  k1: number;
  k2: number;
  k3: number;
  label: string;
  section: string;
}

export interface PssiLabelTable {
  schema: string;
  generator: string;
  source: string;
  moods: Record<string, string>;
  high: Record<string, string>;
  mid: Record<string, string>;
  low: Record<string, string>;
  highVariants: Record<string, HighVariantTemplate | HighVariantRules>;
  unknownTemplate: string;
  sections: Record<string, string>;
  unknownSection: string;
  cases: PssiCase[];
}

const DEFAULT_LABELS_PATH = fileURLToPath(
  new URL("../../../analysis/tests/fixtures/pssi-labels.json", import.meta.url),
);

export function loadPssiLabels(path: string = process.env["AUTOLIGHT_PSSI_LABELS"] ?? DEFAULT_LABELS_PATH): PssiLabelTable {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isLabelTable(parsed)) throw new TypeError(`pssi-labels.json is not a label table: ${path}`);
  return parsed;
}

function isLabelTable(value: unknown): value is PssiLabelTable {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Partial<PssiLabelTable>;
  return (
    typeof t.schema === "string" &&
    typeof t.high === "object" && t.high !== null &&
    typeof t.mid === "object" && t.mid !== null &&
    typeof t.low === "object" && t.low !== null &&
    typeof t.highVariants === "object" && t.highVariants !== null &&
    typeof t.sections === "object" && t.sections !== null &&
    Array.isArray(t.cases)
  );
}

// Committed table, read once per process (labels never change at runtime).
let cached: PssiLabelTable | undefined;
function table(): PssiLabelTable {
  cached ??= loadPssiLabels();
  return cached;
}

// Three call sites, all needing the same "missing kind" spelling.
function labelOrUnknown(map: Record<string, string>, kind: number): string {
  return map[String(kind)] ?? table().unknownTemplate.replace("{kind}", String(kind));
}

// §5.2 high mood: k-flags expand Intro, Up, Chorus and Outro variants.
export function highPhraseLabel(kind: number, k1 = 0, k2 = 0, k3 = 0): string {
  const t = table();
  const variant = t.highVariants[String(kind)];
  if (variant === undefined) return labelOrUnknown(t.high, kind);
  const flags: Record<string, number> = { k1, k2, k3 };
  if ("template" in variant) {
    const n = flags[variant.flag] ? variant.nWhenSet : variant.nWhenClear;
    return variant.template.replace("{n}", String(n));
  }
  for (const rule of variant.rules) {
    if ((["k1", "k2", "k3"] as const).every((f) => rule[f] === undefined || rule[f] === flags[f])) return rule.label;
  }
  return variant.fallback;
}

export function phraseLabel(mood: number, kind: number, k1 = 0, k2 = 0, k3 = 0): string {
  const t = table();
  const moodName = t.moods[String(mood)];
  if (moodName === "high") return highPhraseLabel(kind, k1, k2, k3);
  if (moodName === "mid") return labelOrUnknown(t.mid, kind);
  if (moodName === "low") return labelOrUnknown(t.low, kind);
  return labelOrUnknown({}, kind);
}

/** Normalized §21 section; the first word of the raw label decides ("Up 1" to build). */
export function normalizeSection(rawLabel: string): string {
  const t = table();
  const first = rawLabel.split(" ")[0] ?? "";
  return t.sections[first.toLowerCase()] ?? t.unknownSection;
}

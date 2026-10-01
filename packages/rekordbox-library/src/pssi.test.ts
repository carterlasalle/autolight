// T-RBL-05 (F-RBL-07): the committed label table is the single source for both
// languages. This test evaluates the table's cases through the TypeScript
// module and compares them with pyrekordbox-era Python tables in
// analysis/src/autolight_analysis/native.py. One label change moves both
// outputs; drift turns this red.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { highPhraseLabel, loadPssiLabels, normalizeSection, phraseLabel, type PssiLabelTable } from "./pssi.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const labelsPath = join(repoRoot, "analysis", "tests", "fixtures", "pssi-labels.json");

const PYTHON_PROBE = String.raw`import json, sys
sys.path.insert(0, "analysis/src")
from autolight_analysis import native

doc = json.load(open("analysis/tests/fixtures/pssi-labels.json", encoding="utf-8"))
labels = [
    native.phrase_label(c["mood"], c["kind"], c["k1"], c["k2"], c["k3"]) for c in doc["cases"]
]
print(json.dumps({
    "high": native.HIGH_LABELS,
    "mid": native.MID_LABELS,
    "low": native.LOW_LABELS,
    "sections": native._NORMALIZE,
    "labels": labels,
    "normalized": [native.normalize_section(label) for label in labels],
}))
`;

interface PythonProbe {
  high: Record<string, string>;
  mid: Record<string, string>;
  low: Record<string, string>;
  sections: Record<string, string>;
  labels: string[];
  normalized: string[];
}

function runPythonProbe(): PythonProbe | undefined {
  try {
    const stdout = execFileSync("uv", ["run", "--project", "analysis", "python", "-c", PYTHON_PROBE], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 120_000,
    });
    return JSON.parse(stdout.trim().split("\n").pop() as string) as PythonProbe;
  } catch {
    return undefined;
  }
}

const probe = runPythonProbe();
const table: PssiLabelTable = loadPssiLabels(labelsPath);

describe("pssi label table", () => {
  it("loads the committed table with a schema and generated cases", () => {
    expect(table.schema).toBe("autolight/pssi-labels@1");
    expect(table.cases.length).toBeGreaterThan(100);
    expect(readFileSync(labelsPath, "utf8")).toContain("\"generator\"");
  });

  it("evaluates every table case to its expected label and section", () => {
    for (const testCase of table.cases) {
      const label = phraseLabel(testCase.mood, testCase.kind, testCase.k1, testCase.k2, testCase.k3);
      expect(label, `mood=${testCase.mood} kind=${testCase.kind} k=${testCase.k1}${testCase.k2}${testCase.k3}`).toBe(testCase.label);
      expect(normalizeSection(label)).toBe(testCase.section);
    }
  });

  it("expands the high-mood k-flag variants", () => {
    expect(highPhraseLabel(1, 1)).toBe("Intro 1");
    expect(highPhraseLabel(1, 0)).toBe("Intro 2");
    expect(highPhraseLabel(2, 0, 0, 0)).toBe("Up 1");
    expect(highPhraseLabel(2, 0, 0, 1)).toBe("Up 2");
    expect(highPhraseLabel(2, 0, 1, 0)).toBe("Up 3");
    expect(highPhraseLabel(5, 1)).toBe("Chorus 1");
    expect(highPhraseLabel(5, 0)).toBe("Chorus 2");
    expect(highPhraseLabel(6, 1)).toBe("Outro 1");
    expect(highPhraseLabel(3)).toBe("Down");
  });

  it("spells unknown moods and kinds the same way", () => {
    expect(phraseLabel(9, 4)).toBe("Unknown4");
    expect(phraseLabel(2, 99)).toBe("Unknown99");
    expect(normalizeSection("Solo")).toBe("unknown");
  });

  it("normalizes sections case-insensitively on the first word", () => {
    expect(normalizeSection("Up 1")).toBe("build");
    expect(normalizeSection("up")).toBe("build");
    expect(normalizeSection("Verse 3")).toBe("verse");
    expect(normalizeSection("Down")).toBe("breakdown");
  });

  it("matches the Python tables and cases (drift check)", () => {
    if (probe === undefined) {
      throw new Error("uv with the analysis project is required for the Python parity check");
    }
    expect(probe.high).toEqual(table.high);
    expect(probe.mid).toEqual(table.mid);
    expect(probe.low).toEqual(table.low);
    expect(probe.sections).toEqual(table.sections);
    expect(probe.labels).toEqual(table.cases.map((testCase) => testCase.label));
    expect(probe.normalized).toEqual(table.cases.map((testCase) => testCase.section));
  });
});

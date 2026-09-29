// READ ONLY: never writes Rekordbox's database (§4.1).
export const READ_ONLY = true;

export interface LibraryTrackRow {
  rekordboxId: string;
  title?: string;
  artist?: string;
  filePath?: string;
  analysisDataPath?: string;
}

// master.db row → track identity fields (§12 resolution starts at native ID + path).
export function rowToIdentity(row: LibraryTrackRow): { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string } {
  const out: { rekordboxId: string; canonicalPath?: string; title?: string; artist?: string } = { rekordboxId: row.rekordboxId };
  if (row.filePath) out.canonicalPath = row.filePath;
  if (row.title) out.title = row.title;
  if (row.artist) out.artist = row.artist;
  return out;
}

// AnalysisDataPath → ANLZ sibling set (§5). Pure path math, no I/O here.
export function anlzPaths(analysisDataPath: string): { dat: string; ext: string; ex2: string } {
  const base = analysisDataPath.replace(/ANLZ0000\.(DAT|EXT|2EX)$/i, "");
  return { dat: `${base}ANLZ0000.DAT`, ext: `${base}ANLZ0000.EXT`, ex2: `${base}ANLZ0000.2EX` };
}

// PQTZ beat → canonical grid entry (§5.1). Throws on invalid bar position.
// PQTZ tempo is BPM×100 per ANLZ spec; scale to BPM here.
export function toNativeBeat(raw: { index: number; beatInBar: number; sourceTimeMs: number; bpm: number }): { index: number; beatInBar: 1 | 2 | 3 | 4; sourceTimeMs: number; bpm: number } {
  if (![1, 2, 3, 4].includes(raw.beatInBar)) throw new RangeError(`beatInBar=${raw.beatInBar}, expected 1-4`);
  return { index: raw.index, beatInBar: raw.beatInBar as 1 | 2 | 3 | 4, sourceTimeMs: raw.sourceTimeMs, bpm: raw.bpm / 100 };
}

// PSSI phrase labels per mood (ANLZ reference, §5.2). Raw retained by caller.
const HIGH_LABELS: Record<number, string> = { 1: "Intro", 2: "Up", 3: "Down", 5: "Chorus", 6: "Outro" };
const MID_LABELS: Record<number, string> = { 1: "Intro", 2: "Verse 1", 3: "Verse 2", 4: "Verse 3", 5: "Verse 4", 6: "Verse 5", 7: "Verse 6", 8: "Bridge", 9: "Chorus", 10: "Outro" };
const LOW_LABELS: Record<number, string> = { 1: "Intro", 2: "Verse 1", 3: "Verse 1", 4: "Verse 1", 5: "Verse 2", 6: "Verse 2", 7: "Verse 2", 8: "Bridge", 9: "Chorus", 10: "Outro" };

export function highPhraseLabel(kind: number, k1 = 0, k2 = 0, k3 = 0): string {
  if (kind === 1) return k1 ? "Intro 1" : "Intro 2";
  if (kind === 2) {
    if (k2 === 0 && k3 === 0) return "Up 1";
    if (k2 === 0 && k3 === 1) return "Up 2";
    return "Up 3";
  }
  if (kind === 5) return k1 ? "Chorus 1" : "Chorus 2";
  if (kind === 6) return k1 ? "Outro 1" : "Outro 2";
  return HIGH_LABELS[kind] ?? `Unknown${kind}`;
}

export function phraseLabel(mood: number, kind: number, k1 = 0, k2 = 0, k3 = 0): string {
  if (mood === 1) return highPhraseLabel(kind, k1, k2, k3);
  if (mood === 2) return MID_LABELS[kind] ?? `Unknown${kind}`;
  if (mood === 3) return LOW_LABELS[kind] ?? `Unknown${kind}`;
  return `Unknown${kind}`;
}

const SECTION_OF: Record<string, string> = {
  Intro: "intro", Verse: "verse", Up: "build", Down: "breakdown",
  Chorus: "chorus", Bridge: "bridge", Outro: "outro",
};

// Normalized §21 section; first word of raw label decides ("Up 1" → build).
export function normalizeSection(rawLabel: string): string {
  return SECTION_OF[rawLabel.split(" ")[0]!] ?? "unknown";
}

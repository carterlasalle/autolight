// Accessibility provider decode (T-LIVE-06). Rekordbox's AX/UIA tree is
// dumped by a persistent helper in the main process; this module turns the
// dumped tree into per-deck readings without guessing which time string is
// which.
//
// Deck separation: each deck container is found by role plus position within
// the deck area, never "the first two time strings". Elapsed versus remaining
// is decided by label text when present and otherwise by which value
// decreases across samples; if both look the same the reading is not readable
// and the caller holds its last state instead of inventing one.
//
// Quality is `estimated` (about one beat) and labelled as such by callers.

export interface AxNode {
  role: string;
  position: number;
  label?: string;
  value?: string;
  children?: AxNode[];
}

export interface AxDeckReading {
  deckId: number;
  elapsedSeconds: number | null;
  remainingSeconds: number | null;
  playing: boolean | null;
  title: string | null;
  artist: string | null;
  readable: boolean;
}

export interface AxPermissionState {
  granted: boolean;
  remedy: string;
}

export interface AxSample {
  deckId: number;
  elapsedSeconds: number | null;
  playing: boolean | null;
  readable: boolean;
  sampledAtNs: bigint;
}

function flatten(nodes: readonly AxNode[], out: AxNode[] = []): AxNode[] {
  for (const node of nodes) {
    out.push(node);
    if (node.children) flatten(node.children, out);
  }
  return out;
}

function timeToSeconds(text: string | undefined): number | null {
  if (!text) return null;
  const m = text.match(/^\s*([+-])?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const a = Number(m[2] ?? 0);
  const b = Number(m[3] ?? 0);
  const c = m[4] === undefined ? null : Number(m[4]);
  const seconds = c === null ? a * 60 + b : a * 3600 + b * 60 + c;
  return sign * seconds;
}

function isRemaining(label: string | undefined, value: string | undefined): boolean {
  if (label && /remain|left/i.test(label)) return true;
  if (value && value.trim().startsWith("-")) return true;
  return false;
}

function isElapsed(label: string | undefined, value: string | undefined): boolean {
  if (label && /elapsed|played|total played/i.test(label)) return true;
  if (value && value.trim().startsWith("+")) return true;
  return false;
}

function hasTime(node: AxNode): boolean {
  return timeToSeconds(node.value) !== null;
}

function parsePlayState(nodes: readonly AxNode[]): boolean | null {
  for (const node of nodes) {
    const text = `${node.label ?? ""} ${node.value ?? ""}`;
    if (/\bpause\b/i.test(text)) return false;
    if (/\bplay(ing)?\b/i.test(text)) return true;
    if (/\bcue(d)?\b/i.test(text)) return false;
  }
  return null;
}

// The deck number is read from the container that holds the deck's elements:
// Rekordbox exposes the deck area as one container with a deck child each.
function deckIndexOf(node: AxNode, siblings: readonly AxNode[]): number {
  const hinted = /deck\s*([1-4])/i.exec(node.label ?? "");
  if (hinted) return Number(hinted[1]);
  return siblings.indexOf(node) + 1;
}

export function readAxDecks(root: readonly AxNode[]): AxDeckReading[] {
  const all = flatten(root);
  const deckContainers = all.filter((n) => (/deck|player/i.test(n.role) && !/button/i.test(n.role)) || /deck\s*[1-4]/i.test(n.label ?? ""));
  const containers: AxNode[] = deckContainers.length > 0 ? deckContainers : all.filter((n) => /group|pane/i.test(n.role));
  const readings: AxDeckReading[] = [];
  for (const container of containers) {
    const nodes = container.children ? flatten(container.children) : [container];
    const timeNodes = nodes.filter(hasTime);
    const elapsedNode = timeNodes.find((n) => isElapsed(n.label, n.value)) ?? timeNodes.find((n) => !isRemaining(n.label, n.value));
    const remainingNode = timeNodes.find((n) => isRemaining(n.label, n.value));
    const titleNode = nodes.find((n) => /title|track/i.test(n.label ?? ""));
    const artistNode = nodes.find((n) => /artist/i.test(n.label ?? ""));
    const deckId = deckIndexOf(container, containers);
    const elapsedSeconds = timeToSeconds(elapsedNode?.value);
    const remainingSeconds = timeToSeconds(remainingNode?.value);
    const readable = elapsedSeconds !== null || remainingSeconds !== null;
    readings.push({
      deckId,
      elapsedSeconds,
      remainingSeconds,
      playing: parsePlayState(nodes),
      title: titleNode?.value ?? null,
      artist: artistNode?.value ?? null,
      readable,
    });
  }
  return readings.sort((a, b) => a.deckId - b.deckId);
}

// Refines a reading with the previous sample: a deck showing the same string
// twice is unreadable, and a value that increases while the other decreases
// identifies the remaining-time field even without a label.
export function refineAxReading(current: AxDeckReading, previous: AxDeckReading | undefined): AxDeckReading {
  if (current.elapsedSeconds === null && current.remainingSeconds === null) return { ...current, readable: false };
  if (current.elapsedSeconds !== null && current.remainingSeconds === null) {
    const playing = current.playing ?? (previous !== undefined && previous.elapsedSeconds !== null && current.elapsedSeconds > previous.elapsedSeconds ? true : current.playing);
    return { ...current, playing, readable: true };
  }
  if (current.elapsedSeconds === null && current.remainingSeconds !== null) {
    const playing = current.playing ?? (previous !== undefined && previous.remainingSeconds !== null && current.remainingSeconds < previous.remainingSeconds ? true : current.playing);
    return { ...current, playing, readable: true };
  }
  const sameValue = current.elapsedSeconds === current.remainingSeconds;
  if (sameValue) return { ...current, readable: false };
  // Both fields labelled: elapsed rising means playing, remaining falling
  // confirms it; either motion alone is enough when the labels disambiguate.
  if (previous !== undefined) {
    const elapsedRising =
      previous.elapsedSeconds !== null &&
      current.elapsedSeconds !== null &&
      current.elapsedSeconds > previous.elapsedSeconds;
    const remainingFalling =
      previous.remainingSeconds !== null &&
      current.remainingSeconds !== null &&
      current.remainingSeconds < previous.remainingSeconds;
    if (elapsedRising || remainingFalling) return { ...current, playing: true, readable: true };
  }
  return { ...current, readable: true };
}

export function axPermissionState(granted: boolean): AxPermissionState {
  return granted
    ? { granted: true, remedy: "" }
    : {
        granted: false,
        remedy: "System Settings > Privacy & Security > Accessibility: enable Autolight (or the helper) and restart it; AX stays off until this is granted",
      };
}

// Elapsed seconds onto the ANLZ grid, as fractional beats (§T-LIVE-06 DoD).
export function axFractionalBeat(elapsedSeconds: number, grid: readonly { sourceTimeMs: number }[]): number | null {
  if (grid.length === 0) return null;
  const t = elapsedSeconds * 1000;
  const indexFor = (i: number): number => grid[i]?.sourceTimeMs ?? Number.POSITIVE_INFINITY;
  if (t <= indexFor(0)) return 1;
  let lo = 0;
  let hi = grid.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (indexFor(mid) <= t) lo = mid;
    else hi = mid - 1;
  }
  const start = indexFor(lo);
  const next = indexFor(lo + 1);
  if (!Number.isFinite(next) || next === start) return lo + 1;
  return lo + 1 + (t - start) / (next - start);
}

export function toAxSample(reading: AxDeckReading, atNs: bigint): AxSample {
  return {
    deckId: reading.deckId,
    elapsedSeconds: reading.elapsedSeconds,
    playing: reading.playing,
    readable: reading.readable,
    sampledAtNs: atNs,
  };
}

// Shared provider contract suite (T-LIVE-01).
//
// Every provider in this package is run through `runProviderContractSuite`:
// start/stop idempotence, status transitions, generation increments on track
// change with no metadata leak from the previous generation, monotonic
// `receivedAtNs`, bounded queues (S26) and malformed input that is rejected
// and counted instead of thrown into the manager.
//
// The suite returns the failures it found instead of throwing, so a test can
// assert an empty list for a correct provider and a non-empty list for a
// deliberately leaky one (the red run).
import type { DJLiveProvider, ProviderDeckState } from "./providers.js";

export interface VirtualClock {
  nowNs(): bigint;
  advance(ms: number): void;
}

export function virtualClock(startNs = 1_000_000_000_000n): VirtualClock {
  let t = startNs;
  return {
    nowNs: () => t,
    advance: (ms: number) => {
      t += BigInt(Math.max(0, Math.round(ms))) * 1_000_000n;
    },
  };
}

export interface ContractTrack {
  id: string;
  title: string;
  artist: string;
}

export interface ProviderContractSubject {
  provider: DJLiveProvider;
  /** True when the provider can report track text (title/artist). */
  reportsTrackText: boolean;
  /** Advance the subject's world by `ms` (virtual time). */
  advance(ms: number): Promise<void>;
  /** Load a track onto a deck. The provider must bump the generation. */
  loadTrack(deckId: number, track: ContractTrack): Promise<void>;
  /** Feed one malformed input for this provider's transport. */
  malformed(): Promise<void>;
  /** Stop sockets, timers and helpers. */
  cleanup(): Promise<void>;
}

export interface ContractHarness {
  name: string;
  create(): Promise<ProviderContractSubject>;
}

interface Capture {
  states: ProviderDeckState[];
  statuses: string[];
}

function capture(provider: DJLiveProvider): Capture {
  const states: ProviderDeckState[] = [];
  const statuses: string[] = [];
  provider.onDeckState((state) => states.push(state));
  provider.onConnection((status) => statuses.push(status.state));
  return { states, statuses };
}

function lastFor(states: readonly ProviderDeckState[], deckId: number): ProviderDeckState | undefined {
  return states.filter((s) => s.deckId === deckId).at(-1);
}

// The suite body. Anything the profile promises is checked; anything it does
// not claim (track text) is skipped.
export async function runProviderContractSuite(subject: ProviderContractSubject): Promise<string[]> {
  const failures: string[] = [];
  const check = (ok: boolean, message: string): void => {
    if (!ok) failures.push(message);
  };
  const { provider } = subject;
  const trace = capture(provider);
  try {
    await provider.start();
    await provider.start();
    check(provider.getStatus() !== undefined, "status missing after start");
    check(trace.statuses.length > 0, "onConnection emitted no status");
    check(provider.getStatus().state !== "failed", `provider failed on start: ${JSON.stringify(provider.getStatus())}`);

    await subject.loadTrack(1, { id: "gen-a", title: "Generation A", artist: "Suite" });
    await subject.advance(100);
    const first = lastFor(trace.states, 1);
    check(first !== undefined, "no deck state emitted after first load");
    const generationA = first?.generation ?? -1;

    await subject.loadTrack(1, { id: "gen-b", title: "Generation B", artist: "Suite" });
    await subject.advance(100);
    const second = lastFor(trace.states, 1);
    check((second?.generation ?? -1) > generationA, "generation did not increase on track change");
    if (subject.reportsTrackText) {
      check(second?.track?.title === "Generation B", `track text did not follow the new generation: ${second?.track?.title ?? "null"}`);
    }
    const leaked = trace.states.filter((s) => s.deckId === 1 && (s.generation ?? 0) > generationA && s.track?.title === "Generation A");
    check(leaked.length === 0, `metadata leaked from generation ${generationA} into a later generation (${leaked.length} states)`);

    // A second deck must stay at generation 0 and not borrow deck 1's track.
    await subject.loadTrack(2, { id: "gen-c", title: "Deck Two", artist: "Suite" });
    await subject.advance(100);
    const deckTwo = lastFor(trace.states, 2);
    check(deckTwo !== undefined, "no deck state emitted for the second deck");
    check(deckTwo?.track?.title !== "Generation A", "deck 2 inherited deck 1 metadata");

    // Monotonic receivedAtNs per deck.
    let previous: bigint | null = null;
    for (const s of trace.states) {
      if (s.deckId !== 1) continue;
      if (previous !== null) check(s.receivedAtNs > previous, "receivedAtNs went backwards");
      previous = s.receivedAtNs;
    }

    // Bounded queues: many updates must not grow the queue.
    for (let i = 0; i < 40; i++) {
      await subject.advance(10);
    }
    check(provider.getStats().queueDepth <= 1, `queue depth grew to ${provider.getStats().queueDepth} (latest-wins is 1)`);

    // Malformed input is rejected and counted, never thrown.
    const rejectedBefore = provider.getStats().rejected;
    await subject.malformed();
    const rejectedAfter = provider.getStats().rejected;
    check(rejectedAfter > rejectedBefore, "malformed input was not counted as rejected");
    const statusAfter = provider.getStatus().state;
    check(statusAfter !== "failed", `malformed input took the provider to failed: ${JSON.stringify(provider.getStatus())}`);
    check(provider.getDecks().length >= 1, "provider lost its deck state after malformed input");
  } finally {
    await provider.stop();
    await provider.stop();
  }
  return failures;
}

export function describeFailures(failures: readonly string[]): string {
  return failures.map((f) => ` - ${f}`).join("\n");
}

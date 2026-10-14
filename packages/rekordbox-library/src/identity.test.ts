// Deck to library to cached model resolution (T-RBL-07, DS-22, F-APP-03).
import { describe, expect, it } from "vitest";
import { MemoryAliasStore } from "@autolight/track-identity";
import { RESOLVER_CHAIN, resolveLiveTrack } from "./identity.js";

function storeWithLibrary(): { store: MemoryAliasStore; byId: (id: string) => { rekordboxId: string; canonicalPath: string } | undefined } {
  const rows: Record<string, { rekordboxId: string; canonicalPath: string }> = {
    "101": { rekordboxId: "101", canonicalPath: "/Music/Aurora.mp3" },
    "102": { rekordboxId: "102", canonicalPath: "/Music/Basalt.mp3" },
  };

  return { store: new MemoryAliasStore(), byId: (id: string) => rows[id] };
}

describe("resolveLiveTrack", () => {
  it("follows the DS-22 chain order with confidence per step", () => {
    expect(RESOLVER_CHAIN).toEqual(["memory-reader-id", "rekordbox-id", "lighting-ipc-id", "agent-api", "history-table", "path-library", "title-path"]);
    const { store, byId } = storeWithLibrary();

    // Seed the alias graph: the store path must resolve, not makeId.
    store.insert({ trackId: "t-canon", aliasId: "rb:101", source: "rekordbox-id", createdAt: "2026-10-14T00:00:00Z" });
    let minted = 0;
    const r = resolveLiveTrack(store, { memoryReaderId: "101", libraryById: byId }, () => `t${++minted}`);

    expect(r.trackId).toBe("t-canon");
    expect(minted).toBe(0);
    expect(r.matchedStep).toBe("memory-reader-id");
    expect(r.confidence).toBe(1);
    expect(r.steps[0]).toMatchObject({ step: "memory-reader-id", matched: true, trackId: "t-canon" });

    // An unknown native ID mints exactly one fresh id.
    const fresh = resolveLiveTrack(store, { memoryReaderId: "102", libraryById: byId }, () => `t${++minted}`);

    expect(fresh.trackId).toBe("t1");
    expect(minted).toBe(1);
  });
  it("prefers the memory reader over a conflicting lighting ID", () => {
    const { store } = storeWithLibrary();
    let n = 0;
    const r = resolveLiveTrack(store, { memoryReaderId: "101", lightingIpcId: "102" }, () => `t${++n}`);
    expect(r.matchedStep).toBe("memory-reader-id");
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ step: "memory-reader-id", matched: true });
  });
  it("resolves lighting, agent and history IDs when earlier links are absent", () => {
    const { store } = storeWithLibrary();
    let n = 0;

    // DS-22 confidence per step, not only the matched step name.
    expect(resolveLiveTrack(store, { lightingIpcId: "102" }, () => `t${++n}`)).toMatchObject({ matchedStep: "lighting-ipc-id", confidence: 0.95 });
    expect(resolveLiveTrack(store, { agentTrackId: "101" }, () => `t${++n}`)).toMatchObject({ matchedStep: "agent-api", confidence: 0.9 });
    expect(
      resolveLiveTrack(store, { historyTrackId: "101", historyIds: new Set(["101"]) }, () => `t${++n}`),
    ).toMatchObject({ matchedStep: "history-table", confidence: 0.8 });

    // A history miss reports the step, its note, and the null result.
    const missed = resolveLiveTrack(store, { historyTrackId: "999", historyIds: new Set(["101"]) }, () => `t${++n}`);

    expect(missed.trackId).toBeNull();
    expect(missed.matchedStep).toBeNull();
    expect(missed.confidence).toBe(0);
    expect(missed.steps.find((s) => s.step === "history-table")).toMatchObject({ matched: false, confidence: 0, note: "id not in history table" });
  });
  it("resolves an ANLZ path through the library and a unique title", () => {
    const { store } = storeWithLibrary();
    let n = 0;
    const mint = (): string => `t${++n}`;

    const byPath = (p: string): { rekordboxId: string; canonicalPath: string } | undefined =>
      p === "/Music/Aurora.mp3" ? { rekordboxId: "101", canonicalPath: p } : undefined;

    // Exact id + the documented 0.7 confidence for the path branch.
    const viaPath = resolveLiveTrack(store, { anlzPath: "/Music/Aurora.mp3", libraryByPath: byPath }, mint);

    expect(viaPath.trackId).toBe("t1");
    expect(viaPath.matchedStep).toBe("path-library");
    expect(viaPath.confidence).toBe(0.7);

    const viaTitle = resolveLiveTrack(
      store,
      { title: "Aurora", artist: "Nova", titleIndex: () => ["101"], libraryById: (id) => (id === "101" ? { rekordboxId: "101", canonicalPath: "/Music/Aurora.mp3" } : undefined) },
      mint,
    );

    // The same library row via the title branch resolves to the id the path
    // branch just attached: minting does not run twice for one identity.
    expect(viaTitle.trackId).toBe("t1");
    expect(viaTitle.matchedStep).toBe("title-path");
    expect(viaTitle.confidence).toBe(0.5);
  });
  it("never resolves an ambiguous title alone", () => {
    const { store } = storeWithLibrary();
    const r = resolveLiveTrack(store, { title: "Aurora", titleIndex: () => ["101", "102"] }, () => "t9");
    expect(r.trackId).toBeNull();
    expect(r.steps.at(-1)!.note).toMatch(/ambiguous/);
  });
});

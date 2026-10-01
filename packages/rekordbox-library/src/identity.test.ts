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
    expect(RESOLVER_CHAIN).toEqual(["memory-reader-id", "lighting-ipc-id", "agent-api", "history-table", "title-path"]);
    const { store, byId } = storeWithLibrary();
    const r = resolveLiveTrack(store, { memoryReaderId: "101", libraryById: byId }, () => "t1");
    expect(r.trackId).not.toBeNull();
    expect(r.matchedStep).toBe("memory-reader-id");
    expect(r.confidence).toBe(1);
    expect(r.steps[0]).toMatchObject({ step: "memory-reader-id", matched: true });
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
    expect(resolveLiveTrack(store, { lightingIpcId: "102" }, () => `t${++n}`).matchedStep).toBe("lighting-ipc-id");
    expect(resolveLiveTrack(store, { agentTrackId: "101" }, () => `t${++n}`).matchedStep).toBe("agent-api");
    expect(
      resolveLiveTrack(store, { historyTrackId: "101", historyIds: new Set(["101"]) }, () => `t${++n}`).matchedStep,
    ).toBe("history-table");
    expect(
      resolveLiveTrack(store, { historyTrackId: "999", historyIds: new Set(["101"]) }, () => `t${++n}`).trackId,
    ).toBeNull();
  });
  it("resolves an ANLZ path through the library and a unique title", () => {
    const { store } = storeWithLibrary();
    let n = 0;
    const byPath = (p: string): { rekordboxId: string; canonicalPath: string } | undefined =>
      p === "/Music/Aurora.mp3" ? { rekordboxId: "101", canonicalPath: p } : undefined;
    const viaPath = resolveLiveTrack(store, { anlzPath: "/Music/Aurora.mp3", libraryByPath: byPath }, () => `t${++n}`);
    expect(viaPath.trackId).not.toBeNull();
    const viaTitle = resolveLiveTrack(
      store,
      { title: "Aurora", artist: "Nova", titleIndex: () => ["101"], libraryById: (id) => (id === "101" ? { rekordboxId: "101", canonicalPath: "/Music/Aurora.mp3" } : undefined) },
      () => `t${++n}`,
    );
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

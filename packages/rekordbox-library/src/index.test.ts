// Package surface: identity mapping used by the live providers and the exports
// the rest of the app consumes (T-RBL-02, §12; composite row shape from
// packages/rekordbox-live).
import { describe, expect, it } from "vitest";
import {
  READ_ONLY,
  rowToIdentity,
  RekordboxReader,
  LibraryService,
  resolveAnlzSet,
  beatToSourceSeconds,
  phraseLabel,
  deobfuscateKey,
} from "./index.js";

describe("rekordbox-library surface", () => {
  it("is read-only by construction", () => {
    expect(READ_ONLY).toBe(true);
  });

  it("carries the native id and path into identity", () => {
    expect(rowToIdentity({ rekordboxId: "42", filePath: "/music/t.mp3", title: "T", artist: "A" })).toEqual({
      rekordboxId: "42",
      canonicalPath: "/music/t.mp3",
      title: "T",
      artist: "A",
    });
  });

  it("reads the path field the composite provider actually carries", () => {
    // The composite FLX4 provider passes `canonicalPath` and no `filePath`.
    const compositeRow = { rekordboxId: "100307086", canonicalPath: "/music/aurora.aiff", title: "Aurora", artist: "Nova" };
    const identity = rowToIdentity(compositeRow);
    expect(identity.canonicalPath).toBe("/music/aurora.aiff");
    // A raw database row carries `filePath` instead; both normalize the same way.
    expect(rowToIdentity({ rekordboxId: "100307086", filePath: "/music/aurora.aiff" }).canonicalPath).toBe("/music/aurora.aiff");
    // An empty path is not an identity field.
    expect(rowToIdentity({ rekordboxId: "7", canonicalPath: "" }).canonicalPath).toBeUndefined();
  });

  it("re-exports the reader, the service, the resolver and the label table", () => {
    expect(typeof RekordboxReader.open).toBe("function");
    expect(typeof LibraryService.open).toBe("function");
    expect(typeof resolveAnlzSet).toBe("function");
    expect(typeof beatToSourceSeconds).toBe("function");
    expect(phraseLabel(1, 5, 0)).toBe("Chorus 2");
    expect(deobfuscateKey()).toMatch(/^402fd/);
  });
});

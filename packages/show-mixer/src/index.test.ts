import { describe, expect, it } from "vitest";
import { impactOwner } from "./index.js";
import { makeDeck } from "@autolight/simulator";

describe("show-mixer", () => {
  it("gives impact to the louder deck", () => {
    const a = makeDeck({ channelFader: 1, crossfader: 1, track: { id: "a", sourceIds: {} } as any });
    const b = makeDeck({ channelFader: 0.1, crossfader: 1, track: { id: "b", sourceIds: {} } as any });
    expect(impactOwner({ state: a, strength: 1 }, { state: b, strength: 1 })).toBe("a");
  });
  it("returns null when both silent", () => {
    const a = makeDeck({ playing: false });
    const b = makeDeck({ playing: false });
    expect(impactOwner({ state: a, strength: 1 }, { state: b, strength: 1 })).toBeNull();
  });
});

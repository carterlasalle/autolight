// T-SER-01 setup assistant proof: each missing precondition names its own
// next step, and the healthy state reports what is flowing.
import { describe, expect, it } from "vitest";
import { checkSeratoSetup, type SeratoSetupInput } from "./setup.js";

function input(over: Partial<SeratoSetupInput> = {}): SeratoSetupInput {
  return {
    remoteEnabled: true,
    seratoInstalled: true,
    detectedVersion: "3.3.5",
    advertised: true,
    advertisedPort: 53211,
    instanceName: "autolight @ studio.local",
    connected: true,
    authenticated: true,
    deckUpdateHz: [58.2, 0, 0, 0],
    rejectedFrames: 0,
    ...over,
  };
}

describe("serato setup assistant (T-SER-01)", () => {
  it("reports receiving with the advertised name, port and deck rate", () => {
    const report = checkSeratoSetup(input());
    expect(report.state).toBe("receiving");
    expect(report.remedy).toContain("Remote state is flowing");
    const advertising = report.steps.find((step) => step.id === "advertising");
    expect(advertising?.detail).toContain("_SeratoIOSRemote._tcp");
    expect(advertising?.detail).toContain("53211");
    expect(report.steps.find((step) => step.id === "deck-rate")?.detail).toContain("58.2 Hz");
    expect(report.steps.every((step) => step.ok)).toBe(true);
  });

  it("names the Serato-side step when remote is disabled", () => {
    const report = checkSeratoSetup(input({ remoteEnabled: false }));
    expect(report.state).toBe("remote-disabled");
    expect(report.remedy).toContain("serato.remote.enabled");
  });

  it("reports a missing installation instead of advertising nothing", () => {
    const report = checkSeratoSetup(input({ seratoInstalled: false, detectedVersion: null }));
    expect(report.state).toBe("not-installed");
    expect(report.remedy).toContain("_Serato_");
  });

  it("walks the remaining states in order: advertising, connection, pairing, decks", () => {
    expect(checkSeratoSetup(input({ advertised: false, advertisedPort: null }) ).state).toBe("not-advertising");
    expect(checkSeratoSetup(input({ connected: false })).state).toBe("no-connection");
    expect(checkSeratoSetup(input({ authenticated: false })).state).toBe("unauthenticated");
    expect(checkSeratoSetup(input({ deckUpdateHz: [0, 0, 0, 0] })).state).toBe("no-deck-data");
    const noConnection = checkSeratoSetup(input({ connected: false }));
    expect(noConnection.remedy).toContain("Serato Remote documentation");
    const noDecks = checkSeratoSetup(input({ deckUpdateHz: [0] }));
    expect(noDecks.remedy).toContain("load a track");
  });

  it("keeps a malformed-frame count visible in the healthy state", () => {
    const report = checkSeratoSetup(input({ rejectedFrames: 3 }));
    expect(report.state).toBe("receiving");
    expect(report.remedy).toContain("3 malformed frame(s) rejected");
  });
});

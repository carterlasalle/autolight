// T-SER-01 setup assistant proof: each missing precondition names its own
// next step, and the healthy state reports what is flowing.
import { describe, expect, it } from "vitest";
import { checkSeratoSetup, type SeratoSetupInput, type SeratoSetupState } from "./setup.js";

// One spelling for the fixture and the assertions (the app's advertised port
// and Bonjour service type).
const REMOTE_PORT = 53211;
const REMOTE_SERVICE = "_SeratoIOSRemote._tcp";

function input(over: Partial<SeratoSetupInput> = {}): SeratoSetupInput {
  return {
    remoteEnabled: true,
    seratoInstalled: true,
    detectedVersion: "3.3.5",
    advertised: true,
    advertisedPort: REMOTE_PORT,
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
    expect(advertising?.detail).toContain(REMOTE_SERVICE);
    expect(advertising?.detail).toContain(String(REMOTE_PORT));
    expect(report.steps.find((step) => step.id === "deck-rate")?.detail).toContain("58.2 Hz");
    expect(report.steps.every((step) => step.ok)).toBe(true);
  });

  it("names the Serato-side step when remote is disabled", () => {
    const report = checkSeratoSetup(input({ remoteEnabled: false }));
    expect(report.state).toBe("remote-disabled");
    expect(report.remedy).toContain("serato.remote.enabled");
    // The step table itself: full ids in order, exactly one failure.
    expect(report.steps.map((s) => s.id)).toEqual(["remote-enabled", "serato-installed", "advertising", "connection", "authentication", "deck-rate", "stream-health"]);
    expect(report.steps.filter((s) => !s.ok).map((s) => s.id)).toEqual(["remote-enabled"]);
  });

  it("reports a missing installation instead of advertising nothing", () => {
    const report = checkSeratoSetup(input({ seratoInstalled: false, detectedVersion: null }));
    expect(report.state).toBe("not-installed");
    expect(report.remedy).toContain("_Serato_");
  });

  it("resolves contradictory inputs by the step ladder order", () => {
    // The first failing step wins: remote-enabled beats installation, an
    // uninstalled Serato beats advertising, and connection beats pairing.
    expect(checkSeratoSetup(input({ remoteEnabled: false, seratoInstalled: false, advertised: false, advertisedPort: null })).state).toBe("remote-disabled");
    expect(checkSeratoSetup(input({ seratoInstalled: false, detectedVersion: null, advertised: false, advertisedPort: null })).state).toBe("not-installed");
    expect(checkSeratoSetup(input({ connected: false, authenticated: false })).state).toBe("no-connection");
  });

  it("walks the remaining states in order: advertising, connection, pairing, decks", () => {
    const cases: [Partial<SeratoSetupInput>, SeratoSetupState, string][] = [
      [{ advertised: false, advertisedPort: null }, "not-advertising", "advertising"],
      [{ connected: false }, "no-connection", "connection"],
      [{ authenticated: false }, "unauthenticated", "authentication"],
      [{ deckUpdateHz: [0, 0, 0, 0] }, "no-deck-data", "deck-rate"],
      // A short array (fewer decks than slots) follows the same ladder.
      [{ deckUpdateHz: [0] }, "no-deck-data", "deck-rate"],
    ];

    for (const [over, state, failedId] of cases) {
      const report = checkSeratoSetup(input(over));

      expect(report.state, JSON.stringify(over)).toBe(state);
      // Exactly the failing step carries ok false, so a wrong step cannot
      // masquerade as the cause.
      expect(report.steps.filter((s) => !s.ok).map((s) => s.id), JSON.stringify(over)).toEqual([failedId]);
    }

    // Failure remedies are the failing step's full detail, pinned whole.
    const noConnection = checkSeratoSetup(input({ connected: false }));

    expect(noConnection.remedy).toBe("no connection from Serato yet: open Serato DJ Pro on the same machine or network and enable the Remote connection (Serato's Serato Remote documentation)");
    const noDecks = checkSeratoSetup(input({ deckUpdateHz: [0] }));

    expect(noDecks.remedy).toBe("1 deck(s) reporting but idle at 0 Hz; load a track and press play in Serato DJ Pro");
  });

  it("keeps a malformed-frame count visible in the healthy state", () => {
    const report = checkSeratoSetup(input({ rejectedFrames: 3 }));
    expect(report.state).toBe("receiving");
    expect(report.remedy).toContain("3 malformed frame(s) rejected");
  });
});

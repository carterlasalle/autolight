// Serato setup assistant (T-SER-01). Verifies, in plain steps, what the owner
// must enable for the Remote connection and what the app then observes:
// advertisement status (`_SeratoIOSRemote._tcp`), the TCP connection from
// Serato DJ Pro, the Authorize/Pair handshake, and the per-deck update rate.
//
// It never changes Serato's settings, never writes to the library and never
// installs anything; it reports what to do and verifies the result, exactly
// like the rkbx_link assistant does for its sidecar (T-LIVE-04).
//
// The Serato-side step is version-dependent in Serato's own UI, so the text
// names the connection by what it is (the Remote connection) and points at
// Serato's documentation; HW-SER-01 records the exact menu walkthrough for the
// installed version and replaces this wording if it differs.

export interface SeratoSetupInput {
  /** `serato.remote.enabled` (default true). */
  remoteEnabled: boolean;
  /** Serato DJ Pro found on this machine (`detectSeratoInstallation`). */
  seratoInstalled: boolean;
  detectedVersion: string | null;
  /** The Bonjour advert is up (the provider reached its `ready` event). */
  advertised: boolean;
  advertisedPort: number | null;
  instanceName: string | null;
  /** A TCP connection from Serato has arrived. */
  connected: boolean;
  /** The Authorize/Pair handshake completed on a stream. */
  authenticated: boolean;
  /** Playhead updates per second, one entry per deck that reported. */
  deckUpdateHz: readonly number[];
  /** Frames rejected as malformed so far. */
  rejectedFrames: number;
}

export interface SeratoSetupStep {
  id: string;
  ok: boolean;
  detail: string;
}

export type SeratoSetupState =
  | "receiving"
  | "remote-disabled"
  | "not-installed"
  | "not-advertising"
  | "no-connection"
  | "unauthenticated"
  | "no-deck-data";

export interface SeratoSetupReport {
  state: SeratoSetupState;
  steps: SeratoSetupStep[];
  remedy: string;
}

const SERATO_REMOTE_DOC = "Serato's Serato Remote documentation";

export function checkSeratoSetup(input: SeratoSetupInput): SeratoSetupReport {
  const steps: SeratoSetupStep[] = [];
  steps.push({
    id: "remote-enabled",
    ok: input.remoteEnabled,
    detail: input.remoteEnabled
      ? "serato.remote.enabled is on"
      : "serato.remote.enabled is off in Settings; the provider does not start",
  });
  steps.push({
    id: "serato-installed",
    ok: input.seratoInstalled,
    detail: input.seratoInstalled
      ? `Serato DJ Pro detected${input.detectedVersion === null ? "" : ` (${input.detectedVersion})`}`
      : "no Serato DJ Pro installation found; install Serato DJ Pro or point library.serato.root at its _Serato_ folder",
  });
  steps.push({
    id: "advertising",
    ok: input.advertised,
    detail: input.advertised
      ? `advertising _SeratoIOSRemote._tcp as "${input.instanceName ?? "unknown"}" on port ${input.advertisedPort ?? 0}`
      : `not advertising yet; the app publishes _SeratoIOSRemote._tcp itself and Serato connects in, so nothing is needed on this side once serato.remote.enabled is on`,
  });
  steps.push({
    id: "connection",
    ok: input.connected,
    detail: input.connected
      ? "Serato DJ Pro opened the TCP connection"
      : `no connection from Serato yet: open Serato DJ Pro on the same machine or network and enable the Remote connection (${SERATO_REMOTE_DOC})`,
  });
  steps.push({
    id: "authentication",
    ok: input.authenticated,
    detail: input.authenticated
      ? "Authorize/Pair handshake completed and status topics are subscribed"
      : "no completed pairing yet; Serato completes it automatically after connecting, so a stream that connects but never pairs means Serato is still starting up",
  });
  const decks = input.deckUpdateHz.filter((hz) => hz > 0);
  steps.push({
    id: "deck-rate",
    ok: decks.length > 0,
    detail: decks.length > 0
      ? `${decks.length} deck(s) reporting, ${decks.map((hz) => hz.toFixed(1)).join(", ")} Hz`
      : "no deck updates yet; load a track on a deck in Serato DJ Pro",
  });
  const failed = steps.find((step) => !step.ok);
  if (!failed) {
    const rejected = input.rejectedFrames === 0 ? "" : `, ${input.rejectedFrames} malformed frame(s) rejected`;
    return { state: "receiving", steps, remedy: `Remote state is flowing${rejected}` };
  }
  const state: SeratoSetupState =
    failed.id === "remote-enabled" ? "remote-disabled"
    : failed.id === "serato-installed" ? "not-installed"
    : failed.id === "advertising" ? "not-advertising"
    : failed.id === "connection" ? "no-connection"
    : failed.id === "authentication" ? "unauthenticated"
    : "no-deck-data";
  return { state, steps, remedy: failed.detail };
}

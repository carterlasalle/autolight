# Rekordbox Protocol

As-built live strategy: fusion over seven providers (ADR-001, ADR-002,
DS-01, SPEC §§6–9).

## Provider priority

`live.provider` (default `fusion`; config `packages/config`). Authority
order (`DEFAULT_FUSION_AUTHORITY`, `packages/rekordbox-live/src/`):

1. `lighting-ipc` — SoundSwitch Lighting IPC (§§8–9), sample-accurate.
   Dark until the owner runs the capture matrix (see below); provider
   reports `MISSING` honestly until real captures land (`lighting-ipc.ts`).
2. `memory-cleanroom` — opt-in elevated helper with consent flow + audit
   log (T-SEC-05); the app never performs re-sign or elevation itself
   (`memory-reader.ts`).
3. `rkbx-osc` — user-installed GPL sidecar `rkbx_link`, never bundled
   (SPEC §112). Default bind `127.0.0.1:4460` (`live.rkbx.oscBind`).
4. `prolink` — Node Virtual-CDJ: keep-alive → 50000, beat capture on
   50001, status queries on 50002 (per Deep Symmetry dysentery analysis;
   MIT supertimecodeconverter patterns). Beat-accurate with a link peer;
   Rekordbox-alone yields master BPM only. Needs a link peer on LAN.
5. `composite-flx4` — DDJ-FLX4 board (`packages/controller-flx4/`); MIDI
   is secondary truth only (§11).
6. `ax` — main-process poll (~1 Hz) of deck elapsed fields →
   `secondsToBeat` via PQTZ grid. Accuracy ±1 beat; pauses/seeks snap via
   `isSeek`. Falls back to preview when unreadable.
7. `os2l` — Serato-style OS2L feed where present.

`preview` mode: committed ANLZ fixtures → grid + plan + venue preview,
no sync, no Govee until discovery.

Fusion (`fusion.ts`): per-field authority ranking, freshness window
(`live.provider.staleMs`), hysteresis
(`live.fusion.disagreeBeats`, `live.fusion.switchHoldMs`), per-field
source + quality labels, disagreement diagnostics. Every provider emits
the same `ProviderDeckState` (`providers.ts`); downstream never branches
on provider. Generation contract: increment on load/unload/replacement,
never emit a prior-generation field after.

## Capture matrix (§9.3)

Procedure + fixture format: `docs/rekordbox-capture.md`. Runner writes
`protocol-fixtures/rekordbox/<ver>/<os>/<action>/capture.json`; replay
harness (`replayFixture`) decodes to `DeckState[]` and asserts against
`expectedEvents`. 2026-09-29 live probe (7.2.10, no SoundSwitch):
lighting path dark; PRO DJ LINK sockets live but silent without a peer;
mDNS silent; committed fixtures `load-deck-1`, `load-deck-2`,
`both-decks-loaded`.

## §120 coverage

Items 1–13 (live follow) are proven per provider in sim (contract suite
`contract-suite.ts`, provider tests); live demonstration against
Rekordbox 7.2.19+ needs the owner rig (SoundSwitch 2.11+ install or link
peer on LAN). DB access READ ONLY (§4.1).

## Follow mode setting

Setup tab `followMode`: `preview` | `ax-beat` | `prolink` | `soundswitch`
(ADR-001). Mode only widens the playhead source; planner/renderer/mixer
unchanged.

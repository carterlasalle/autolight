# Rekordbox Lighting protocol capture log (§9)

Reference env: Rekordbox 7.2.19+, SoundSwitch 2.11+, DDJ-FLX4, macOS + Windows.
Enable Rekordbox → Preferences → Extensions → Lighting → SoundSwitch.

## Surfaces to enumerate (§9.2)

macOS:

```sh
lsof -i -P | grep -i -E "rekordbox|soundswitch|dmx"
nettop -m tcp -m udp
log stream --predicate 'process == "rekordbox"'
sudo fs_usage -f network rekordbox
```

Windows: Resource Monitor → Network, `netstat -ano -p TCP/UDP`, ETW.

mDNS: `_soundswitch._tcp`, Rekordbox lighting advertisements.

## Capture matrix (§9.3)

One action per capture, from idle baseline. Both single-deck and dual-deck,
crossfader left/center/right, tempo match + mismatch.

Required actions: launch, enable-lighting, load-deck-1, load-deck-2, play,
pause, cue, seek, jog-fwd, jog-back, scratch, pitch-plus-1, pitch-minus-1,
sync-on, sync-off, hotcue, autoloop, manual-loop, loop-resize, loop-roll,
loop-exit, chfader, crossfader, master-change, unload, replace.

## Fixture format (§9.4)

Each action: `protocol-fixtures/rekordbox/<ver>/<os>/<action>/capture.json`:

```json
{
  "rekordboxVersion": "7.2.19",
  "platform": "macos",
  "action": "crossfader-left-to-right",
  "capture": "<base64 raw frames>",
  "expectedEvents": [{ "deckId": 1, "playing": true }]
}
```

Replay harness (`@autolight/rekordbox-live` `replayFixture`) decodes captures
to `DeckState[]` and asserts deep-equal against `expectedEvents`.

## Live capture log — 2026-09-29 (Rekordbox 7.2.10.0333, macOS, no SoundSwitch)

Rekordbox 7.2.10 launched with two SoundCloud tracks loaded (paused at 0.0);
SoundSwitch is NOT installed, so the Lighting IPC path (§8-9) stays dark.
What was proven live instead:

- Agent HTTP (Electron `rb-cloud-agent` 3.1.4 on :30001): Express 404s on
  `/`, `/api/*`, `/api/data/*` — cloud-sync API, not a transport surface.
- PRO DJ LINK sockets live: TCP *:55000 + *:55002, UDP *:50000/50001/50002 —
  silent with no CDJ/hardware peer (ports accept, no banner, no beacons).
- mDNS: no `_soundswitch._tcp`, no `_rekordbox._tcp` advertisements.
- Library DB (read-only): resolved both loaded tracks to IDs + ANLZ paths.
- ANLZ: deck 2 Homecoming EXT parses (22 PSSI phrases); deck 1 Nice For What
  EXT is a firmware variant pyrekordbox rejects (ConstError u1) — extractor
  now degrades to DAT grid-only instead of throwing.
- Serato GEOB BeatGrid: reverse-engineered (ver 0x01, BE f32 pos + BPM),
  verified against ScratchBeat4 (85 BPM) + ScratchBeat5 (88 BPM).

Committed fixtures (`protocol-fixtures/rekordbox/7.2.10/macos/`):
`load-deck-1`, `load-deck-2`, `both-decks-loaded` — DeckStates with native
IDs, titles, effective BPMs, grids verified against ANLZ.

Still blocked on user: install SoundSwitch 2.11+ → enable Lighting →
re-run this matrix to capture the actual Lighting IPC transport.

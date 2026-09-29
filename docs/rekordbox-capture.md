# Rekordbox Lighting protocol capture plan (§9)

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

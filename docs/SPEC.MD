# Automated DJ Lighting Engine

## Complete Product / Engineering / Implementation Specification

**Status:** proposed implementation contract  
**Primary DJ stack:** Rekordbox + DDJ-FLX4  
**Secondary DJ stack:** Serato DJ Pro + DDJ-FLX4  
**Primary lighting hardware:** Govee H6076, H1A45, and compatible RGB/RGBIC devices  
**Target platforms:** macOS and Windows  
**Frontend/runtime stack:** Electron + React + TypeScript  
**Package manager:** Yarn  
**Analysis stack:** Python managed exclusively with `uv`  
**Product model:** local-first, offline-capable during performances  
**Core requirement:** generate and perform lighting that looks intentionally programmed by a competent lighting designer, not like an audio visualizer.

---

# 1. Product Definition

The application is a fully automated lighting designer and show-control engine for DJs.

Its job is to:

1. Know exactly which tracks are loaded on each deck.
2. Know where each deck is inside its track.
3. Understand the DJ software's actual beatgrid.
4. Analyze the complete song before performance.
5. Understand musical structure and important musical events.
6. Generate a coherent lighting score for the entire song.
7. Adapt that score to the physical lighting rig.
8. Follow DJ manipulation in real time.
9. Mix the lighting of two decks during transitions.
10. Render synchronized frames to multiple Govee RGBIC devices and their independently controllable segments.
11. React intelligently to musical micro-events without allowing live audio analysis to take over the show.
12. Continue behaving coherently during loops, seeks, hot cues, tempo changes, scratching, deck switches, network interruptions, device reconnections, and partial metadata availability.

The product is fundamentally:

```text
DJ SOFTWARE + TRACK FILES
             │
             ▼
      MUSICAL UNDERSTANDING
             │
             ▼
       LIGHTING DESIGNER
             │
             ▼
        LIGHTING SCORE
             │
             ▼
       LIVE SHOW ENGINE
             │
             ▼
      FIXTURE RENDERER
             │
             ▼
         GOVEE RIG
```

It is **not**:

```text
microphone
   ↓
FFT
   ↓
bass loud?
   ↓
flash random color
```

---

# 2. Product Principles

## 2.1 Future knowledge first

The system must exploit knowledge of the whole song whenever the track is available.

If a drop happens on beat 257, the system knows that while the track is still on beat 225.

That enables:

- intentional build progression;
- darkness before impact;
- palette evolution;
- phrase-level repetition;
- controlled strobe deployment;
- visual foreshadowing;
- second-drop variation;
- restrained breakdowns;
- meaningful outros.

A reactive analyzer can recognize a drop after it arrives.

A lighting designer needs to know it is coming.

---

## 2.2 The DJ beatgrid is timing truth

Where the DJ software provides a beatgrid, that grid wins.

ML beat trackers are useful as:

- validation;
- confidence signals;
- downbeat correction suggestions;
- structure analysis inputs.

They do not silently replace the grid against which Rekordbox or Serato is actually operating.

Canonical timing is represented in **beats**, not wall-clock seconds.

---

## 2.3 Audio analysis describes music; it does not direct the show

Music analysis produces evidence:

```text
bass energy
drum energy
vocal probability
onset density
spectral novelty
section boundary
silence
energy slope
downbeat probability
```

The show planner turns that evidence into lighting decisions.

No DSP function can directly issue:

```text
STROBE()
```

That separation is mandatory.

---

## 2.4 Lighting is hierarchical

Decisions exist simultaneously at multiple time scales:

```text
whole track
    ↓
section
    ↓
phrase
    ↓
bar
    ↓
beat
    ↓
sub-beat
```

Whole-track decisions control identity.

Section decisions control looks.

Phrase decisions control progression.

Bars create variation.

Beats create rhythm.

Sub-beats create occasional high-speed accents.

---

## 2.5 Darkness is a lighting state

Black is not the absence of an effect.

It is one of the strongest effects available.

The engine explicitly models:

- full blackout;
- partial blackout;
- spatial negative space;
- pre-impact darkness;
- alternating darkness;
- low-intensity holds;
- delayed reveals.

---

## 2.6 Repetition must have musical purpose

If a motif returns because a chorus returns, that is good repetition.

If a chase repeats because `random.choice()` selected it again, that is bad repetition.

The planner maintains visual memory across the track.

---

# 3. Research Conclusions and Reuse Strategy

## 3.1 `chrisle/serato-connect`

**Use directly.**

MIT licensed.

The source provides substantially more than simple “now playing” metadata.

Its Serato Remote implementation handles:

- Bonjour advertisement using `_SeratoIOSRemote._tcp`;
- inbound connection initiated by Serato;
- OSC 1.1;
- Serato's custom TCP delimiter;
- MD5 challenge/response authorization;
- deck metadata;
- live playhead;
- play rate;
- effective BPM;
- autoloop state;
- loop-roll state;
- upfaders;
- crossfader;
- four-deck state;
- field coalescing when a track changes.

Serato live transport and Serato disk metadata complement each other.

The network interface supplies:

```text
track identity
playhead
play rate
effective BPM
playing/stopped
loop state
upfader
crossfader
```

Serato's files supply:

```text
beatgrid
tempo regions
cue points
loops
track metadata
crates
library
```

This is the production Serato source.

No duplicate implementation should be written.

---

# 4. Rekordbox Architecture

Rekordbox is the primary platform.

It has two fundamentally different data planes:

```text
Rekordbox static/library intelligence
+
Rekordbox live deck state
```

They are intentionally separate modules.

---

## 4.1 Rekordbox library plane

Use:

- `chrisle/rekordbox-connect`
- selected parsing logic from `chrisle/alphatheta-connect`
- `pyrekordbox` in analysis/testing where useful

`rekordbox-connect` already solves:

- locating Rekordbox's database;
- finding `options.json`;
- deriving/decrypting the SQLCipher password;
- readonly SQLCipher access;
- WAL-aware reading;
- track metadata;
- playlists;
- history;
- track IDs;
- paths.

The production application never writes Rekordbox's database.

Required rule:

```text
Rekordbox DB access = READ ONLY
```

---

# 5. Rekordbox ANLZ Extraction

This is one of the highest-value data sources in the system.

For each Rekordbox track, resolve:

```text
master.db row
   ↓
AnalysisDataPath
   ↓
ANLZ0000.DAT
ANLZ0000.EXT
ANLZ0000.2EX
```

Extract every useful known field.

## 5.1 Beat grid

From `PQTZ`:

```ts
interface NativeBeat {
  index: number;
  beatInBar: 1 | 2 | 3 | 4;
  sourceTimeMs: number;
  bpm: number;
}
```

This becomes the canonical `BeatGrid`.

---

## 5.2 PSSI phrase structure

Rekordbox already does substantial musical structure analysis.

Extract:

```text
mood
bank
endBeat
phrase start beat
phrase kind
phrase type
fill flag
fill beat
```

Normalize the native labels while retaining the raw representation.

Examples:

High-energy classification:

```text
Intro
Up
Down
Chorus
Outro
```

Medium/low classifications contain forms of:

```text
Intro
Verse
Bridge
Chorus
Outro
```

The raw PSSI object must remain available because details such as fill positions and subtype data can become useful to the show planner.

Do not throw information away during normalization.

---

## 5.3 Extended cues

From `PCO2`:

```text
cue position
loop position
cue type
hotcue number
RGB cue color
comment
loop quantization
```

Cue comments may provide useful user-authored semantic hints.

---

## 5.4 Waveform data

Parse:

```text
PWAV
PWV2
PWV3
PWV4
PWV5
PWV6
PWV7
```

Especially important:

```text
PWV6  three-band waveform preview
PWV7  detailed three-band waveform
```

These are useful precomputed musical features and should be retained.

---

## 5.5 Vocal information

Read `PWVC` where present.

Rekordbox's vocal analysis becomes another evidence channel.

---

# 6. Rekordbox Live Transport

This is a production-critical subsystem.

```ts
interface DJLiveProvider {
  id: string;
  source: "rekordbox" | "serato";

  start(): Promise<void>;
  stop(): Promise<void>;

  getDecks(): readonly DeckState[];

  onDeckState(listener: (state: DeckState) => void): Unsubscribe;
  onConnection(listener: (state: ProviderStatus) => void): Unsubscribe;
}
```

No downstream component may know how Rekordbox live state was obtained.

---

# 7. Rekordbox Provider Priority

The runtime uses providers in this order:

```text
1. Rekordbox Lighting Provider
2. Rekordbox Composite FLX4 Provider
3. no-script adaptive fallback
```

The first two are both part of the implementation.

---

# 8. Rekordbox Lighting Provider

## 8.1 Why it is the primary target

Rekordbox 7.2.19 introduced direct SoundSwitch support.

The official integration supports:

- scripted tracks;
- automated scripts;
- Autoloops;
- static looks;
- synchronized playback;
- mixer/fader integration.

Therefore a real-time data path exists between Rekordbox and a lighting application.

Our provider must implement the same required state without depending on SoundSwitch at runtime.

---

# 9. Rekordbox Lighting Protocol Acquisition

This is an explicit implementation work package.

It is not optional.

## 9.1 Reference environment

Capture using:

```text
Rekordbox 7.2.19+
SoundSwitch 2.11+
DDJ-FLX4
macOS
Windows
```

Enable:

```text
Rekordbox
Preferences
→ Extensions
→ Lighting
→ SoundSwitch
```

---

## 9.2 Enumerate communication surfaces

On macOS inspect:

```text
TCP listeners/connections
UDP
mDNS/Bonjour
Unix sockets
local WebSockets
localhost HTTP
IPC pipes
process file descriptors
Rekordbox logs
SoundSwitch logs
```

Tools include:

```text
lsof
nettop
tcpdump
Wireshark
log stream
fs_usage
```

Windows equivalent instrumentation must also be used.

---

## 9.3 Capture matrix

Start from an idle baseline.

Perform exactly one user action at a time and record the transport.

Required actions:

```text
launch Rekordbox
launch SoundSwitch
enable Lighting
load deck 1
load deck 2
play
pause
cue
seek
jog forward
jog backward
scratch
pitch +1%
pitch -1%
SYNC on
SYNC off
hot cue
auto loop
manual loop
loop length change
loop roll
exit loop
channel fader movement
crossfader movement
master deck change
track unload
track replacement
```

Repeat with:

```text
one deck
two decks
both decks playing
crossfader center
hard left/right
tempo mismatch
tempo sync
```

---

## 9.4 Protocol fixture format

Every capture becomes a committed fixture.

```text
protocol-fixtures/
  rekordbox/
    7.2.19/
      macos/
        handshake/
        load-deck-1/
        play/
        seek/
        loop/
        crossfader/
      windows/
        ...
```

Each fixture contains:

```json
{
  "rekordboxVersion": "7.2.19",
  "platform": "macos",
  "action": "crossfader-left-to-right",
  "capture": "...",
  "expectedEvents": [...]
}
```

---

## 9.5 Decoder requirements

The provider must recover, at minimum:

```ts
interface DeckState {
  source: "rekordbox" | "serato";

  deckId: number;

  track: TrackIdentity | null;

  playing: boolean;

  playheadSeconds: number;

  playRate: number;

  effectiveBpm: number | null;

  loop: {
    active: boolean;
    startSeconds: number | null;
    endSeconds: number | null;
    beatLength: number | null;
  };

  channelFader: number | null;
  crossfader: number | null;

  master: boolean | null;

  receivedAtNs: bigint;
}
```

If the official stream contains richer information, retain it.

Again: don't discard unknown fields.

Store raw decoded messages in diagnostic mode.

---

# 10. Rekordbox Composite FLX4 Provider

A second complete provider exists so Rekordbox integration is not architecturally dependent on a single undocumented transport.

It combines:

```text
Rekordbox library
+
DDJ-FLX4 MIDI
+
Rekordbox beatgrid
+
Ableton Link where enabled
+
track-open observation
+
audio timing correction
```

This provider is specifically designed around the stated FLX4 setup.

---

# 11. FLX4 Telemetry

The FLX4 has an official MIDI message map.

Build:

```text
packages/controller-flx4/
```

Observe the controller non-exclusively.

Map:

```text
PLAY
CUE
SHIFT
jog
tempo fader
SYNC
loop buttons
beat length
performance pads
hot cues
channel faders
crossfader
EQ
color/filter controls
browse/load controls
```

Use FLX4 telemetry as a **secondary truth source**.

It must never override a stronger DJ-software playhead simply because it saw a physical button.

The telemetry is valuable for things Serato/Rekordbox don't expose and for expressive cues.

Examples:

- large filter sweep → reduce density;
- pad roll → emphasize spatial subdivision;
- channel fader rising → introduce incoming deck visually;
- loop shrink → increase motion cadence;
- release loop → impact opportunity.

No random reaction directly to the MIDI event.

It informs the director.

---

# 12. Canonical Track Identity

Every track receives a durable internal `TrackId`.

```ts
interface TrackIdentity {
  id: string;

  sourceIds: {
    rekordboxId?: string;
    seratoPath?: string;
  };

  canonicalPath?: string;

  title?: string;
  artist?: string;

  fileHash?: string;
  pcmFingerprint?: string;
}
```

Resolution hierarchy:

```text
native library ID
+
canonical path
+
file identity
+
decoded-audio fingerprint
```

The decoded fingerprint protects against:

```text
file renamed
folder moved
metadata tags changed
```

Track identity must not be based solely on title/artist strings.

---

# 13. Analysis Worker

Heavy music understanding happens outside the show runtime.

Directory:

```text
analysis/
  pyproject.toml
  uv.lock
  src/autolight_analysis/
```

Tooling:

```text
uv sync
uv run ...
uv run pytest
```

No pip workflow.

---

# 14. Analysis Process Isolation

The Electron application starts a dedicated Python worker process.

Communication uses framed JSON over stdio for commands and status.

Large numerical artifacts are written to cache files rather than serialized over IPC.

Example request:

```json
{
  "type": "analyze",
  "trackId": "...",
  "audioPath": "...",
  "nativeMetadataPath": "..."
}
```

Example response:

```json
{
  "type": "complete",
  "trackId": "...",
  "artifactPath": "..."
}
```

If the analysis process crashes:

- playback continues;
- currently compiled shows are unaffected;
- the worker is restarted;
- interrupted analysis jobs are requeued.

PyTorch never runs inside the live show process.

---

# 15. Audio Normalization

Decode every local source through the same FFmpeg pipeline before ML/DSP.

Reason: decoder differences can introduce tens of milliseconds of timing error.

Create canonical analysis audio:

```text
44.1 kHz
floating-point PCM
stereo canonical decode
plus mono analysis stream where required
```

The original file remains untouched.

---

# 16. Structural ML

Use `openmirlab/all-in-one-infer`.

It provides:

```text
tempo
beats
downbeats
section boundaries
section labels
bass stem
drum stem
vocal stem
other stem
100 Hz activations
embeddings
```

Use its persistent session API so models don't repeatedly reload.

On Apple Silicon the current implementation intentionally does not support MPS.

Therefore:

```text
macOS → CPU analysis
CUDA machine → CUDA
```

This is acceptable because full-song analysis is intentionally off the live rendering path.

Native Rekordbox PSSI data means the user can still get immediate structural intelligence while the deeper analysis finishes.

---

# 17. Beat This

Use `CPJKU/beat_this` as an independent metrical analyzer.

Output:

```text
beats
downbeats
confidence evidence
```

Purpose:

```text
cross-check native grid
cross-check All-In-One
identify suspicious native grid
improve downbeat confidence
```

Do not silently alter the DJ grid.

If substantial disagreement exists, mark:

```text
GRID_WARNING
```

in Track Inspector.

---

# 18. DSP Features

Compute deterministic numerical features from the canonical audio and stems.

At a minimum:

```text
integrated loudness proxy
short-term RMS
bass energy
low-mid energy
mid energy
high energy
spectral centroid
spectral rolloff
spectral flux
onset strength
onset density
zero-crossing rate where useful
kick-like transient energy
snare-like transient energy
bass-stem RMS
drum-stem RMS
vocal-stem RMS
other-stem RMS
silence probability
novelty
dynamic range
energy derivative
```

Store frame-level features at a sensible resolution, then aggregate to:

```text
subbeat
beat
bar
phrase
```

---

# 19. Native/ML Fusion

Native DJ data has explicit priority.

```text
TIMING

Rekordbox/Serato beatgrid
        >
Beat This / All-In-One grid
```

Structure is fused.

```text
PSSI phrase structure
+
All-In-One structure probabilities
+
musical feature boundaries
+
event detector
```

Every derived result carries provenance.

Example:

```json
{
  "type": "build",
  "startBeat": 97,
  "endBeat": 128,
  "confidence": 0.91,
  "evidence": [
    "rekordbox:PSSI:Up",
    "allin1:boundary",
    "energy:rising",
    "drum_density:rising"
  ]
}
```

---

# 20. Track Model

The final analysis artifact is immutable and versioned.

```ts
interface TrackModel {
  schemaVersion: number;
  analyzerVersion: string;

  identity: TrackIdentity;

  durationSeconds: number;

  metadata: TrackMetadata;

  beatGrid: BeatGrid;

  nativeAnalysis: {
    rekordbox?: RekordboxAnalysis;
    serato?: SeratoAnalysis;
  };

  sections: TrackSection[];

  phrases: Phrase[];

  frameFeatures: FeatureArtifactRef;

  beatFeatures: BeatFeature[];

  musicalEvents: MusicalEvent[];

  analysisCoverage: AnalysisCoverage;
}
```

---

# 21. Section Vocabulary

Normalize structures into:

```text
intro
verse
prechorus
build
drop
chorus
breakdown
bridge
instrumental
solo
outro
transition
unknown
```

Preserve the original source label alongside the normalized value.

---

# 22. Important Musical Events

The analyzer must explicitly find:

```text
major section transition
minor phrase transition
build start
build intensification
predrop
drop
fake drop
drop continuation
breakdown
bass re-entry
drum re-entry
vocal entry
vocal exit
fill
pause
silence
large transient
final hit
outro release
```

These become the vocabulary consumed by the lighting designer.

---

# 23. Build Detection

For each canonical downbeat candidate `b`, evaluate windows such as:

```text
previous 8 beats
previous 16 beats
previous 32 beats
```

Features include:

```text
energy slope
drum-density slope
high-frequency slope
spectral centroid slope
onset-density slope
bass movement
PSSI Up phrase
structural boundary confidence
harmonic tension proxy
```

Return:

```ts
interface BuildEvent {
  startBeat: number;
  impactBeat: number | null;
  strength: number;
  confidence: number;
}
```

---

# 24. Drop Detection

A drop candidate is strongest when several independent signals converge.

Inputs:

```text
downbeat
preceding build
bass-stem jump
drum-stem jump
overall energy jump
onset peak
novelty
preceding dip/silence
section boundary
PSSI transition
```

No single threshold may define a drop.

The planner needs confidence and strength separately.

---

# 25. Fake Drop Detection

Detect the common case:

```text
BUILD
↓
expected impact point
↓
silence / vocal fake / held tension
↓
1–4 beats later
↓
actual impact
```

Represent both:

```text
fakeImpactBeat
actualImpactBeat
```

This allows the lighting engine to:

```text
black
hold
hold
WHAM
```

instead of firing the visual drop too early.

---

# 26. Show Planner

Package:

```text
packages/show-planner/
```

Input:

```text
TrackModel
VenueModel
ShowStyle
```

Output:

```text
ShowPlan
```

The planner does not send hardware frames.

---

# 27. Determinism

The same:

```text
track
+
planner version
+
style
+
venue capability class
```

must generate the same base show.

Use deterministic pseudo-randomness seeded from the track fingerprint.

This allows:

- reproducible previews;
- regression tests;
- manual edits;
- recognizable recurring motifs.

---

# 28. Whole-Song Visual Identity

Before programming individual beats, choose:

```text
primary palette
secondary palette
neutral accent
spatial motif
movement vocabulary
density baseline
contrast baseline
impact budget
darkness budget
```

Palette calculations use perceptual color space such as OKLCH/OKLab.

Do not interpolate colors naïvely in sRGB.

---

# 29. Color Story

A track should normally have:

```text
2–3 strong core colors
+
white/neutral impact color
```

rather than a rainbow every eight beats.

Color changes generally happen because:

```text
the musical section changed
the phrase changed
a motif is intentionally returning
```

not because a timer expired.

---

# 30. Lighting Hierarchy

## Track level

Controls identity and progression.

## Section level

Controls:

```text
brightness range
palette
spatial density
movement family
effect intensity ceiling
darkness
```

## Phrase level

Controls:

```text
variation
direction
progression
fixture participation
```

## Bar level

Controls:

```text
chase direction
alternation
small variations
```

## Beat level

Controls:

```text
pulses
bumps
hits
switches
```

## Sub-beat level

Reserved for:

```text
brief strobes
rapid rolls
impact textures
```

---

# 31. Semantic Lighting Primitives

Implement a stable primitive library.

Required primitives:

```text
StaticLook
GradientLook

Pulse
Bump
DecayHit

Alternate
Chase
Sweep
MirrorSweep
OutsideIn
InsideOut
Split
Wave

BuildRamp
PhraseTurn
FillAccent

Impact
WhiteHit
Blackout
Dip
Reveal

StrobeBurst
RollPattern

DropPattern
BreakdownLook
VocalFocus
OutroRelease
```

Primitives operate on abstract spatial groups.

Not device addresses.

---

# 32. Primitive Example

```ts
interface WhiteHitCue {
  type: "white-hit";

  startBeat: number;
  durationBeats: number;

  intensity: number;

  target: SpatialSelector;

  attack: number;
  release: number;

  priority: number;
}
```

No Govee API appears here.

---

# 33. Lighting State Layers

At any instant:

```text
Base Look
    ↓
Spatial Motion
    ↓
Beat Modulation
    ↓
Musical Accents
    ↓
Exclusive Impact Effects
    ↓
Live Reactive Overlay
    ↓
Manual Override
    ↓
Master Intensity
```

Each layer has explicit precedence.

---

# 34. Restraint Engine

This component is mandatory.

Maintain:

```text
lastBlackoutBeat
lastWhiteHitBeat
lastStrobeBeat
strobeDuty
lastPaletteChange
currentPatternFamily
patternRepeatCount
recentSpatialDirections
recentImpactTypes
sectionImpactCount
wholeTrackImpactCount
```

The planner can reject technically valid effects because using them would make the show worse.

Example:

```text
DROP DETECTED
white hit would fit musically
BUT
white hit fired four beats ago
→ use full-color impact instead
```

---

# 35. Contrast Engine

Large musical changes should create large visual contrast.

Examples:

### Breakdown

```text
low brightness
large dark areas
slow motion
few active segments
narrow palette
```

### Build

```text
gradually increasing fixture count
increasing spatial speed
increasing brightness
shorter movement period
controlled palette tension
```

### Final pre-drop beat

Possible:

```text
full blackout
```

### Drop

Possible:

```text
white impact
brief decay
full saturated reveal
high spatial movement
```

This is chosen based on event strength and recent effect history.

---

# 36. Drop Programming Example

Example generated score:

```text
BUILD begins: beat 225

225–232
  35% intensity
  cyan vertical sweep / 8 beats

233–240
  45%
  opposite sweep / 4 beats

241–248
  57%
  both floor lamps active
  back strip sparse

249–252
  68%
  mirrored 2-beat chase

253–256
  82%
  desaturate toward white
  1-beat chase

256–257
  blackout

257.00
  90ms RGB-white impact

257.18–259
  quantized burst

259+
  saturated full drop pattern
  cyan/magenta spatial alternation
```

The exact design is determined from the track.

This is illustrative of the structure, not a hardcoded recipe.

---

# 37. Repeated Sections

If Chorus 2 musically resembles Chorus 1:

Reuse its visual language.

Modify:

```text
direction
secondary color
density
participating fixtures
accent timing
```

The audience should subconsciously recognize the return.

---

# 38. Govee Venue Model

Package:

```text
packages/venue/
```

A Govee device is represented as a fixture with addressable cells.

```ts
interface Fixture {
  id: string;

  adapter: "govee";

  sku: string;
  hardwareId: string;

  topology: FixtureTopology;

  transform: SpatialTransform;

  cells: FixtureCell[];

  capabilities: FixtureCapabilities;

  calibration: FixtureCalibration;
}
```

---

# 39. Fixture Cell

```ts
interface FixtureCell {
  index: number;

  position: {
    x: number;
    y: number;
    z?: number;
  };

  order: number;

  tags: string[];
}
```

A cell can represent:

```text
one Govee logical segment
one high-resolution raw zone
```

depending on qualified hardware capability.

---

# 40. Venue Coordinates

Every segment lives in common normalized physical coordinates.

Example:

```text
x = 0     far left
x = 1     far right

y = 0     floor/front
y = 1     ceiling/back
```

Then:

```text
CHASE LEFT → RIGHT
```

works across multiple separate Govee products.

---

# 41. Fixture Semantic Groups

Support arbitrary groups.

Default useful groups:

```text
ALL
LEFT
RIGHT
CENTER
BACK
FRONT

VERTICALS
HORIZONTALS

PRIMARY
SECONDARY

ACCENT
AMBIENT
```

A fixture can belong to several.

---

# 42. H6076

The H6076 is an RGBICW floor lamp and supports segmented color control. Govee's current product material describes 14 segmented controls.

Do not hardcode 14 as an architectural assumption.

Discover capabilities from the actual unit.

Example physical mapping:

```text
13  top
12
11
10
 9
 8
 7
 6
 5
 4
 3
 2
 1
 0  bottom
```

The user confirms orientation during setup.

---

# 43. H1A45

The H1A45 is the 20m / 65.6-foot version of Govee Strip Light 2 and supports segmented RGBWWIC control.

Its effective segment topology must be discovered from the actual device because:

- product length matters;
- cut-to-fit state can matter;
- firmware can matter.

The system stores per-unit calibration.

---

# 44. Govee Transport

Use a pinned/vendor-controlled fork of:

```text
damient/govee-toolkit
```

Reasons:

- MIT;
- Rust core;
- Node binding;
- LAN;
- BLE;
- cloud capability support;
- raw local RGBIC streaming;
- segment-stream API;
- frame coalescing;
- existing DMX-oriented thinking;
- simulator infrastructure.

We do not reimplement Govee protocol independently unless qualification finds a bug.

---

# 45. Why a Fork Is Required

Upstream's verified device-profile table currently contains only a small number of specifically verified models.

Our required products:

```text
H6076
H1A45
```

must become first-class, tested profiles under our control.

We cannot ship while relying on “probably compatible.”

---

# 46. Local LAN Rendering

The critical Govee transport is its local UDP pathway.

Official-style LAN control uses:

```text
discovery request → multicast :4001
discovery response → :4002
device control → :4003
```

For high-rate segmented output, `govee-toolkit` implements the reverse-engineered `razer` channel.

Frame family:

```text
BB <length> <opcode> <payload> <xor>
```

Important opcodes include:

```text
B1  arm/disarm segment stream
B0  segment RGB stream
B4  zoned variant
B2  armed-state status
```

The app arms once.

It does **not** power-cycle the fixture between frames.

---

# 47. Blackout Behavior

A lighting blackout must be:

```text
segment RGB = 0,0,0
```

not:

```text
device power = OFF
```

Power commands can terminate the segment stream on some devices.

Therefore show-time blackout keeps the RGBIC channel armed.

---

# 48. White Hits

Fast “blinder” style white impacts use:

```text
RGB(255,255,255)
```

scaled by configured intensity.

Do not switch into global color-temperature mode for a 70ms hit because white-temperature commands can disarm the local segment channel.

---

# 49. Segment Intensity

LAN segmented transport gives local per-segment RGB but not true per-segment dimmer.

Therefore:

```text
segment intensity
```

is implemented through linear-light RGB scaling.

Example:

```text
desired:
RGB 255, 0, 90
intensity .30

renderer output:
linear-light scaled equivalent
```

Not naïve integer multiplication in gamma-compressed RGB.

---

# 50. Global Brightness

Global Govee brightness becomes a slow master-level tool.

Use for:

```text
venue master intensity
long section-level fades
setup
manual master
```

Do not rapidly modulate global brightness every beat.

Per-segment rhythmic intensity comes from rendered RGB.

---

# 51. Govee Stream Interface

Use the toolkit's high-throughput buffer interface.

Conceptually:

```ts
const stream = await device.openStream(...);

stream.setAll(frame);
```

Frames are sent as `Uint8Array`.

Avoid per-pixel JS→Rust calls.

The output loop is newest-state-wins.

If:

```text
frame N
frame N+1
frame N+2
```

are generated before hardware can send N+1:

discard N+1.

Never let latency grow by queueing stale visual frames.

---

# 52. Device Qualification Wizard

Every unknown or newly introduced Govee unit undergoes qualification.

Steps:

1. discover;
2. identify;
3. read SKU;
4. read firmware;
5. verify power;
6. verify global brightness;
7. verify RGB;
8. verify local RGBIC stream;
9. determine logical segment count;
10. determine segment order;
11. verify reverse orientation;
12. determine arm settle delay;
13. benchmark stable output frequency;
14. measure visual latency;
15. verify reconnect behavior;
16. save calibration.

Calibration key:

```text
hardware ID
+
SKU
+
firmware
```

If firmware changes, mark the device:

```text
REQUALIFICATION REQUIRED
```

until essential local-stream tests pass.

---

# 53. Segment Resolution

Three useful resolutions:

```text
logical
grouped
native/high-resolution
```

Default automatically selects the highest resolution that:

- is confirmed;
- remains stable;
- meets the required refresh target.

More segments are not automatically better.

A 200-zone stream dropping half its frames is worse than a stable 40-zone stream.

---

# 54. Per-Device Performance Characterization

Store:

```ts
interface FixtureCalibration {
  segmentCount: number;

  maxStableFps: number;

  expectedLatencyMs: number;

  armSettleMs: number;

  orientation: "forward" | "reverse";

  gamma: number;

  brightnessCeiling: number;

  firmwareVersion: string;
}
```

Different units of the same SKU may have different latency.

---

# 55. Latency Compensation

Each fixture has its own latency estimate.

The renderer computes:

```text
sampleBeat =
showClockBeat +
fixtureExpectedLatency
```

converted through current deck tempo.

So a slower fixture receives its impact command earlier than a faster fixture.

Goal:

```text
visible impact
```

arrives simultaneously across the rig.

---

# 56. Show Runtime

Package:

```text
packages/show-runtime/
```

Runs in its own Node worker thread.

It must not share the renderer thread with React.

Clock:

```text
process.hrtime.bigint()
```

Use precise monotonic timing.

---

# 57. State Estimator

DJ transport messages are discrete observations.

Between them, estimate position continuously.

For a deck observation:

```text
reported source position = P
received at = T
playRate = R
```

At time `now`:

```text
estimatedSourcePosition =
P + (now - T) * R
```

when playing.

Small discrepancies are corrected smoothly.

Large discrepancies are treated as transport events.

---

# 58. Seek Detection

If observed playhead differs from predicted playhead beyond threshold:

```text
SEEK
```

Immediately:

1. reset PLL/interpolator;
2. recompute fractional beat;
3. reconstruct ShowPlan state at that beat;
4. cancel transient cues that belonged to the abandoned location;
5. output correct new state.

No replaying all prior cues.

Show plans are random-access state functions.

---

# 59. Loop Handling

Loops must not confuse the score cursor.

The source timeline remains the track timeline.

If:

```text
beats 129–137
```

are looped:

the show repeatedly evaluates that region.

Transient state is loop-aware.

A repeating loop can use deterministic traversal variation:

```text
pass 1 → variation A
pass 2 → variation B
pass 3 → variation A
```

while preserving the section's visual identity.

---

# 60. Tiny Loop / Roll Handling

Very short loop rolls can become intentional rhythmic special effects.

Example:

```text
1/2
1/4
1/8
1/16
```

But hardware refresh is checked first.

If the physical fixtures cannot accurately represent requested sub-beat toggling:

degrade to:

```text
brightness pulse
spatial contraction
single impact
```

rather than output irregular strobe timing.

---

# 61. Reverse and Scratch

If the provider supplies negative play-rate or reverse transport:

the timeline follows source position backward.

During scratch:

do not rapidly jump the whole lighting design around the song.

Enter:

```text
SCRATCH HOLD
```

Maintain the current base look while allowing limited beat/gesture modulation.

When stable forward playback resumes:

resynchronize to the exact source location at the next sensible boundary.

---

# 62. Two-Deck Engine

Each active deck has an independent world:

```text
Deck A
  TrackModel
  ShowPlan
  ShowCursor

Deck B
  TrackModel
  ShowPlan
  ShowCursor
```

Then:

```text
ShowMixer
```

combines them.

---

# 63. Audible Weight

Calculate an audible contribution estimate from:

```text
channel upfader
crossfader
playing state
master state
```

Where available, include FLX4/controller state as confirmation.

---

# 64. Two-Deck Base Mixing

Base lighting layers may blend.

Do this in perceptual/linear color space.

Example:

```text
Deck A cyan
Deck B magenta

transition:
cyan
→ violet
→ magenta
```

Not arbitrary RGB addition.

---

# 65. Impact Ownership

High-impact effects are exclusive semantic resources.

Examples:

```text
blackout
strobe
white hit
full-room impact
```

Do not simply alpha-blend two independent strobes.

The ShowMixer chooses an owner.

Primary factors:

```text
audible weight
master status
event confidence
event strength
structural significance
```

---

# 66. Transition-Aware Blackouts

If Deck A hits a pre-drop blackout while Deck B is strongly audible:

a full-room blackout may be musically wrong.

The mixer can translate it into:

```text
Deck A spatial dip
Deck A side blackout
global partial dip
```

unless both tracks structurally support the blackout.

This is essential for real DJ transitions.

---

# 67. Incoming Deck Introduction

As incoming deck weight rises:

first introduce:

```text
its palette
its secondary spatial layer
```

then:

```text
its rhythm
```

then:

```text
its major impacts
```

This mirrors how a lighting operator would visually hand over attention.

---

# 68. Live Audio Layer

Package:

```text
packages/reactive-audio/
```

Use concepts from LedFx but not its GPL implementation.

LedFx is GPLv3; the application therefore reimplements the needed DSP independently.

Needed concepts:

```text
FFT
mel-frequency banks
automatic gain normalization
rise/decay smoothing
onset detection
band energies
spectral difference
```

Live audio contributes only a controlled overlay.

Typical influence:

```text
planned show      ~ dominant
reactive overlay  ~ subtle
```

The exact percentage is style-dependent.

---

# 69. What Live Audio May Modify

Allowed:

```text
pulse envelope
small brightness bump
sparkle density
minor segment displacement
decay rate
micro accents
```

Not allowed:

```text
change section
declare a drop
replace palette randomly
trigger uncontrolled strobe
discard generated show
```

---

# 70. No-File / Streaming Mode

A track may occasionally have no readable audio file.

The system still works.

Capability levels:

### FULL

```text
DJ grid
+
full source audio
+
native analysis
+
ML analysis
+
compiled show
```

### STRUCTURED

```text
DJ grid
+
native Rekordbox structural information
+
no accessible source audio
```

### ADAPTIVE

```text
DJ beat/transport
+
live audio
+
professional pattern director
```

This is not silent failure.

The Live UI clearly displays the active quality level.

---

# 71. Adaptive Director

Adaptive mode is still structured.

It maintains:

```text
current energy state
estimated phrase counter
recent motif history
palette
recent effects
effect cooldowns
darkness state
spatial direction
```

It uses a library of coherent phrase-length looks rather than random beat reactions.

Thus an unanalyzed track still looks like a programmed Autoloop, not LedFx.

---

# 72. Show Plan Schema

```ts
interface ShowPlan {
  schemaVersion: number;

  plannerVersion: string;

  trackId: string;

  styleId: string;

  seed: string;

  globalDesign: GlobalDesign;

  sections: ShowSection[];

  cues: ShowCue[];

  recurrence: MotifMap;

  constraints: ShowConstraints;
}
```

---

# 73. Cue Domain

All scheduled musical positions use beat coordinates.

```ts
interface BeatTime {
  beat: number;
}
```

Fractional values are valid:

```text
257.0
257.25
257.5
257.75
```

Seconds appear only at the boundary between:

```text
DJ transport
↔
BeatGrid
```

---

# 74. Beat Grid Mapping

Implement efficient bidirectional functions:

```ts
sourceSecondsToBeat(seconds): number
beatToSourceSeconds(beat): number
```

Support variable BPM grids.

Use binary search over native grid anchors and piecewise interpolation.

---

# 75. Venue-Independent Show Plans

A compiled show says:

```text
left-to-right sweep
primary fixtures
80% energy
```

not:

```text
H6076 segment 4 = 255,0,0
```

The renderer adapts the show to the venue.

---

# 76. Renderer

Package:

```text
packages/renderer/
```

Responsibilities:

```text
evaluate ShowPlan
evaluate deck mixing
resolve semantic spatial targets
composite layers
convert perceptual color → linear RGB
apply intensity
sample per fixture
apply gamma
apply calibration
apply device latency offset
produce output frames
```

---

# 77. Spatial Effects Across Devices

Suppose the venue contains:

```text
Floor Lamp Left
Floor Lamp Right
Back Strip
Desk Strip
```

A global wave can travel:

```text
left lamp bottom
→ left lamp top
→ back strip left
→ back strip center
→ back strip right
→ right lamp top
→ right lamp bottom
```

because all cells live in shared venue coordinates.

---

# 78. Simulated Blinders

On Govee:

```text
BLINDER
=
brief high-intensity white across appropriate fixture group
```

Use sparingly.

The planner tracks a blinder/white-hit budget.

---

# 79. Simulated Moving-Light Language

Govee fixtures cannot physically pan and tilt.

We emulate visual motion through spatial segments:

```text
rise
fall
cross
fan
converge
diverge
left-right chase
outside-in
inside-out
vertical scan
spatial rotation around venue topology
```

The semantic effect system is deliberately analogous to a real LD's movement vocabulary.

---

# 80. Local Persistence

Use SQLite WAL.

Library:

```text
better-sqlite3
+
Kysely
```

The application's database is completely separate from Rekordbox.

---

# 81. Database Tables

At minimum:

```text
tracks
source_identities
native_analysis
analysis_runs
analysis_artifacts
show_plans
show_edits
devices
device_capabilities
device_calibrations
venues
fixture_placements
fixture_groups
show_styles
sessions
diagnostic_events
protocol_versions
```

---

# 82. Cache Versioning

Every artifact includes:

```text
schema version
analyzer version
planner version
source fingerprint
```

If analyzer logic changes:

invalidate only analysis-dependent artifacts.

If show planner changes:

reuse TrackModel and regenerate ShowPlan.

If venue changes:

reuse TrackModel and semantic ShowPlan.

---

# 83. Monorepo

```text
autolight/
│
├── package.json
├── yarn.lock
├── .yarnrc.yml
│
├── apps/
│   └── desktop/
│       ├── electron/
│       │   ├── main.ts
│       │   ├── preload.ts
│       │   ├── ipc.ts
│       │   └── services/
│       └── src/
│           ├── app/
│           ├── routes/
│           ├── components/
│           ├── features/
│           └── styles/
│
├── packages/
│   ├── contracts/
│   ├── dj-core/
│   ├── rekordbox-library/
│   ├── rekordbox-live/
│   ├── serato/
│   ├── controller-flx4/
│   ├── track-model/
│   ├── analysis-client/
│   ├── show-planner/
│   ├── show-runtime/
│   ├── show-mixer/
│   ├── venue/
│   ├── renderer/
│   ├── govee/
│   ├── reactive-audio/
│   ├── storage/
│   ├── diagnostics/
│   └── simulator/
│
├── analysis/
│   ├── pyproject.toml
│   ├── uv.lock
│   ├── src/
│   │   └── autolight_analysis/
│   │       ├── worker.py
│   │       ├── decode.py
│   │       ├── structure.py
│   │       ├── stems.py
│   │       ├── metrical.py
│   │       ├── features.py
│   │       ├── events.py
│   │       ├── fusion.py
│   │       └── schema.py
│   └── tests/
│
├── vendor/
│   └── govee-toolkit/
│
├── protocol-fixtures/
│   ├── rekordbox/
│   ├── serato/
│   └── govee/
│
├── test-fixtures/
│   ├── tracks/
│   ├── analysis/
│   └── sessions/
│
└── docs/
    ├── architecture.md
    ├── rekordbox-protocol.md
    ├── serato-protocol.md
    ├── track-model.md
    ├── show-planner.md
    ├── govee.md
    └── qualification.md
```

---

# 84. TypeScript Standards

```text
strict = true
noImplicitAny = true
noUncheckedIndexedAccess = true
exactOptionalPropertyTypes = true
```

Runtime validation:

```text
Zod
```

Use:

```text
Yarn 4 workspaces
```

All dependency versions pinned through `yarn.lock`.

---

# 85. Python Standards

Use only:

```text
uv
```

Commands:

```text
uv sync --frozen
uv run pytest
uv run ...
```

Lock all dependencies in:

```text
uv.lock
```

---

# 86. Desktop Architecture

Electron processes:

```text
MAIN PROCESS
  DJ adapters
  library access
  storage
  device management
  analysis worker manager

SHOW WORKER
  high-resolution clock
  deck estimator
  ShowMixer
  renderer
  Govee frame dispatch

RENDERER
  React UI

PYTHON PROCESS
  offline analysis
```

A frozen React frame must never freeze lighting output.

---

# 87. IPC

All Electron IPC payloads are:

```text
typed
versioned
validated
```

No arbitrary `ipcRenderer.send()` surface.

Preload exposes a narrow API.

Renderer gets no direct Node filesystem/network privileges.

---

# 88. UI Design Language

The application should look like professional performance software, not a smart-home dashboard.

Characteristics:

```text
deep neutral background
high-information density
excellent hierarchy
large timing typography
minimal decorative chrome
one restrained accent family
semantic status colors
smooth 60fps animations
```

Avoid:

```text
neon cyberpunk overload
glass everywhere
giant rounded cards
random gradients
consumer smart-home aesthetic
```

---

# 89. Live Screen

This is the primary performance surface.

Layout:

```text
┌───────────────────────────────────────────────────────────────┐
│ Rekordbox ●   Timing ●   Govee 4/4 ●   24fps ●   31ms       │
├──────────────────┬───────────────────┬────────────────────────┤
│ DECK A           │ MASTER CLOCK      │ DECK B                 │
│ artwork          │                   │ artwork                │
│ title            │      128.00       │ title                  │
│ section          │       BPM         │ section                │
│ phrase           │                   │ phrase                 │
│ DROP IN 8        │      1 | 2        │ CHORUS                 │
├──────────────────┴───────────────────┴────────────────────────┤
│                    DUAL WAVEFORM                              │
│ sections / beats / events / playheads                         │
├───────────────────────────────────────────┬───────────────────┤
│ LIVE VENUE PREVIEW                        │ UPCOMING           │
│ exact segment output                      │ +4 build           │
│                                           │ +1 blackout        │
│                                           │  0 DROP            │
│                                           │ +8 variation       │
├───────────────────────────────────────────┴───────────────────┤
│ BLACKOUT │ FULL │ FREEZE │ AUTO │ MASTER ████████░░ 80%      │
└───────────────────────────────────────────────────────────────┘
```

---

# 90. Deck Card

Show:

```text
artwork
track
artist
source
play/pause
playhead
native BPM
effective BPM
pitch
beat number
bar
phrase
section
next structural event
channel fader
audible weight
analysis quality
```

The most useful predictive field should be visually strong:

```text
DROP IN 8
BREAKDOWN IN 16
BUILD
```

---

# 91. Waveform

Whole/nearby waveform must visualize:

```text
source waveform
native beatgrid
downbeats
sections
phrases
fills
detected builds
drops
breakdowns
hot cues
loops
current playhead
```

Color the waveform semantically, not decoratively.

---

# 92. Venue Preview

The preview is the exact final logical output before transport calibration.

Not a fake animation.

Every segment visible onscreen corresponds to an actual fixture cell.

This makes debugging instant.

---

# 93. Upcoming Cues

Show the next meaningful cues:

```text
+8 bars    Build increase
+4 beats   Desaturate
+1 beat    Blackout
NOW        Drop impact
+2 beats   Chase body
```

This lets the operator understand why the system is doing something.

---

# 94. Emergency Controls

Always available:

```text
BLACKOUT
FULL WHITE
FREEZE LOOK
AUTO/MANUAL
MASTER INTENSITY
```

`BLACKOUT` cannot require a modal confirmation.

Keyboard shortcuts must exist.

---

# 95. Library Screen

Left:

```text
Rekordbox playlists
Serato crates
```

Main table:

```text
Track
Artist
BPM
Key
Duration
Native Grid
Native Structure
Deep Analysis
Show
Last Modified
```

Status examples:

```text
READY
ANALYZING
NEEDS ANALYSIS
GRID WARNING
SOURCE MISSING
```

---

# 96. Track Inspector

This is the most important engineering/debugging UI.

Display synchronized lanes:

```text
waveform
beatgrid
sections
PSSI phrases
All-In-One structure
bass energy
drums
vocals
other
novelty
build probability
drop probability
musical events
generated lighting cues
```

Click any beat to audition the lighting state in the simulator.

---

# 97. Track Corrections

Automatic analysis remains editable.

User can:

```text
change section label
move event
delete false drop
add missing drop
mark fake drop
change style
regenerate one section
lock an existing section
```

Regeneration respects locked edits.

---

# 98. Venue Screen

Interactive 2D stage/room canvas.

Operations:

```text
discover fixture
drag into venue
rotate
reverse segment order
resize logical footprint
assign tags/groups
identify
preview
calibrate
```

The physical layout drives spatial effects.

---

# 99. Device Screen

Each fixture shows:

```text
name
SKU
connection mode
IP
firmware
segments
qualified resolution
current FPS
sent frames
superseded frames
latency
last response
health
```

Include:

```text
IDENTIFY
TEST CHASE
RECALIBRATE
```

---

# 100. Setup Experience

First launch:

### Step 1 — DJ software

Choose:

```text
Rekordbox
Serato
```

Auto-detect installed application.

### Step 2 — controller

Detect:

```text
DDJ-FLX4
```

### Step 3 — library

Import.

### Step 4 — lights

Discover Govee LAN devices.

### Step 5 — identify

Lights illuminate one at a time.

### Step 6 — venue placement

Drag them into approximate physical positions.

### Step 7 — segment orientation

Run directional chase.

User chooses:

```text
correct
reverse
```

### Step 8 — qualification

Benchmark stream automatically.

### Step 9 — analysis

Analyze selected Rekordbox playlists / Serato crates.

### Step 10 — preview

Play simulated show.

Then the application is ready.

---

# 101. Diagnostics

Developer diagnostics need first-class status.

Tabs:

```text
DJ Events
Transport
Beat Clock
Track Resolver
Analysis
Planner
Renderer
Fixtures
Latency
Logs
```

---

# 102. DJ Event Inspector

Display:

```text
monotonic timestamp
source
deck
event
raw state
normalized state
latency
```

Optionally record to:

```text
.ndjson
```

for deterministic replay.

---

# 103. Session Recorder

Every performance can optionally record control metadata:

```text
DJ events
deck states
show decisions
renderer frames/hashes
device health
errors
```

No audio recording required.

A recorded session can be replayed into a simulator exactly.

This is crucial for debugging.

---

# 104. Simulator

`packages/simulator`

Simulates:

```text
Rekordbox events
Serato events
FLX4 events
Govee fixtures
device latency
packet loss
disconnects
```

Allows the entire product to run without physical lights or DJ software.

---

# 105. Fault Handling

## DJ source briefly disappears

0–500ms:

```text
continue clock extrapolation
```

500ms–2s:

```text
hold coherent current look
reduce reliance on transients
```

Longer:

```text
enter timing-degraded state
use live audio/adaptive clock if available
```

Never instantly turn all lights off because one packet was missed.

---

# 106. Govee device disappears

Other fixtures continue.

For missing fixture:

```text
reconnect
re-arm stream
send current frame
```

Do not replay stale queued frames.

---

# 107. Network congestion

Monitor:

```text
frames requested
frames sent
frames superseded
status RTT
```

Automatically reduce only the affected device's physical frame rate.

The logical show remains 60Hz.

---

# 108. UI Crash

Show worker must be isolated enough that renderer failure does not immediately destroy the show.

If the Electron renderer reloads:

```text
show runtime continues
```

---

# 109. Analysis Worker Crash

Live show unaffected.

Pending analysis job marked interrupted and retried when worker restarts.

---

# 110. Data Security

Local-first.

No music upload is required.

Read-only access:

```text
Rekordbox database
Serato database
audio files
```

Secrets:

```text
Govee API key
```

stored via OS-protected Electron `safeStorage`.

No externally reachable control server by default.

---

# 111. Govee Network Security

Govee LAN control does not authenticate its local control traffic.

Therefore:

- bind only necessary local interfaces;
- never expose a control listener to WAN;
- don't bridge commands externally;
- show network trust status in diagnostics.

---

# 112. Licensing Rules

Safe direct reuse:

```text
serato-connect        MIT
rekordbox-connect      MIT
pyrekordbox            MIT
alphatheta-connect     MIT
govee-toolkit          MIT
all-in-one-infer       MIT
Beat This              MIT
```

LedFx:

```text
GPLv3
```

Therefore:

```text
study concepts
do not copy implementation into proprietary/non-GPL core
```

The 2026 Skip-BART/SeqLight repositories currently expose no license file.

Therefore:

```text
research inspiration only
no copied code
no bundled weights
```

unless licensing is independently resolved.

---

# 113. Learned-Lighting Research

The planner's architecture must permit learned scoring without making a learned model mandatory.

2026 stage-lighting research is useful because it highlights an important problem:

```text
fixed category → fixed pattern
```

becomes monotonous.

Our deterministic planner addresses this through:

```text
hierarchical planning
track-specific identity
motif recurrence
variation
effect budgets
contextual contrast
large event memory
spatial composition
```

A planner candidate can be scored by multiple internal evaluators, but deterministic generation remains sufficient to produce the full product.

---

# 114. Show Quality Rules

A valid ShowPlan must satisfy invariants.

Examples:

```text
No overlapping exclusive blackouts.

No impossible negative-duration cues.

No palette change every beat unless a deliberate special section requires it.

No uncontrolled full-room strobe from live audio.

No major white impact immediately repeated without explicit musical justification.

No fixture command unsupported by venue capabilities.

No event scheduled outside source duration.

All cues evaluate deterministically at arbitrary beat position.
```

---

# 115. Automatic Show Evaluation

Compile quantitative diagnostics:

```text
average active-cell density
darkness percentage
color-change rate
white-hit count
blackout count
strobe duration
pattern recurrence
spatial-direction entropy
section contrast
whole-track intensity arc
```

These aren't “quality scores.”

They're diagnostics used to reject pathological generations.

---

# 116. Curated Visual Validation Set

Maintain a test collection spanning:

```text
house
tech house
EDM
bass music
hip-hop
pop
rock
disco
tracks with fake drops
tracks with long breakdowns
tracks with tempo changes
tracks with weak intros
tracks with irregular structure
```

For every reference track, inspect:

```text
structure
drop timing
restraint
recurrence
contrast
color coherence
spatial behavior
transition handling
```

---

# 117. Performance Targets

## Live runtime

Logical renderer:

```text
60 Hz
```

Show-clock jitter target:

```text
p99 < 5ms
```

DJ message processing:

```text
no unbounded queue
```

UI:

```text
60fps target
```

---

# 118. Physical Output Targets

Per qualified Govee device:

```text
no continuously growing output queue
no stale-frame delivery
no cloud dependency during performance
```

Visible impact synchronization target after calibration:

```text
p95 within ~50ms across fixtures
```

Hard emergency blackout request-to-LAN-send:

```text
<100ms
```

The hardware's own visible response is separately measured and compensated.

---

# 119. Track-Sync Qualification

Reference testing must include:

```text
normal playback
pitch ±8%
pitch ±16%
play/pause
cue restart
hotcue jump
forward seek
back seek
4-beat loop
1-beat loop
1/2 loop
1/4 roll
scratch
reverse where supported
sync toggles
two decks
crossfade
incoming track
master switch
track replacement
```

Generated cue timing must remain tied to musical beats.

---

# 120. Rekordbox Definition of Done

Rekordbox is not considered complete until:

1. FLX4 + current supported Rekordbox connects automatically.
2. Loaded track is resolved correctly on both decks.
3. Play/pause is observed.
4. Playhead is continuously tracked.
5. Effective BPM is tracked.
6. Native beatgrid is loaded.
7. Beat/bar position is correct.
8. Hotcue/seek resynchronizes.
9. Loops work.
10. Pitch changes work.
11. Two decks work simultaneously.
12. Channel faders influence ShowMixer.
13. Crossfader influences ShowMixer.
14. Track switches don't leak old metadata.
15. The application can run without SoundSwitch installed.
16. Protocol recordings pass deterministic replay tests.
17. macOS passes.
18. Windows passes.

No “beta Rekordbox support” label if any of those fail.

---

# 121. Serato Definition of Done

Serato support requires:

1. automatic Remote discovery;
2. auth handshake;
3. deck identity;
4. filepath;
5. live playhead;
6. effective BPM;
7. play state;
8. loops;
9. loop rolls;
10. channel faders;
11. crossfader;
12. Serato native beatgrid;
13. cues and loops from GEOB;
14. two-deck mixing;
15. seek handling;
16. deterministic replay tests.

---

# 122. H6076 Definition of Done

At least two H6076 units must be usable simultaneously.

Required:

```text
LAN discovery
identity
persistent local control
segmented RGB
black segments independently
different colors simultaneously
spatial chase
stable qualification-derived FPS
blackout
white impact
disconnect/reconnect
latency calibration
multiple-device phase alignment
```

---

# 123. H1A45 Definition of Done

Required:

```text
LAN discovery
local segmented output
actual segment count detection
orientation calibration
different simultaneous segment colors
black individual segments
cross-device spatial effects
stable stream rate
latency compensation
disconnect/reconnect
```

Cut/configured physical length must not be assumed from SKU alone.

---

# 124. Multi-Device Definition of Done

Test configuration:

```text
2× H6076
+
1× H1A45
+
at least one additional compatible Govee fixture or simulator
```

Must demonstrate:

```text
global left-right chase
vertical rise
cross-device wave
simultaneous independent colors
partial darkness
full blackout
white impact
drop sequence
breakdown look
two-deck palette transition
```

---

# 125. Soak Test

Run continuous simulated/physical performance for:

```text
4 hours
```

Pass conditions:

```text
no memory growth trend
no output-queue growth
no fixture drift
no increasing latency
no stale track state
no dead worker
no UI degradation
```

---

# 126. Automated Tests

TypeScript:

```text
Vitest
```

Python:

```text
pytest
```

Desktop E2E:

```text
Playwright
```

Required classes:

```text
unit
schema
property
protocol-replay
analysis golden
planner golden
renderer golden
device simulator
fault injection
desktop E2E
performance
soak
```

---

# 127. Golden Renderer Tests

Given:

```text
ShowPlan
Beat
VenueModel
```

the exact logical pixel frame should be testable.

Example:

```text
beat 257.0
→ expected cell buffer hash
```

This catches visual engine regressions.

---

# 128. Protocol Replay

Every real Rekordbox and Serato capture can be replayed at:

```text
1×
2×
10×
step mode
```

Normalized `DeckState` must match golden events.

No physical DJ software is required in CI.

---

# 129. Planner Regression

For a known TrackModel:

```text
planner version
+
seed
+
style
```

must produce stable ShowPlan output.

If intentional planner changes alter the result:

update golden fixture deliberately.

---

# 130. Logging

Structured logs.

Fields:

```text
timestamp
monotonicTimestamp
module
severity
session
deck
track
fixture
event
latency
```

No huge raw protocol spam outside diagnostic mode.

---

# 131. Metrics

Expose locally:

```text
DJ update rate
DJ state age
clock correction
beat error estimate
render time
renderer FPS
device FPS
superseded frames
device latency
analysis duration
planner duration
IPC latency
```

Diagnostics UI reads these directly.

---

# 132. Startup Sequence

```text
Open application

↓
Open application DB

↓
Start show worker

↓
Start Govee manager

↓
Start chosen DJ adapter

↓
Start library watcher

↓
Start analysis worker

↓
Restore venue

↓
Resolve current loaded tracks

↓
Load TrackModels

↓
Load/compile ShowPlans

↓
Arm Govee streams

↓
READY
```

---

# 133. Graceful Shutdown

Order:

```text
stop accepting UI actions
freeze director
send configured ending look
disarm/close Govee streams
stop DJ adapters
stop analysis process
flush DB
stop workers
exit
```

Crash handling uses a safe-state policy.

---

# 134. Manual Override

Manual override is intentionally small and performance-oriented.

Controls:

```text
BLACKOUT
WHITE
FREEZE
master intensity
force low-energy look
force high-energy look
resume automation
```

Resume behavior:

```text
next beat
next bar
next phrase
immediate
```

Default:

```text
next bar
```

for a visually clean handoff.

---

# 135. Show Styles

A style defines constraints, not fixed animations.

Example properties:

```ts
interface ShowStyle {
  intensityRange: [number, number];

  darknessPreference: number;

  spatialDensity: number;

  colorSaturation: number;

  paletteChangeRate: number;

  movementDensity: number;

  impactAggression: number;

  whiteHitFrequency: number;

  strobeFrequency: number;

  symmetry: number;

  reactiveAmount: number;
}
```

Provide polished built-ins:

```text
Club
House
Festival
Lounge
Pop
Dark
Minimal
```

Default should produce a good show without configuration.

---

# 136. Rekordbox-First UX

If both DJ products are installed:

default recommendation in setup is Rekordbox because it is the stated primary environment.

The status bar explicitly identifies the current source:

```text
REKORDBOX
```

or:

```text
SERATO
```

No generic “audio source” abstraction exposed to normal users.

---

# 137. Analysis Readiness

Library shows:

```text
FULL
STRUCTURED
ADAPTIVE
```

Clicking explains exactly which inputs exist.

Example:

```text
FULL

✓ Rekordbox beatgrid
✓ Rekordbox phrase analysis
✓ Deep structure analysis
✓ Stem features
✓ Generated show
```

---

# 138. Track Load Fast Path

When the DJ loads a track:

1. resolve identity;
2. fetch cached TrackModel;
3. fetch cached ShowPlan;
4. install into deck runtime;
5. display UI.

No ML inference occurs in this critical path if track has been analyzed.

If show is missing but TrackModel exists:

planner compilation runs quickly from cached features.

---

# 139. Library Preanalysis

User selects playlists/crates.

The system processes all tracks before the set.

Queue UI shows:

```text
Queued
Analyzing
Compiling
Ready
Failed
```

Analysis artifacts persist between sessions.

---

# 140. Live Track Without Prepared Show

If a local track gets loaded before preanalysis completes:

use the best available level immediately.

Rekordbox example:

```text
native beatgrid
+
PSSI
+
generated structured show
```

Then if deep analysis completes before playback or while track is still cued, compile full ShowPlan.

Do not switch show architecture halfway through audible playback unless it can be done cleanly at a major phrase boundary.

---

# 141. Library Change Detection

Watch:

```text
Rekordbox DB
Serato DB/crates
audio file mtime/hash
ANLZ mtime
```

Invalidate only affected artifacts.

---

# 142. Styling Quality

The application UI gets its own component/design system.

Required reusable components:

```text
StatusDot
MetricBadge
DeckPanel
Waveform
BeatRuler
SectionLane
EventLane
FixturePreview
DeviceTile
HealthIndicator
InspectorPanel
TimelineCursor
CueList
MasterControls
```

No page-specific copies.

---

# 143. Accessibility / Ergonomics

The Live view is readable from several feet away.

Critical controls have:

```text
large hit targets
keyboard shortcuts
high contrast
text labels
```

Do not encode critical states only through color.

---

# 144. No Surprise Modal During Performance

While Live mode is active:

never interrupt with:

```text
update available
analysis failed modal
device disconnected modal
confirmation dialog
```

Noncritical issues appear in status/notifications.

Emergency controls remain active.

---

# 145. Update Strategy

Application updates are never installed automatically during a performance.

Dependency changes are locked and tested.

A new Rekordbox version that has not passed protocol qualification produces:

```text
UNVERIFIED REKORDBOX VERSION
```

rather than pretending compatibility.

---

# 146. Supported Rekordbox Version Model

Protocol adapters are version-aware.

```ts
interface RekordboxProtocolDefinition {
  versionRange: string;
  platform: "macos" | "windows";
  decoder: ProtocolDecoder;
  fixtureSet: ProtocolFixtureSet;
}
```

Unknown compatible versions may be probed, but aren't declared supported until the replay/live qualification suite passes.

---

# 147. Govee Firmware Model

Same philosophy.

Unknown firmware:

```text
normal control can continue
+
background qualification checks
+
diagnostic warning
```

If raw stream fails:

do not spam it.

Fall back only to verified capability.

---

# 148. Output Transport Priority

For each fixture:

```text
local LAN segmented stream
        ↓
local BLE segmented stream if verified
        ↓
whole-fixture local LAN
```

Cloud is not a live show renderer.

Cloud may be used for:

```text
capability discovery
device metadata
setup
```

Never for beat-critical frames.

---

# 149. Real-Time Output Rule

The show loop owns desired state.

Transport owns delivery.

Renderer should be able to say:

```text
THIS is what fixture 3 should look like now.
```

Transport may skip stale intermediate states.

That is better than preserving every historic command.

---

# 150. User Flow — Normal Night

```text
Open app

Rekordbox connects automatically
Govee rig connects automatically

Library already analyzed

Load track A
→ show appears instantly

Press play
→ show follows

Load track B
→ B show preloads but remains visually silent

Raise B fader
→ B palette and spatial elements enter

Crossfade
→ visual ownership moves toward B

Drop in B
→ B gains impact ownership

Loop
→ lighting loops intelligently

Seek
→ lighting snaps to correct song state

End night
→ app gracefully leaves lights in configured final state
```

No manual lighting programming is required.

---

# 151. What “Professional Looking” Means

The acceptance criterion is not:

```text
the lights changed on beat
```

It is:

```text
the visual structure makes musical sense
```

A viewer should be able to infer:

```text
this is a breakdown
this is building
something is about to happen
this is the drop
this chorus returned
the incoming track is taking over
```

from the lighting alone.

---

# 152. Implementation Gates

Development is complete only after all gates pass.

## Gate A — DJ data

Rekordbox and Serato acceptance suites pass.

## Gate B — Track intelligence

Native + ML analysis produces valid TrackModels.

## Gate C — Govee

H6076 + H1A45 segmented local rendering passes.

## Gate D — Show compiler

Reference tracks produce coherent deterministic scores.

## Gate E — Runtime

Loops/seeks/pitch/two-deck mixing pass.

## Gate F — UI

All primary workflows operate without developer tools.

## Gate G — Reliability

Four-hour soak passes.

## Gate H — Packaged application

Fresh-machine installation works on supported macOS and Windows targets.

---

# 153. Hard Definition of Done

The project is **done** when a user can install the application on a clean supported computer, connect a DDJ-FLX4, open either Rekordbox or Serato, discover multiple Govee fixtures including H6076 and H1A45, place/calibrate them visually, select their music library for analysis, and then DJ normally while the system autonomously produces coherent, phrase-aware, section-aware, drop-aware, spatially coordinated, segmented lighting without requiring manual intervention.

During that performance:

- decks can be pitched;
- tracks can be changed;
- hot cues can be used;
- loops can be entered and exited;
- crossfades can occur;
- both decks can be audible;
- fixtures can briefly disconnect;
- the UI can remain busy;
- playback can seek;
- major musical events still produce intentional lighting;
- quiet music remains restrained;
- drops have meaningful impact;
- darkness is used deliberately;
- effects do not degrade into random repetition;
- the Govee lights remain synchronized;
- no cloud round-trip is required to perform the show.

A project that merely:

```text
detects beats
changes colors
flashes on bass
```

does not satisfy this specification.

A project that works with Serato but leaves Rekordbox half-supported does not satisfy it.

A project that controls an H6076 as one RGB bulb instead of segmented RGBIC does not satisfy it.

A project that exposes “TODO: implement planner” does not satisfy it.

A project that requires editing code or JSON to set up the room does not satisfy it.

A project that has a functional engine behind a rough debug UI does not satisfy it.

The UI, analysis, synchronization, show generation, multi-deck logic, calibration, diagnostics, error handling, packaging, and hardware output are all part of the same deliverable.

---

# 154. Build Order

The implementation order is chosen to eliminate uncertainty without reducing final scope.

### Phase 1 — repository and contracts

Create:

```text
Yarn monorepo
Electron shell
React design system
shared contracts
SQLite schema
Python uv project
simulator
test harness
```

### Phase 2 — Govee hardware qualification

Implement and physically qualify:

```text
H6076
H1A45
multi-device streaming
segments
latency
reconnection
```

### Phase 3 — Rekordbox static intelligence

Implement:

```text
master.db
track resolver
PQTZ
PSSI
PCO2
PWV*
PWVC
```

### Phase 4 — Rekordbox live acquisition

Capture and implement Rekordbox 7.2.19+ Lighting IPC and build replay fixtures.

Simultaneously implement FLX4 telemetry/composite provider so both mechanisms are independently testable.

### Phase 5 — Serato

Integrate `serato-connect` and normalize it to the same `DeckState` contract.

### Phase 6 — analysis

Implement:

```text
decode
All-In-One
Beat This
stems
DSP
native/ML fusion
musical-event extraction
```

### Phase 7 — show planner

Implement complete:

```text
hierarchy
palettes
motifs
contrast
event programming
restraint
variation
```

### Phase 8 — runtime

Implement:

```text
clock
playhead estimator
loops
seeks
scratch behavior
deck mixer
renderer
latency compensation
live overlay
```

### Phase 9 — full product UI

Complete:

```text
setup
live
library
track inspector
venue
calibration
style
diagnostics
```

### Phase 10 — qualification

Run:

```text
protocol replay
track regression
Govee hardware
FLX4
Rekordbox
Serato
fault injection
four-hour soak
fresh-install packaging
```

No phase is a reduced “MVP.” The sequence only determines implementation order.

---

# 155. Final Architectural Boundary

The final system is:

```text
                 REKORDBOX                    SERATO
                     │                           │
        ┌────────────┴────────────┐              │
        │                         │              │
  LIVE TRANSPORT             LIBRARY/ANLZ     REMOTE+GEOB
        │                         │              │
        └────────────┬────────────┴───────┬──────┘
                     │                    │
                     ▼                    ▼
                DeckState            TrackModel
                     │                    │
                     │             ┌──────┴───────┐
                     │             │              │
                     │         native info    deep audio
                     │             │              │
                     │             └──────┬───────┘
                     │                    │
                     │                    ▼
                     │               ShowPlanner
                     │                    │
                     │                    ▼
                     │                ShowPlan
                     │                    │
                     └──────────┬─────────┘
                                │
                                ▼
                           ShowRuntime
                                │
                  ┌─────────────┴─────────────┐
                  │                           │
              Deck A/B                    Live Audio
              ShowMixer                    Overlay
                  │                           │
                  └─────────────┬─────────────┘
                                │
                                ▼
                             Renderer
                                │
                                ▼
                            VenueModel
                                │
                                ▼
                      per-fixture RGB frames
                                │
                                ▼
                        Govee local streams
                                │
               ┌────────────────┼────────────────┐
               ▼                ▼                ▼
            H6076             H6076             H1A45
         segments 0..N      segments 0..N     segments 0..N
```

That is the product to build.
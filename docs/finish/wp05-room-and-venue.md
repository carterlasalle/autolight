# WP05. Room, venue and spatial effects

## 0. What the owner asked for, restated

The room is (in the owner's case) a square. Segmented strip lights are mounted
on the ceiling and trace the outline of the room. Because they are segmented,
the show can send a pulse outward from a point, run a light in continuous
circles around the room, alternate a strobe between halves of the room, and
more. The strip's controller is somewhere on the outline, the strip leaves it
in one or two directions, and the point where it starts, ends or where two runs
meet is generally not where the DJ stands. The app must let the owner draw the
room, say where the middle is, where the DJ is and which way they face, and
map exactly where every segment of every strip physically is, without editing
code or JSON (spec 153). Everything below serves that.

This package also delivers spec 38 to 41, 75, 77, 79 and 98 (the venue canvas),
because the room model replaces the thin `Fixture` placement that exists today.

## 1. Model (contracts v2)

```ts
// packages/contracts/src/room.ts (Zod schemas, meters, right-handed, z up)
type Point2 = { x: Meters; y: Meters };
type Point3 = { x: Meters; y: Meters; z: Meters };

interface Room {
  id: RoomId; name: string; units: "m" | "ft";         // display units only; storage in meters
  outline: Point2[];                                      // closed polygon, stored clockwise from above
  ceilingHeight: Meters;
  wallNames: string[];                                    // one per outline edge, editable ("North", "Bar wall")
  openings: { wall: number; from: number; to: number; kind: "door" | "window" | "gap" }[]; // 0..1 along wall
  anchors: {
    dj: { position: Point2; facingRad: number };          // where the DJ stands and faces
    center: Point2 | null;                                // null means computed polygon centroid
    audience: Point2 | null;
    custom: { id: string; name: string; position: Point3 }[];
  };
  background?: { imageRef: string; scale: number; offset: Point2; rotationRad: number; opacity: number };
}

type Placement =
  | { kind: "point"; position: Point3 }
  | { kind: "vertical"; base: Point2; z0: Meters; z1: Meters }        // floor lamps
  | { kind: "path"; runs: Run[] };                                     // strips

interface Run {
  id: string;
  polyline: Point3[];               // usually the outline at z = ceilingHeight minus offset
  closed: boolean;                  // path returns to its start
  mirroredOf: string | null;        // this run shows the same data as another run (Y-split controller)
}

interface CellMap {                  // produced by the mapping wizard, per fixture per venue
  resolution: "logical" | "grouped" | "native";
  zones: number;
  anchors: { cell: number; run: string; atMeters: Meters }[];   // user-confirmed points
  gaps: { run: string; fromMeters: Meters; toMeters: Meters }[];
  cells: { index: number; positions: { run: string; startMeters: Meters; endMeters: Meters }[] }[];
  // a cell can have two positions when runs are mirrored
}
```

`Fixture` v2 gains `placement`, `cellMap`, `topology`
(`vertical-line`, `open-path`, `closed-loop`, `split-independent`,
`split-mirrored`, `point`, `grid`), `transform` (for the 2D canvas: rotation,
reverse), `capabilities` (from qualification and failover, T-FOV-03), and
`calibration`.

Additional model rules:

- A run's geometry is either a polyline or a spline (`{ kind: "polyline" }` or
  `{ kind: "catmull-rom" | "cubic-bezier"; tension?: number }`) for curved
  installations. Arc length is computed by adaptive sampling to a tolerance
  (`venue.spline.toleranceMeters`), so cell positions stay exact on curves.
- A venue may contain any number of strips, closed loops and disconnected
  chains (for example two strips on opposite walls, or one strip cut into
  three pieces joined by jumpers with dark gaps). Each chain is mapped on its
  own; the room outline is the shared perimeter they all project onto for `s`.
- `CellMap.cells[]` carries both `physicalIndex` (the index on the wire,
  which the transport writes) and `logicalIndex` (the order along `s`
  starting at logical zero, which chain-based effects use). The renderer
  computes in logical order and writes physical order through one lookup
  table built at mapping time, so moving the logical zero never changes what
  the transport receives for a given look.

### 1.1 Three reference points that are not the same point

The owner's point ("where one side meets the controller is not where the DJ
is") needs three separate concepts. The app shows all three on the canvas
with distinct markers and never conflates them.

| Concept | What it is | Who sets it | What depends on it |
| --- | --- | --- | --- |
| Electrical seam | Where physical index 0 and the last index are on the strip, and where the controller is. For a closed loop, the point where the first and last cells meet | Measured by the mapping wizard (T-ROOM-04) | Only the physical to logical lookup table. No effect may depend on it |
| Logical zero | Where `s = 0` is for perimeter effects, and the direction `s` grows | DS-25 (`room.perimeter.zero`: `dj-nearest`, `front-center`, `controller`, `custom-anchor`) and `room.perimeter.direction`, plus a canvas action "Set this segment as logical zero" on any cell | Orbit phase, Fill start, alternate-k parity, logical order |
| Performance anchor | Where the DJ stands and faces, and any other named anchor (centre, audience, bar, custom points) | The owner on the canvas | Default origins of pulses and ripples, left and right, front and back, `uv` |

Moving the controller (a new seam) is a remap: the owner re-runs only wizard
steps 2 to 4 and every effect looks the same afterwards. Moving the logical
zero is a single click and changes where orbits start without touching the
mapping.

### 1.2 Coordinate systems an effect can declare

Every primitive declares which coordinate it samples, so the planner and the
UI can show and reason about it. The registry rejects a primitive that does
not declare one.

| Coordinate | Field (section 3) | Typical use |
| --- | --- | --- |
| DJ frame | `uv` | Left and right, front and back wipes, spec 40 chases |
| Perimeter | `s` (and `logicalIndex` for exact per-cell steps) | Orbits, fills, alternate-k |
| Angle | `theta` around `room.pivot` | Radar, sector rotation |
| Height | `h` | Rises and falls on lamps, spirals |
| Distance | `dAnchor`, `gAnchor` with a metric (DS-24) | Ripples, radial and two-way pulses, breathe |
| Split | `signedSplit[splitId]` | Half-room alternation with a feathered centre band (DS-33) |
| Chain | `chain` (order along one fixture) | Effects that deliberately follow one physical strip |

## 2. Topology classes and what they allow

| Topology | Example | Continuous orbit around the room | Notes shown to the owner |
| --- | --- | --- | --- |
| `closed-loop` | One strip all the way round, ends meet | Yes | The ideal ceiling rig |
| `open-path` | One strip round most of the room with a gap | Yes, the head crosses the gap dark | Gap is shown on the canvas |
| `split-independent` | Two strips or two outputs with independent data, meeting opposite the controller | Yes | Orbit passes through both runs |
| `split-mirrored` | A Y-split controller sending the same data to both runs | No true orbit: every cell appears twice, mirrored about the controller | The app offers mirrored motion (converge, diverge, symmetric sweeps) and uses other fixtures (the lamps) to break symmetry. The mapping wizard detects this case and explains it |
| `vertical-line` | H6076 lamp | n/a | Height gradients, rises, falls, spirals with other lamps |
| `point` | Bulb | n/a | Joins spatial effects by its position |

Whether the owner's H1A45 run(s) are single, split-independent or
split-mirrored is not known today and must be measured in the mapping wizard.
Do not assume.

## 3. Spatial fields (computed per cell, cached, recomputed on edit)

| Field | Definition |
| --- | --- |
| `pos` | Cell centre in meters (for multi-position cells, each position) plus `extent` (start and end points) for anti-aliasing |
| `uv` | Normalized 0 to 1 coordinates in the DJ frame: `u` left to right as seen by the DJ (config `room.orientation.leftRightFrom` can switch to the audience's view), `v` front (toward the audience) to back. This is the spec 40 coordinate |
| `h` | Height fraction, floor 0 to ceiling 1 |
| `s` | Perimeter coordinate 0 to 1 along the room outline, measured by arc length, zero point by DS-25, direction by `room.perimeter.direction`. Cells on a perimeter path use their own arc position; any other cell uses the arc position of the outline point hit by the ray from the pivot through the cell, so a lamp in a corner lights exactly when an orbit passes that corner |
| `theta` | Angle around the pivot (DS `room.pivot`), 0 in the DJ facing direction |
| `dCenter`, `dDj`, `dAnchor[id]` | Euclidean distances normalized by the room's maximum |
| `gDj`, `gAnchor[id]` | Perimeter geodesic distances (shortest way round the outline) from the anchor's projection, normalized; used for two-way pulses along the ceiling |
| `wall`, `wallPos`, `corner` | Wall index, 0 to 1 position along it, distance to the nearest corner |
| `side` | `left`, `center`, `right` relative to the DJ axis with `room.sides.centerBandWidth`; `front` or `back` |
| `chain` | Order along the fixture's own chain (for effects that follow one fixture) |
| `physicalIndex`, `logicalIndex` | Wire index and order along `s` from logical zero (section 1) |
| `tangent` | Unit vector of the direction of increasing `s` at the cell (2D), so directional effects (comets with a tail, wipes that should follow the wall) know which way "forward" is on each wall and around each corner |
| `signedSplit[splitId]` | Signed distance in meters from each drawn or derived split line (positive on the part-A side), normalized by the room's maximum; used for feathered splits (DS-33) and for wipes across a split |
| `zone[zoneId]` | Membership weight 0 to 1 in each user-drawn zone (point in polygon, with an edge feather `room.zones.featherMeters`) |

All fields are floats in typed arrays indexed by a global cell index (no string
keys on the hot path, fixes F-REND-10).

## 4. Groups and splits (derived plus user-defined)

- Derived groups (spec 41 defaults computed from geometry, not array thirds):
  `ALL`, `LEFT`, `RIGHT`, `CENTER`, `FRONT`, `BACK`, `CEILING`, `FLOOR`,
  `VERTICALS`, `HORIZONTALS`, `PERIMETER`, `CORNERS`, `WALL:<name>` per wall,
  `NEAR_DJ` (within config radius).
- Role groups with sensible defaults the owner can change: `PRIMARY` (the
  perimeter strips by default), `SECONDARY` (the lamps), `ACCENT`, `AMBIENT`.
- Splits (named partitions with ordered parts): `halves` at any angle through
  the pivot (default across the DJ axis: DJ-left half and DJ-right half; a
  second default along the axis: front and back), `quadrants`, `sectors:n`
  with offset, `walls`, `alternate:k` along `s` (every k cells), `rings:n` by
  distance from an anchor, and user splits drawn with a lasso on the canvas.
- Split side assignment follows DS-33: `signed-distance` (continuous side of
  the split line), `group-membership` (explicit lists), or `blend` (default:
  signed distance with a feathered band of width `room.splits.featherMeters`,
  overridden by explicit membership where the owner set it). A cell exactly on
  the line belongs to neither part at full weight; it gets 0.5 of each inside
  the band, so a half-room strobe never has a cell that flickers between
  halves.
- Drawn zones: the owner draws named polygons on the canvas ("dance floor",
  "bar", "booth"); cells get a membership weight from point-in-polygon with an
  edge feather. Zones are usable as selectors and as origins (their centroid).
- Selectors in cues (`SpatialSelector`) reference groups, split parts, anchors
  and field predicates (for example `s in [0.2, 0.4]`), never device IDs
  (spec 75).

## 5. Spatial effect primitives (field-based)

Every primitive is a pure function of cell fields, local beat and parameters.
They are registered in the primitive library (T-PLAN-04) and rendered by the
renderer (T-REND-02). Each one has golden frames on the reference rooms
(T-ROOM-12).

| Primitive | Behaviour | Main parameters |
| --- | --- | --- |
| `Orbit` | Light that travels continuously around the room ("continuous circles"): one or more heads moving along `s` | heads, direction, beats per revolution, tail length, tail curve, head colours (palette refs), phase |
| `Ripple` | Pulse originating from a point: a ring expanding over distance from an origin; on perimeter strips with the geodesic metric this is two pulses leaving the origin in opposite directions and meeting on the far side | origin (anchor or event-chosen), metric DS-24, speed (room fraction per beat or "reach far side in N beats"), width, decay, count |
| `Converge` / `Diverge` | Two heads leaving an origin in both directions round the perimeter and meeting at the antipode, or the reverse, timed so the meeting lands on a chosen beat (for example the drop) | origin, meet beat, tail, colours |
| `Radar` | Angular window rotating around the pivot | width, beats per revolution, direction |
| `SplitAlternate` | Alternating parts of a split (half-room alternating strobe or flash) | split, rate (subdivision), duty, strobe flag (subject to restraint and fixture FPS) |
| `QuadrantRotate` | Step through quadrants or sectors in order | split, step beats, direction |
| `WallStep` | Wall by wall | order, step beats |
| `CornerHits` | Accents on corners (and corner lamps) | pattern, decay |
| `Fill` / `Unfill` | Progressive lighting of the perimeter from an origin, one or both ways, tracking a progress value (build progress toward a drop) | origin, both ways, progress curve over a beat range |
| `GradientRotate` | Palette gradient mapped around `s` or `theta`, rotating slowly | palette, speed |
| `Spiral` | Height and angle combined for vertical fixtures (a rising spiral across several lamps) | turns, speed |
| `Breathe` | Brightness by distance from an anchor breathing in and out | anchor, period, depth |
| `Mirror` | Mirror any other primitive across the DJ axis or any split line | axis |
| `SymmetricSweep` | For `split-mirrored` strips: sweeps that look intended when both runs show the same data | origin at controller, direction |
| `PerimeterOrbit` | The explicit perimeter form of `Orbit` (samples `s` only, ignores fixtures off the perimeter unless `includeProjected`). `Orbit` is its alias in the planner vocabulary | as `Orbit`, plus `path` DS-32 (`shortest`, `directed`, `auto`) for point-to-point travel |
| `RadialPulse` | A pulse from a point using Euclidean distance through the room (lamps and ceiling cells light by true distance, not by perimeter position) | origin, speed, width, decay, count |
| `OpposedPulse` | Two pulses from two opposite origins (two anchors, two walls, or both ends of a split line) that meet in the middle on a chosen beat, or pass through each other | origins, meet beat, width, colours, pass-through flag |
| `SpatialWipe` | A straight front crossing the room at any angle (in `uv` or meters), optionally leaving light behind (wipe on) or removing it (wipe off) | angle, start and end beat, edge softness, on or off |
| `GroupHandoff` | Motion or a look passes from one group to another (lamps to ceiling, left wall to right wall, zone to zone) with a crossfade timed to the beat | from group, to group, handoff beat, overlap beats |
| `TextureHold` | A low-intensity, slowly moving texture over a field (smooth noise sampled on `s` or `uv`, seeded by the track fingerprint) for holds, breakdowns and ambient passages | field, scale, speed, depth, palette refs |
| `FinalHit` | The last impact of a track or set: full-room hit from the performance anchor, then a decay that retreats toward a chosen point, ending in the ending look | origin, retreat target, decay beats, colour |

Unknown primitive types are rejected: the registry is a closed discriminated
union, the planner validator rejects any cue whose `type` is not registered,
and the renderer has an exhaustive switch with a compile-time `never` check.
A test feeds an unknown type through each of the three and expects a typed
error, not a silent skip.

Motion always samples continuous fields, then integrates over each cell's
extent (sub-cell anti-aliasing, `render.antialias.subCell`), so a head moving
across a 30-segment ceiling strip glides rather than jumps.

## 6. Tasks

### T-ROOM-01 Room and anchor model

- Closes: F-ROOM-01, F-VEN-04 (model part).
- Add `Room` and anchor schemas to contracts; persist per venue (T-ROOM-11);
  multiple venues; pivot and zero point settings (section 3.9 of the config
  doc).
- DoD: schema tests; property tests (polygon orientation normalized, self
  intersections rejected with a clear message, area positive).

### T-ROOM-02 Placements and Fixture v2

- Closes: F-VEN-01, spec 38, 39.
- Implement `Placement`, `Run`, `CellMap` and Fixture v2 fields. Migrate the
  renderer and venue package to them. Remove `makeFixture`-style linear
  placement from production.
- DoD: contract tests; migration of any stored venue from the old shape.

### T-ROOM-03 Room editor UI

- Closes: F-VEN-02, F-ROOM-01, spec 98.
- Canvas tool (2D, top-down, pan and zoom, grid, units toggle, undo and redo):
  rectangle template with width and length entry; free polygon drawing by
  clicking corners with right-angle and length snapping; vertex drag and
  numeric edit; wall naming; openings; optional background image (floor plan
  or photo) to trace over with scale calibration by drawing a known length.
- Anchors: DJ marker with a facing arrow (drag to move, rotate handle to face),
  centre marker (auto at centroid, draggable to override, "reset to computed"),
  audience marker, custom anchors.
- Fixtures: drag discovered devices from a side list onto the canvas; lamps as
  vertical fixtures with height fields; strips drawn as paths that snap to the
  outline (with a ceiling offset) or drawn freely; rotate, reverse, resize,
  tag, group, identify, preview (spec 98 operations).
- Overlays: split lines, `s` zero point and direction arrow, pivot, groups,
  and each cell coloured with the live frame.
- Seam, zero and anchor: the electrical seam and controller marker (from the
  wizard, read-only here), the logical zero marker (drag along the path, or
  right-click any cell and choose "Set this segment as logical zero"), and the
  DJ and other anchors, each with a distinct icon and a legend.
- Zones and splits: draw named zones as polygons; draw split lines through
  any two points (not only through the pivot); edit feather widths with a
  handle; every split and zone appears in the manual lane's target picker.
- Curved walls: convert any outline edge or strip segment to a spline and
  drag its handles.
- DoD: E2E draws a 5 m by 5 m room, places the DJ, two lamps and a ceiling
  strip, saves, reloads, and the geometry is identical; screenshot and video
  evidence; keyboard-accessible alternatives for every drag operation
  (numeric fields).

### T-ROOM-04 Strip mapping wizard

- Closes: F-ROOM-01, F-ROOM-03, F-VEN-05, spec 42, 43, 52 steps 9 to 11.
- Steps, run against the live device over its verified segmented transport:
  1. Choose the strip and confirm it follows the room outline (or draw its
     path).
  2. Controller: click where the controller is on the path.
  3. Direction: the app sends a short comet from cell 0 upward; the owner
     answers "clockwise", "counterclockwise", or "both ways at once" (the
     last indicates a split, independent or mirrored).
  4. Ends: the app lights the last cell (and for splits, asks where cell 0 and
     the last cell appear on each run); the owner clicks each location.
  5. Corners: for each corner along the path, a slider moves one lit cell with
     live output; the owner stops it at the corner and confirms. A bisection
     helper ("is the lit cell before or after the corner?") speeds this up.
  6. Gaps: optional, the owner marks where LEDs are absent (door frames,
     jumpers).
  7. Mirroring check: the app lights one cell; the owner clicks every place
     it appears. Two places means `split-mirrored`; the wizard explains the
     consequence (section 2) and offers the symmetric effect set.
  8. Fit: piecewise-linear arc-length mapping through the anchors; reject
     non-monotonic fits with a clear prompt; compute each cell's positions and
     extents.
  9. Verify: slow Orbit (or SymmetricSweep for mirrored); the owner confirms
     "continuous" or adjusts a fine offset (plus or minus cells) and direction.
  10. Save to `device_calibrations` keyed to the device and venue.
- Lamps: base position from the canvas; bottom-to-top order verified with a
  vertical chase (spec 42 orientation step).
- DoD: SIM strip with a hidden true mapping (including a mirrored variant and
  a gap) is recovered within one cell by an automated "virtual user" in E2E;
  HW runbook on the owner's ceiling strip with a video of the verify orbit.

### T-ROOM-05 Spatial field computation

- Closes: F-ROOM-02, F-ROOM-03, F-REND-05, spec 40, DS-24, DS-25.
- Compute every field in section 3 into typed arrays when the venue or any
  mapping changes; expose to the renderer as one immutable `VenueFields`
  object with a version number.
- DoD: property tests (for closed loops `s` wraps continuously; geodesic
  distance is symmetric and at most half the perimeter; projected `s` for a
  lamp in a corner equals the corner's `s`; `uv` left/right flips when the DJ
  facing rotates 180 degrees; `tangent` is unit length and turns by the
  corner angle across each corner; `signedSplit` changes sign exactly at the
  line; `physicalIndex` to `logicalIndex` is a bijection per chain and moving
  logical zero rotates it without changing positions; spline arc length
  converges to the analytic length of a circle within tolerance); performance test (fields for 2,000 cells
  computed under `venue.fields.budgetMs`, config, measured).

### T-ROOM-06 Groups and splits

- Closes: F-VEN-03, F-REND-05, F-ROOM-02.
- Derived groups and splits from section 4; role groups with defaults and
  editing; user lasso groups and splits on the canvas.
- DoD: `P-41-derived-groups` passes; E2E creates a custom split and uses it in
  a manual SplitAlternate.

### T-ROOM-07 Spatial primitives

- Closes: F-ROOM-02, spec 31 (spatial members), 77, 79.
- Implement every primitive in section 5 with parameter schemas, renderer
  functions and planner metadata (energy class, suitable sections, restraint
  costs, capability requirements such as "needs closed loop or independent
  split for Orbit").
- DoD: golden frames for each primitive on each reference room (T-ROOM-12);
  owner review video per primitive.

### T-ROOM-08 Renderer integration

- Closes: F-REND-04 (with T-REND-04), F-REND-05.
- The renderer samples fields per cell, integrates over extents, applies
  per-fixture latency by evaluating the whole venue field at that fixture's
  compensated beat (fields are global, so spatial continuity across fixtures
  holds).
- DoD: `P-55-latency-global` and `P-40-cross-device-chase` pass.

### T-ROOM-09 Planner integration

- Closes: F-ROOM-02, spec 28 (spatial motif), 37.
- The planner chooses spatial primitives by section and event: for example a
  build uses `Fill` from the far side toward the DJ reaching completion at the
  drop, or `Converge` with the meeting beat on the drop; a drop uses `Ripple`
  from the DJ plus a fast `Orbit`; a breakdown uses a slow single-head `Orbit`
  at low intensity or `Breathe`; a returning chorus reuses its motif with the
  direction reversed. The track's `globalDesign.spatialMotif` records origin,
  direction and heads. Topology limits are respected (no `Orbit` on a mirrored
  strip).
- DoD: planner tests on the reference rooms; owner review.

### T-ROOM-10 Preview of the real room

- Closes: F-ROOM-04, F-UI-04, F-APP-07, spec 92.
- Live, Venue and Inspector audition all use one room view component: top-down
  with every real cell drawn at its mapped position and extent, lamps shown
  with an elevation strip, optional perspective 3D view (`yarn add three` in the
  desktop app) for ceiling rigs, overlays toggle. Colours are the exact final
  logical frame from the show host snapshot (before per-device calibration,
  spec 92), with an option to show post-calibration values.
- DoD: `P-92-preview-equals-output` passes; UI frame time within budget with
  2,000 cells (T-UI-13).

### T-ROOM-11 Venue persistence, import and export

- Closes: F-VEN-04.
- Venues, rooms, placements and mappings in the DB (`venues`,
  `fixture_placements`, `fixture_groups`, `device_calibrations`); switch
  venue from the title bar; import and export a venue file for backup (never
  required for setup); templates (square room with ceiling loop, rectangular
  club, bedroom).
- DoD: round-trip test; E2E venue switch mid-session re-renders within one
  snapshot.

### T-ROOM-12 Geometry tests and goldens

- Closes: F-ROOM-02 (verification).
- Reference rooms: 5 m square with a closed ceiling loop whose controller is
  mid-wall on the left and the DJ mid-wall at the front; the same with a
  split-mirrored strip; the same square with the electrical seam at a corner
  and the strip made of three cut pieces joined by jumpers (two dark gaps) plus
  two lamps in the back corners; a 6 by 10 m rectangle with a gap over the
  door; an L-shaped room; a room with a curved (spline) wall. Goldens per
  primitive per room at chosen beats (frame hashes plus PNG renders committed
  for review).
- Room probes (the companion completion contract calls this family `VEN`).
  Each is an automated test on the simulator, and the ones marked HW also
  have a runbook step on the owner's ceiling:

  | Probe | Setup | Pass criterion |
  | --- | --- | --- |
  | `P-ROOM-01-seam-not-dj` | Seam at a corner, DJ mid-wall front, `room.perimeter.zero = dj-nearest` | Orbit head at beat 1 is on the cell nearest the DJ projection, not physical index 0; the transport still receives physical order |
  | `P-ROOM-02-orbit-crosses-seam` | Closed loop, seam anywhere, Orbit 4 beats per revolution | Head `s` position is continuous across the seam: the largest per-tick jump in head position is below one cell plus the per-tick travel; no dark frame at the seam |
  | `P-ROOM-03-half-room-strobe` | `halves` split across the DJ axis, SplitAlternate at 1/2 beat | On even half-beats every left-half cell is at the flash level and every right-half cell is dark, and the reverse on odd half-beats; lamps join their side; cells in the feather band follow DS-33 |
  | `P-ROOM-04-two-way-pulse` | Geodesic Ripple from the DJ anchor, "reach far side in 4 beats" | Both wavefronts leave the DJ projection together, are symmetric in time, and meet at the antipode on beat 5 within one tick |
  | `P-ROOM-05-mirrored-detected` | SIM strip wired as split-mirrored | Wizard classifies `split-mirrored`; Orbit and PerimeterOrbit are disabled for it with the reason shown; SymmetricSweep is offered and renders |
  | `P-ROOM-06-logical-zero-and-remap` | Set another segment as logical zero, restart the app; then move the controller (new seam) and re-run wizard steps 2 to 4 | Logical zero persists across restart; after the remap, every primitive's golden frame in logical space is unchanged |
  | `P-ROOM-07-gaps-and-chunks` | Three chunks with two dark gaps | Orbit head crosses each gap dark for exactly the gap's length in time and reappears at the right place |
  | `P-ROOM-08-unknown-primitive` | A cue with an unregistered type | Registry, validator and renderer each raise a typed error |
- DoD: goldens committed through `yarn golden:update --reason`; review PNGs in
  evidence; every `P-ROOM-*` probe passes on SIM; `P-ROOM-01`, `02`, `03`,
  `04` and `06` also pass on the owner's rig (HW runbook with video).

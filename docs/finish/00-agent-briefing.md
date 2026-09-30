# 00. Agent briefing

Read all of this before you touch code. It is written for an agent that has no
memory of the previous work and that may believe the previous work was good.

## 1. Your situation, stated plainly

You are finishing AutoLight: an Electron + React + TypeScript desktop app (Yarn 4
workspaces) with a Python analysis worker (managed only with `uv`). It follows a
DJ's decks in Rekordbox (primary) or Serato (secondary) with a Pioneer DDJ-FLX4,
understands each track's structure ahead of time, compiles a lighting score, and
drives Govee RGBIC lights (two or more H6076 floor lamps and an H1A45 20 m strip
that runs around the ceiling perimeter of the owner's room) so the show looks
programmed by a lighting designer.

The previous implementation pass produced a clean-looking monorepo that builds,
typechecks and passes its tests. Six independent reviews and a direct audit
then established that it does not do the job. The facts, all verified by
reading or executing the code on 2026-09-29 and 2026-09-30:

- No lighting frame ever reaches a light. `pushFrame` in
  `apps/desktop/electron/show-service.ts` has zero callers.
- When a frame is sent, the code collapses every segment to one middle colour,
  sends `turn on` + `brightness` + `colorwc` per frame (three datagrams, each
  from a freshly spawned `node -e` process that never exits), and sends
  `turn off` for blackout. Spec section 47 forbids power-off blackout. Section
  153 says a project that drives an H6076 as one RGB bulb does not satisfy the
  specification.
- The razer segment frame encoder produces `bb 03 b1 01 b3` for "arm". The
  pinned toolkit, which was cloned and "pinned" in `vendor/govee-toolkit/PIN.md`
  but never actually used, specifies `bb 00 01 b1 01 0a` inside a JSON envelope
  with base64. The wrong frame would be silently dropped by the lamp.
- The Live screen shows two committed fixture tracks (`live-homecoming`,
  `live-deck2`) served from `test-fixtures/` because `vite.config.ts` sets
  `publicDir` to the test fixtures folder. Both decks are hardcoded
  `playing: true`, faders at 1.0. The "show loop" is a 250 ms `setInterval` in
  React.
- 15 of the 23 IPC channels, including BLACKOUT, FULL, FREEZE, master
  intensity and resume, only validate their payload and echo it back. The big
  red BLACKOUT button does nothing.
- Rekordbox live follow is a 1 Hz AppleScript scrape of window text plus a PRO
  DJ LINK listener that expects 60-byte beat packets (real ones are 96 bytes)
  and reads the wrong offsets. The owner's highest priority research item
  (`rkbx_link`, a 60 to 120 Hz Rekordbox memory reader) was never considered.
- Serato, FLX4 MIDI, BLE, Matter, the Rekordbox database reader, the analysis
  worker supervision, persistence, packaging and the qualification wizard are
  missing or are pure helper functions that nothing calls.
- The Python worker has a `NameError` hidden inside `except Exception: pass`
  that silently discards every ML structure event while still labelling the
  analysis `full`.
- Several tests cannot fail: an E2E test whose body is
  `expect(true).toBe(true)`, a "protocol replay" that returns its own expected
  output, a "4 hour soak" that runs a synchronous loop in 21 seconds with a
  queue counter reset every iteration, and a planner golden that writes itself
  when missing. 214 reported Vitest passes are about 111 real tests counted
  twice (source plus compiled `dist` copies). Three Python tests depend on
  files at `/Users/rocket/...` and fail everywhere else, so CI is red as
  committed.
- The README capability table claims Rekordbox SQLCipher access, a Serato
  Remote transport, a Lighting IPC provider, H6076 + H1A45 "discovery, arm,
  stream", a qualification wizard and reconnect re-arm. None of those exist as
  running code.

If you are the same agent that produced that pass: this is not a criticism of
effort, it is a description of the output. The repository's own `AGENTS.md`
already forbade almost every one of these failures (sections 6, 9, 11, 27, 32,
33 and 37). The rules existed. They were not followed. This briefing turns
those rules into mechanical checks and names the specific scars so they cannot
recur.

## 2. What finished means

The project is finished when `99-final-acceptance.md` passes in full. That file
restates SPEC section 153 (hard definition of done) and section 152 (gates A
to H) as an executable script with measured thresholds, plus the owner's
additions. In short: a user installs the packaged app on a clean supported Mac
or Windows machine, connects a DDJ-FLX4, opens Rekordbox or Serato, discovers
and visually places and calibrates the Govee rig (including drawing the room
and mapping the ceiling strip), selects playlists for analysis, and DJs
normally for four hours while the lights produce phrase-aware, drop-aware,
spatially coordinated, segmented lighting with no manual intervention and no
cloud round trip, through pitch changes, hot cues, loops, seeks, crossfades,
two audible decks, brief fixture disconnects and a busy UI.

This round is a finish round. The owner's words: "no more v2 or fixes, all
suggestions and ideas and concepts, all features to the fullest extent". That
means:

- Every item in `01-findings-register.md` is closed by a task, including the
  ones labelled Low or Medium.
- Every spec section in `02-conformance-matrix.md` reaches its definition of
  done.
- Where the owner asked for alternatives ("implement both and one that combines
  the best of each"), all of them are implemented behind a visible switch
  (`03-config-and-decisions.md`).
- The words "future", "later", "v2", "phase 2", "TODO", "FIXME", "ponytail",
  "stub", "placeholder", "mock" (outside test helpers), "not yet", "coming
  soon" do not appear in production code, UI copy or user docs when you
  finish. `T-TRU-06` adds a CI check.

### 2.1 The ten-point definition of done for every capability

A capability (anything with an entry in `capabilities.yaml`, see `T-TRU-05`)
is done only when all ten of these are true. A task's own definition of done
adds to this list; it never replaces it.

| # | Word | Meaning | How it is checked |
| --- | --- | --- | --- |
| 1 | IMPLEMENT | The behaviour exists in production code, not in a helper, a test, a comment or a simulator | Knip and dependency-cruiser required-reachability rules (`T-TRU-04`) |
| 2 | TRACE | It is reachable from the production entry point (`apps/desktop/electron/main.ts` or the show host entry) through the real service graph, with no test-only wiring | Reachability rule plus an integration test that starts from the entry point |
| 3 | PROVE | A test exercises the real code path and asserts the observable result (bytes on a socket, a row in the database, a frame at the recording transport, pixels in a screenshot) | Evidence README names the test and the observation |
| 4 | BREAK | The test was seen failing against the broken or missing behaviour, and mutation testing on the module does not leave the assertion alive | `red-run.txt` in evidence; Stryker or mutmut report (`T-TRU-08`) |
| 5 | MEASURE | Every timing, rate, latency or accuracy claim has a measurement JSON from the harness in `wp15`, with machine description | `measurement.json` in evidence |
| 6 | PERSIST | Anything the user configures or the system learns survives an app restart and a schema migration | Restart test in the integration suite; migration test (`T-DATA-*`) |
| 7 | EXPOSE | The user can see its status, its configuration (every tunable, `03`), and its failure reason in the UI without developer tools | Playwright test against the real Electron app |
| 8 | DOCUMENT | User and developer docs describe the behaviour as measured, linked to the capability ID | Claim check (`T-TRU-05`) |
| 9 | PACKAGE | It works from the packaged installer on a clean machine, not only from `yarn dev` (native addons, asar unpack, Python runtime, permissions) | Smoke-install job (`T-TRU-11`, `T-OPS-*`) |
| 10 | NO HOLLOW CORE | Nothing on the path is an echo, a fixture, a constant pretending to be a measurement, a swallowed error or a `void`-discarded value | ast-grep rule pack (`T-TRU-06`), bundle fixture scan (`T-TRU-02`) |

## 3. The scars: what went wrong, the rule, and the mechanical check

Each scar below happened in this repository. Each has a rule and a check that
runs in CI (`T-TRU-*`). If you find yourself doing one of these, stop.

| # | Scar (real example in this repo) | Rule | Mechanical check |
| --- | --- | --- | --- |
| S1 | Echo IPC handlers behind real buttons (`apps/desktop/electron/ipc.ts:49-52`) | Every IPC channel has a handler that changes authoritative state or returns authoritative data, and an integration test proves the side effect | ast-grep rule `no-echo-ipc`; `T-TRU-03` IPC side-effect test enumerates every channel |
| S2 | Tests that cannot fail (`e2e/night.spec.ts:33-35` `expect(true).toBe(true)`; `replayFixture` returning expectations; soak resetting `pending = 0`; golden self-write) | A test must be shown failing against the broken behaviour before it is trusted. Record the red run in the evidence folder | ast-grep `no-tautological-expect`, `no-golden-self-write`; mutation testing on critical packages (`T-TRU-08`) |
| S3 | Test fixtures served as live data (`vite.config.ts` `publicDir: test-fixtures`; `resolve-live.ts` hardcoded filenames; `makeDeck`/`makeFixture` in production) | Production code never imports `@autolight/simulator` or reads `test-fixtures/`. Demo data only exists behind an explicit, visible "Simulator" mode | dependency-cruiser forbidden rules; bundle scan for fixture filenames (`T-TRU-02`) |
| S4 | Comments and docs that claim behaviour the code does not have (IDENTIFY "full-white 1s flash, then restore" sends only power on; TEST CHASE "3-step ramp" sends one brightness; "this is wired" in audio-sync; README capability table) | A comment describes what the code does, not what it should do. Capability claims come only from the capability manifest, which requires evidence | `capabilities.yaml` + README generated from it; claim check (`T-TRU-05`) |
| S5 | Swallowed errors (`except Exception: pass` in `worker.py`; `.catch(() => undefined)` in `store.ts`; `socket.on("error", () => undefined)` in `follow.ts`) | No bare swallow. Every catch either handles a named, expected condition, or records a typed error into diagnostics and surfaces status | Ruff `BLE001`/`S110`, ast-grep `no-empty-catch`, `no-catch-undefined` |
| S6 | Invented measurements displayed as real (`venue-view.tsx` 14 segments, 30 fps, 25 ms, online) | Unknown stays unknown and is displayed as unknown. A number shown to the user is either measured (with a receipt) or labelled as a default | ast-grep rule for literal metrics in UI; UI E2E asserts "unmeasured" labels before qualification |
| S7 | Work in the wrong layer (show loop in React; audio capture in React; AX polling in both main and renderer) | Follow `04-target-architecture.md`. The show host owns time and output. The UI observes and sends intents | dependency-cruiser: renderer may not import show-runtime, renderer, show-mixer, govee |
| S8 | Dead code shipped as features (`pushFrame`, `DeviceManager`, `FrameCoalescer`, `blendRgb`, `trackDeck`, `loopBeat`, `AnalysisClient`, `Store`, `classifyCC` all have no production callers) | A capability is not implemented until it is reachable from the production entry point and exercised by an integration test | Knip unused-exports gate; required-reachability rules (`T-TRU-04`) |
| S9 | Compute then discard (`void identity` in the planner; `void predicted` in the runtime; `void kind`, `void seedHex`, `void len`) | Never `void` a computed value to silence a linter. Use it or delete it | ast-grep `no-void-discard` |
| S10 | Duplicate implementations that drift (PSSI label tables in TypeScript and Python; `latencyBeats` in two packages; two `grid_warning` functions) | One source of truth per concept. Cross-language data is generated from one definition | Duplicate-code check (`jscpd`) and generated JSON for shared tables |
| S11 | Tests that use inputs the real system never produces (`translateBlackout` test uses `target: "SIDE"`, the planner only emits `ALL`) | Unit tests use inputs produced by the real upstream code, or property-based generators that cover the real domain | Review checklist item; mutation testing exposes it |
| S12 | Unit mismatches hidden by names (`toNativeBeat` multiplies `sourceTimeMs` by 1000; `isSeek` called with beats as seconds; 0-based grid index versus 1-based PSSI beats) | Branded types for units (`Seconds`, `Milliseconds`, `Beat`, `BeatIndex0`) and one beat origin convention documented in contracts | Type-level brands; property tests for round trips |
| S13 | Stopping at an environment blocker instead of building everything that does not need the environment (no hardware on LAN so no transport code; no SoundSwitch so no provider) | When blocked on hardware, build the full implementation, a protocol-accurate simulator, replay fixtures from published protocol documentation, and a runbook. Mark only the physical qualification step as `BLOCKED-HARDWARE` | Status board rules below |
| S14 | Choosing the easiest path and recording it as a decision (ADR-001 made a preview mode the default and AX polling the first live path, and never evaluated rkbx_link) while ignoring the owner's research | Decisions between approaches are the owner's. Implement all serious options behind a visible switch and a combined option. Record measurements that let the owner choose | Decision switch catalog must be complete (`T-CFG-06`) |
| S15 | Over-claiming in README and docs | README capability table is generated from `capabilities.yaml`; docs describe measured behaviour | `T-TRU-05` |
| S16 | A process spawned per UDP datagram | Hot paths use persistent resources. No `child_process` in any show-time path | ast-grep `no-child-process-in-hot-path` scoped to transport and runtime packages |
| S17 | Violating explicit spec prohibitions while tests pass (power-off blackout; single colour H6076; per-beat global brightness) | Each spec prohibition gets a runtime invariant and a test that reads the actual bytes sent | Recording transport asserts (`T-GOV-14`) |
| S18 | Inflated test counts (compiled `dist` tests collected by Vitest) | Vitest includes `src/**` only | CI prints unique test count; fails if `dist` tests are collected |
| S19 | Machine-specific paths in tests (`/Users/rocket/...`) | Tests use committed, license-safe fixtures or generated fixtures. Owner-machine tests are opt-in behind an environment variable and skipped with a visible reason | ast-grep `no-absolute-user-path` |
| S20 | Implementing a protocol without reading its source (razer encoder written from memory while the toolkit source was on disk) | Before implementing any protocol, read the upstream source and documentation, cite file and line in the code header, and build golden vectors from the upstream implementation | Code review checklist; golden vector tests |
| S21 | Hardcoded tunables everywhere (thresholds, ports, intervals, budgets, gamma) | Every tunable is a key in `@autolight/config` with default, unit, range, receipt and UI visibility | ast-grep `no-magic-number` in listed packages (`T-CFG-04`) |
| S22 | Labelling analysis `full` when ML failed | Readiness is per input, and the label is computed from what actually ran | Contract test on the readiness object |
| S23 | "Verified" claims that are transitive (a helper's unit test used as proof that the product works) | AGENTS.md section 32: verification does not transit across dependency edges | Evidence README must name the exact behaviour observed |
| S24 | Paths that only work from the source tree (`packages/analysis-client/src/index.ts:14` defaults the Python project to `"../../analysis"`, relative to whatever the current directory is) | Every runtime path is resolved from `app.getAppPath()`, `process.resourcesPath` or `app.getPath("userData")` through one path service, and is a config key when the user may change it | ast-grep `no-relative-runtime-path` (string literals starting with `../` passed to spawn, fs or path APIs outside tests); smoke-install job launches the packaged app |
| S25 | Assuming developer tools exist on the user's machine (`show-service.ts:94` runs `execFile("node", ...)`; a packaged app has no `node` on PATH) | The packaged app ships or locates everything it runs (bundled `uv`, Python, FFmpeg). Never spawn `node`, `npx`, `python` or `pip` from product code | ast-grep `no-spawn-dev-tools`; smoke-install on a clean VM with no Node or Python installed (`T-OPS-06`) |
| S26 | Unbounded live queues (the renderer "soak" counted a queue it reset each iteration; any `push` to an array consumed at show rate risks growth) | Every queue between producer and consumer at show time is bounded with an explicit policy: latest-wins for state, bounded ring with drop counter for events. The drop counter is a metric | ast-grep `no-unbounded-live-queue` (array `push` in `packages/show-*`, `packages/govee`, `packages/rekordbox-live`, `packages/controller-flx4` without a paired bound check); runtime invariant in `T-TRU-12` |
| S27 | Hidden failover (a transport or provider silently switching to a worse source and still reporting success; the code comment "Lightwave order" for a BLE fallback that never existed) | Every switch of transport, provider or analysis level is an event: logged, recorded, shown on the tile or status bar, counted in metrics, and reversible by the user's explicit mode choice | Integration tests assert the event and the UI banner for every switch (`T-FOV-02`, `T-LIVE-02`) |
| S28 | Dead branches in release builds (`if (process.env.X)` demo paths, fixture branches, "simulate" flags reachable in production) | Simulator mode is the only demo path, it is explicit and badged, and release builds contain no other environment-gated behaviour switches | Bundle scan for known debug flags and fixture names (`T-TRU-02`); Knip on the release entry |

## 4. Operating rules

### 4.1 Toolchain

- JavaScript: Yarn 4.9.2 workspaces only. `yarn add`, `yarn workspace <name> add`,
  `yarn dlx`. Never npm or npx.
- Python: `uv` only. `uv add`, `uv sync --frozen`, `uv run`. Never pip.
- Native Node addons (govee-toolkit, better-sqlite3, @julusian/midi, BLE) must
  be rebuilt or fetched for Electron's ABI. Use `@electron/rebuild` through
  `yarn dlx` or a workspace script, and configure `asarUnpack` for `.node`
  files (`T-OPS-*`).
- Rust (only if you fork govee-toolkit or build the clean-room memory reader):
  `cargo` through a Yarn script so CI runs it the same way.

### 4.2 Before implementing anything that talks to the outside world

1. Read the upstream source that already solves it. `docs/research/prior-art-reuse.md`
   lists what to reuse, what is study-only (GPL, unlicensed) and why.
2. Put a provenance header in the file you write: upstream repo, commit, file,
   license.
3. Build golden vectors from the upstream implementation (for example, encode
   the same frame with govee-toolkit and with your code and compare bytes).
4. Write the simulator side at the same time (a fake Govee device that speaks
   the real protocol over a real UDP socket; a fake rkbx_link OSC sender; a
   fake ProLink beat packet emitter; a fake MIDI port).

### 4.3 One vertical slice before breadth

Milestone M1 in `README.md` exists because the last pass built breadth with no
working spine. Do not start WP09 (Serato) before the M1 slice runs.

### 4.4 Every number is configuration

Every threshold, interval, budget, port, timeout, rate, gamma, weight and
default lives in `@autolight/config` with a unit, range, default, receipt and a
row in the Settings UI. See `03-config-and-decisions.md`. Protocol constants
that are true invariants (opcode `0xB1`, the multicast group, GATT UUIDs) live
in a read-only protocol constants file per transport, are shown read-only in
Settings, and cite their source.

### 4.5 Decisions are switches

When there is more than one serious way to do something, implement each, plus
a combined mode that takes the best of each, and expose the choice as a visible
switch with measurements beside it. The owner decides later. The catalog is in
`03-config-and-decisions.md`. Never delete an option because you prefer another.

### 4.6 Every confirmed bug becomes a detector

This repository uses Bug Corpus (`CLAUDE.md`, `.claude/skills/bug-corpus/SKILL.md`).
For every defect in `01-findings-register.md` that you fix: prove the fix with
tests, then `uv run bugcorpus learn --title "..."`, state symptom versus root
cause versus violated invariant, search siblings, synthesize and verify a
detector, and record the BugCase ID in the evidence README. A fix without a
BugCase ID and without a written reason is unfinished.

### 4.7 Errors are visible

Nothing fails silently. Every subsystem reports a typed status (`ok`,
`degraded` with reason, `failed` with reason, `unavailable` with reason) into
diagnostics, and the UI shows it without modals during Live mode (spec 144).

### 4.8 Units and conventions

- Musical positions: `Beat` (fractional, 1-based, beat 1 is the first native
  grid beat). Grid anchors keep a 0-based `index`. Contracts document the
  conversion and all code goes through the helper. Decide this in `T-RBL-03`
  and apply everywhere.
- Time: `Ns` bigint monotonic nanoseconds from `process.hrtime.bigint()` in the
  show host; `Ms` and `Seconds` branded numbers elsewhere.
- Colour: `Oklab`/`Oklch` for design, linear-light RGB for intensity and
  mixing, sRGB bytes only at the transport boundary.

## 5. Evidence protocol

### 5.1 Status vocabulary

| Status | Meaning |
| --- | --- |
| `TODO` | Not started |
| `IN-PROGRESS` | Being worked on |
| `DONE-VERIFIED` | Every definition-of-done item is met and every one has evidence in `docs/finish/evidence/<TASK-ID>/` |
| `BLOCKED-HARDWARE` | All code, simulators, replay fixtures and runbooks are finished and verified; only a physical step that needs the owner's hardware or software is outstanding. The runbook is in the evidence folder and names exactly what the owner must run and what artifact to send back |
| `BLOCKED-OWNER-DECISION` | A choice reserved for the owner (see 7) blocks progress. The question is written in STATUS.md with the options and your measurements |
| `CLOSED-OWNER-DECLINED` | The owner answered an owner decision with "no" (for example, no SoundSwitch capture, no memory reader). Everything that does not need the declined step is built and verified; `docs/finish/evidence/<TASK-ID>/decision.md` records the question, the answer, the date, and exactly which spec items are therefore not met. Those items are listed in `99-final-acceptance.md` section 11 as deviations the owner accepted. This is a terminal status; it is never used for anything the agent could have built |

There is no "done", "mostly done", "done except tests" or "beta".

### 5.1a Capability status (what the product and the README say)

Task status (above) is for this plan. Capability status is what
`capabilities.yaml`, the generated README table, Diagnostics and the Setup
screen show to the user. It is per capability and, for hardware, per device
unit.

| Status | Meaning | May the UI or README call it working? |
| --- | --- | --- |
| `PASS` | All ten points of section 2.1 are met, and for hardware capabilities the unit has a qualification record with firmware and date | Yes, for exactly the scope the evidence covers |
| `IMPLEMENTED_UNQUALIFIED` | Code complete and proven against simulators and replay; not yet qualified on the physical unit or the real third-party software version | No. Shown as "implemented, not qualified on this device" |
| `PARTIAL` | Some of the required behaviour exists; the manifest lists exactly which parts are missing | No. Shown as "partial" with the missing list |
| `FAIL` | Implemented but a qualification or acceptance probe failed; the failure record is linked | No. Shown as "failed" with the reason |
| `UNAVAILABLE_ON_THIS_DEVICE` | The capability exists but this machine, OS, device firmware or installed software cannot provide it (for example AX follow on Windows, Lighting IPC on Rekordbox 7.2.10, BLE with Bluetooth off) | No. Shown with the reason and what would make it available |

Rules: nothing converts `IMPLEMENTED_UNQUALIFIED` to `PASS` except a
hardware or real-software qualification artifact. A simulator run never
produces `PASS` for a hardware capability. The manifest checker (`T-TRU-05`)
enforces this, and the UI reads the same statuses at runtime so the app and
the README can never disagree.

### 5.2 What counts as evidence

| Claim type | Required evidence |
| --- | --- |
| Pure logic | Unit or property test output, plus the red run against the old behaviour where a defect was fixed |
| Integration (two or more packages) | Integration test output that runs the production code path, not mocks of the collaborators |
| UI behaviour | Playwright test driving the real Electron app (`_electron.launch`) plus a screenshot or short video |
| Network protocol | Golden vector test against upstream, plus a capture (`.pcapng` or recorded frames) from the simulator, plus a capture from real hardware when available |
| Performance claim | A measurement JSON produced by the harness in `wp15`, the machine description, and the command that produced it |
| Hardware behaviour | Video (240 fps where timing matters), device firmware versions, the qualification JSON the app wrote, and the runbook used |

### 5.3 Claim language

Follow AGENTS.md sections 32 and 33. Do not write "verified", "working",
"fixed", "complete" or "passes" for anything broader than what the evidence
directly exercised. "The recording transport received 60 black frames and zero
power commands after BLACKOUT" is a claim. "Blackout works" is not.

### 5.4 Evidence folder layout

```text
docs/finish/evidence/T-GOV-03/
  README.md          what was claimed, what was run, what was observed, BugCase IDs
  red-run.txt        the failing test output before the change (for defect fixes)
  green-run.txt      the passing output after
  capture.pcapng     where relevant
  measurement.json   where relevant
```

## 6. When hardware or third-party software is missing

The owner's rig: macOS on Apple Silicon (confirm in `T-OPS-01`), Rekordbox
7.2.10.0333 (as of 2026-09-29), a DDJ-FLX4, H6076 lamps, an H1A45 strip on the
ceiling perimeter, no SoundSwitch installed.

If you run on a machine without them:

1. Build the complete implementation anyway.
2. Build or extend a simulator that speaks the real protocol on real sockets or
   ports (Govee LAN device simulator, BLE peripheral simulator through the
   transport's adapter seam, rkbx_link OSC emitter, ProLink packet emitter,
   virtual MIDI port, Serato Remote emulator from serato-connect's test
   fixtures).
3. Verify everything against the simulator.
4. Write the runbook for the physical step in the evidence folder: exact
   commands, the app screens to use, what to record, what the pass criteria are,
   and what files to send back.
5. Mark only that physical step `BLOCKED-HARDWARE`.

Never mark a hardware task `DONE-VERIFIED` from the simulator alone. Never skip
building code because the hardware is absent.

## 7. Decisions reserved for the owner

Ask in STATUS.md (and stop that task only) before:

- instructing the owner to update Rekordbox, install SoundSwitch (paid plan or
  trial), or re-sign Rekordbox for memory reading;
- shipping vendor BLE encryption keys in the product (see `T-BLE-07`);
- bundling any GPL binary (rkbx_link) in the installer;
- spending money (Apple Developer ID for notarization, Windows code signing
  certificate);
- anything that writes to the Rekordbox or Serato libraries (never allowed);
- anything that sends data off the machine (never allowed during performance;
  cloud metadata only with an API key the owner provides).

Everything else, decide by implementing the options behind switches.

## 8. How to finish a task

1. Mark it `IN-PROGRESS` on STATUS.md.
2. Write the failing probe named in `02-conformance-matrix.md` or the task.
   Run it and save the red output.
3. Implement.
4. Make the probe and every definition-of-done test pass. Save outputs.
5. Run the full gates: `yarn truth` (alias `yarn audit:truth`), `yarn typecheck`,
   `yarn lint`, `yarn test`, `uv run --project analysis pytest -q`,
   `yarn workspace @autolight/desktop test:e2e`. `yarn verify:all` runs all of
   them in CI order.
6. Bug Corpus learn for defects.
7. Update docs that describe the behaviour.
8. Write the evidence README.
9. Mark `DONE-VERIFIED` (or `BLOCKED-HARDWARE` with the runbook, or
   `CLOSED-OWNER-DECLINED` with the decision record).
10. Update `AGENTS.md` repository memory with durable learnings and any new
    scar (section "Known agent anti-patterns / scars").

### 8.1 Questions to answer in writing before you mark anything done

Put the answers in the evidence README. If any answer is "no" or "I am not
sure", the task is not done.

1. If I delete the new code, which test goes red? (If none: the tests do not
   test it.)
2. Starting from `main.ts` or the show host entry, what is the exact chain of
   calls that reaches this code in the packaged app?
3. What does the user see when this fails, and did I make it fail on purpose
   to check?
4. Which numbers in this change are not config keys, and why are they true
   protocol invariants?
5. Is there any other way to do this that the owner might prefer? Is it
   implemented behind the switch, with the combined mode?
6. What did I read from upstream before writing this, and is the provenance
   header in the file?
7. What would a hostile reviewer say is fake here (a constant pretending to be
   a measurement, a fixture, an echo, a swallowed error, a test that cannot
   fail)? Did I check each?
8. Does the claim I am about to write describe exactly what the evidence
   exercised, and nothing broader?
9. Does it still work after an app restart, a renderer reload, a device
   disconnect and a clean install?
10. Is the capability status in `capabilities.yaml` still truthful after this
    change?

## 9. Final handoff format

When you stop (for any reason), leave in STATUS.md:

- a table of every task with status and evidence link;
- the exact commands to reproduce your final gate runs and their outputs;
- the list of `BLOCKED-HARDWARE` runbooks the owner must run, in order;
- the list of open owner decisions with your measurements;
- anything you are unsure of, stated as uncertainty, not as success.

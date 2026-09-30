# AutoLight finish plan

Date written: 2026-09-30. Owner: Carter LaSalle. Audience: the coding agent that
will finish AutoLight, starting with zero context.

This folder is the complete work order for turning the current repository into
the product described in `docs/SPEC.MD` (sections 1 to 155), plus the owner's
additions (rkbx_link, the Govee transport ladder including BLE and Matter,
visible configuration for every tunable, decision switches, and ceiling
perimeter room mapping). It is a finish round, not a fix round. Nothing in here
is optional, nothing is deferred to a "v2", and nothing is allowed to ship as a
stub, a demo path, or a claim without evidence.

## Reading order (mandatory, in this order, before writing any code)

| # | File | What it is | Time |
| --- | --- | --- | --- |
| 1 | [00-agent-briefing.md](00-agent-briefing.md) | Who you are, what went wrong last time, the rules, the evidence protocol | Read every line |
| 2 | [01-findings-register.md](01-findings-register.md) | Every defect and gap found by every review, with verification status and the task that closes it | Read every line |
| 3 | [02-conformance-matrix.md](02-conformance-matrix.md) | SPEC section 1 to 155, each tied to a failing probe, a definition of done and a metric | Read every line |
| 4 | [03-config-and-decisions.md](03-config-and-decisions.md) | The configuration system, the full config key catalog and every decision switch | Read every line |
| 5 | [04-target-architecture.md](04-target-architecture.md) | The processes, threads, data flow, IPC surface and package map you are building toward | Read every line |
| 6 | The work packages below | Task-by-task instructions with definitions of done | Read the one you are working on, completely, before starting it |
| 7 | [99-final-acceptance.md](99-final-acceptance.md) | The end-to-end acceptance script that decides whether the project is finished | Read before you start so you know the finish line |

## Work packages

| WP | File | Scope |
| --- | --- | --- |
| WP00 | [wp00-truth-and-gates.md](wp00-truth-and-gates.md) | Remove every fake, make tests able to fail, CI truth gates, capability manifest, documentation honesty |
| WP01 | [03-config-and-decisions.md](03-config-and-decisions.md) | `@autolight/config`, settings UI, decision switches (tasks `T-CFG-*`) |
| WP02 | [04-target-architecture.md](04-target-architecture.md) | Show host process and worker, IPC API, startup and shutdown (tasks `T-ARC-*`) |
| WP03 | [wp03-govee-lan.md](wp03-govee-lan.md) | govee-toolkit, razer segment stream, persistent sockets, discovery ladder, device manager, qualification, calibration |
| WP04 | [wp04-ble-matter-cloud-failover.md](wp04-ble-matter-cloud-failover.md) | Full BLE transport, Matter controller, cloud metadata client, transport failover policy |
| WP05 | [wp05-room-and-venue.md](wp05-room-and-venue.md) | Room editor, ceiling perimeter strip mapping, spatial fields, spatial effects, venue persistence |
| WP06 | [wp06-rekordbox-library-identity.md](wp06-rekordbox-library-identity.md) | master.db, ANLZ full extraction, library watcher, durable track identity |
| WP07 | [wp07-rekordbox-live.md](wp07-rekordbox-live.md) | Every Rekordbox live provider (rkbx_link OSC, Lighting IPC, ProLink, AX, composite FLX4, clean-room memory reader) plus the fusion provider |
| WP08 | [wp08-flx4.md](wp08-flx4.md) | DDJ-FLX4 MIDI telemetry, full map, expressive hints |
| WP09 | [wp09-serato.md](wp09-serato.md) | serato-connect integration, GEOB, crates, replay |
| WP10 | [wp10-analysis.md](wp10-analysis.md) | Python analysis worker, ML, DSP, events, fusion, provenance, cache |
| WP11 | [wp11-planner.md](wp11-planner.md) | Whole-song identity, palettes, hierarchy, primitives, restraint, contrast, recurrence, corrections |
| WP12 | [wp12-runtime-mixer-renderer.md](wp12-runtime-mixer-renderer.md) | Show clock, estimator, seek, loop, scratch, two-deck mixer, layer stack renderer, latency, live audio overlay, adaptive director, overrides |
| WP13 | [wp13-ui.md](wp13-ui.md) | Every screen, component library, emergency controls, manual lane, settings, accessibility |
| WP14 | [wp14-data-security-ops.md](wp14-data-security-ops.md) | Storage, cache versioning, logging, metrics, session recorder, security, updates, packaging |
| WP15 | [wp15-verification-qualification.md](wp15-verification-qualification.md) | Test classes, goldens, replay, fault injection, soak, performance measurement, hardware runbooks, gates A to H |

## Tracking

- [STATUS.md](STATUS.md) is the single status board. Every task ID and every
  finding ID appears there. You update it in the same change that does the work.
- Evidence for every closed task lives in `docs/finish/evidence/<TASK-ID>/`.
  The briefing defines what counts as evidence.
- `node docs/finish/tools/check-coverage.mjs` checks that every finding in the
  register is claimed by its closing tasks (and each closing task names it),
  every task appears on the status board and nothing on the board is a
  phantom, every task reference in the plan resolves, every task marked
  `DONE-VERIFIED` has an evidence folder with a `README.md` (and every
  `BLOCKED-HARDWARE` task a `runbook.md`), every SPEC section 1 to 155 has a
  matrix row, every probe, decision switch, hardware runbook and config key
  referenced is defined, and no finish-plan document contains an em-dash. CI runs it (task
  `T-TRU-01`). It was run against seeded violations while this plan was
  written and failed on each, so it can fail.

## Relationship to the companion "Final Completion Contract"

The owner also received a completion contract from another agent. Its useful
parts are merged into this plan: the ten-point per-capability definition of
done and the capability status vocabulary (`00-agent-briefing.md` sections 2.1
and 5.1a), stricter coverage and mutation gates (`T-TRU-07`, `T-TRU-08`),
extra anti-regression scars S24 to S28, the per-device transport modes
(DS-31, `T-FOV-01`), the electrical seam versus logical zero versus
performance anchor model, spline paths, signed split distances, tangents,
physical versus logical indices, the extra spatial primitives and the room
probes (WP05), readiness capability keys (`wp10`), the emergency E2E steps,
10-minute CI timing job and nightly four-hour soak (`wp15`), and a probe
family alias table (`99-final-acceptance.md` section 7). Where the two
documents differ, this plan governs.

## Milestones

The work packages are large. Execute them in these milestones, in order. The
assignment follows real dependencies: a task sits in the milestone where its
whole definition of done can be met with work from that milestone and the
ones before it.

Rules:

- A milestone is complete when its exit proof passes and every task assigned
  to it is `DONE-VERIFIED`, or terminally `BLOCKED-HARDWARE` (runbook written,
  only the owner's physical step left) or `CLOSED-OWNER-DECLINED` (see
  `00-agent-briefing.md` section 5.1).
- An exit proof may exercise tasks from a later milestone in a partial state
  (for example the M1 slice uses the existing planner before WP11 rewrites
  it). Those tasks stay `IN-PROGRESS` until their own milestone; partial work
  is never marked done.
- Gates introduced in M0 ratchet (`wp00`): they start red, their finding
  counts may never grow, and each turns blocking the moment its count reaches
  zero.

| Milestone | Theme | Exit proof |
| --- | --- | --- |
| M0 Truth and harness | WP00 truth gates, config registry and Settings, show host and typed IPC, startup and shutdown, Electron hardening, the component library, the Govee simulator and recording transport, the Electron E2E harness | CI shows every fake that exists today as a red gate; no echo IPC remains without a ratchet entry; fixtures are out of production bundles; tests can fail; the E2E harness launches the real app in Simulator mode on three OSes |
| M1 Vertical slice | Govee LAN engines, stream lifecycle, qualification state machine; Rekordbox library reader and beat mapping; the first live providers (rkbx-osc, ProLink, AX, agent API) and fusion; storage; runtime core, overrides and the emergency path; layer stack; replay and performance harnesses | The minimum proof scenario in `99-final-acceptance.md` section 2 runs end to end against the simulator and, where hardware is present, against real lights |
| M2 Transports and sources | The rest of WP03, BLE, Matter, cloud, failover policy, Lighting capture tooling, OS2L, memory reader, Link, version registry, FLX4, Serato transport and library, live audio capture and DSP, source-loss handling, application-level fault simulation | Every provider and every transport selectable by its decision switch, replay-tested and fault-tested |
| M3 Intelligence | Validation set (first, it needs the owner), analysis worker, ML, DSP, events, fusion, TrackModel v2, full ANLZ, identity, planner, colour pipeline, composite provider, fast path, structured logging across processes | The curated validation set produces events and plans that pass invariants and diagnostics; goldens committed deliberately |
| M4 Room | WP05, the primitive registry, primitive renderers, global latency, physical regions, renderer goldens, capability-aware rendering | Ceiling perimeter mapping and every spatial effect demonstrated on the simulator and on the owner's rig (`P-ROOM-*` probes) |
| M5 Product | Mixer, adaptive director, overlay, every screen, security, metrics, recorder, packaging | Every screen and workflow works without developer tools; packaged installers build |
| M6 Qualification | Class enforcement, soak, sync matrix, camera qualification, gates, clean installs, documentation set | Gates A to H pass; `99-final-acceptance.md` passes in full |

`STATUS.md` lists the exact tasks of each milestone (generated by
`node docs/finish/tools/make-status.mjs` from the mapping in that script,
which keeps existing status cells when rerun after adding tasks). Read the
milestone's task list there before starting it.

## Style rules for anything you write in this repository

- Do not use em-dashes in prose you write (owner preference). Use commas,
  colons, parentheses or separate sentences. The coverage tool fails on them in
  this folder.
- Use `yarn` (Yarn 4) for every JavaScript operation and `uv` for every Python
  operation. Never `npm`, `npx`, `pnpm`, `pip`, `pipx`, `poetry` or
  `python -m pip`. Use `yarn dlx` where you would have reached for `npx`.
- Keep `docs/SPEC.MD` normative. When this plan and the spec disagree, the
  spec wins unless this plan says it is extending the spec at the owner's
  request (rkbx_link, BLE, Matter, visible config, decision switches, room
  perimeter mapping).

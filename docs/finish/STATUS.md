# STATUS

The single status board for the finish plan. Update it in the same change
that does the work (`00-agent-briefing.md` section 8). Generated skeleton:
`node docs/finish/tools/make-status.mjs` (keeps existing cells). Checked by
`node docs/finish/tools/check-coverage.mjs`.

Status values: `TODO`, `IN-PROGRESS`, `DONE-VERIFIED` (needs
`docs/finish/evidence/<TASK-ID>/README.md`), `BLOCKED-HARDWARE` (needs
`docs/finish/evidence/<TASK-ID>/runbook.md`), `BLOCKED-OWNER-DECISION` (name
the decision below), `CLOSED-OWNER-DECLINED` (needs
`docs/finish/evidence/<TASK-ID>/decision.md`; terminal, see the briefing).

## Summary

| Milestone | Tasks | TODO | IN-PROGRESS | DONE-VERIFIED | BLOCKED | CLOSED-OWNER-DECLINED |
| --- | --- | --- | --- | --- | --- | --- |
| M0 | 27 | 27 | 0 | 0 | 0 | 0 |
| M1 | 46 | 46 | 0 | 0 | 0 | 0 |
| M2 | 44 | 44 | 0 | 0 | 0 | 0 |
| M3 | 44 | 44 | 0 | 0 | 0 | 0 |
| M4 | 18 | 18 | 0 | 0 | 0 | 0 |
| M5 | 36 | 36 | 0 | 0 | 0 | 0 |
| M6 | 12 | 12 | 0 | 0 | 0 | 0 |

Milestone contents and exit proofs are in `README.md`.

## Tasks in M0

| Task | Title | File | Milestone | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-CFG-01 | Create `@autolight/config` | `03-config-and-decisions.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-CFG-01/README.md` | Closes F-CFG-02, F-DATA-08 |
| T-CFG-02 | Layered resolution and persistence | `03-config-and-decisions.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-CFG-02/README.md` | Closes F-CFG-02, F-DATA-08 |
| T-CFG-03 | Python config bridge | `03-config-and-decisions.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-CFG-03/README.md` | Closes F-CFG-01 |
| T-CFG-04 | Extract every hardcoded value | `03-config-and-decisions.md` | M0 | `TODO` | none yet | Closes F-CFG-01, F-PLAN-17, F-AUD-04, F-GOV-11 |
| T-CFG-05 | Settings UI | `03-config-and-decisions.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-CFG-05/README.md` | Closes F-UI-17, F-CFG-02 |
| T-ARC-01 | Show host with all DS-07 modes | `04-target-architecture.md` | M0 | `TODO` | none yet | Closes F-APP-02 |
| T-ARC-02 | Typed IPC API | `04-target-architecture.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-ARC-02/README.md` | Closes F-APP-04, F-APP-05, F-APP-06 |
| T-ARC-03 | Startup, shutdown and crash policy | `04-target-architecture.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-ARC-03/README.md` | Closes F-APP-01, F-OPS-03, F-OPS-09 |
| T-TRU-01 | Coverage tool and status discipline in CI | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-01/README.md` | Closes F-DOC-06 |
| T-TRU-02 | Remove fixture data from production; add an explicit Simulator mode | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-02/README.md` | Closes F-APP-03, F-APP-07, F-UI-19 |
| T-TRU-04 | Reachability and architecture gates | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-04/README.md` | Closes F-APP-13, F-DOC-02, F-QA-14 |
| T-TRU-05 | Capability manifest and generated README claims | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-05/README.md` | Closes F-DOC-02, F-APP-13, F-QA-14 |
| T-TRU-06 | Anti-pattern rule pack | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-06/README.md` | Closes F-APP-13, F-DOC-02, F-QA-14 |
| T-TRU-07 | Vitest configuration and coverage | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-07/README.md` | Closes F-QA-01, F-QA-08, F-QA-14 |
| T-TRU-08 | Mutation testing | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-08/README.md` | Closes F-QA-08, F-QA-14 |
| T-TRU-10 | Security and license scanning | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-10/README.md` | Closes F-QA-14 |
| T-TRU-11 | CI pipeline rewrite | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-11/README.md` | Closes F-OPS-08, F-QA-06, F-QA-14 |
| T-TRU-13 | Record the scars in AGENTS.md | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-13/README.md` | Closes F-DOC-06 |
| T-TRU-15 | Replace the fake tests | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-15/README.md` | Closes F-QA-02, F-QA-03, F-PLAN-12, F-LIVE-02 |
| T-TRU-16 | Portable Python tests | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-16/README.md` | Closes F-ANA-25 |
| T-TRU-17 | Toolchain facts | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-17/README.md` | Closes F-OPS-07 |
| T-DOC-03 | CONTRIBUTING and AGENTS alignment | `wp00-truth-and-gates.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-DOC-03/README.md` | Closes F-DOC-06 |
| T-GOV-14 | Simulators and recording transports | `wp03-govee-lan.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-GOV-14/README.md` | Closes F-QA-12, F-GOV-23 |
| T-UI-01 | Component library and a single application root | `wp13-ui.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-UI-01/README.md` | Closes F-UI-14, F-APP-14 |
| T-SEC-03 | Electron hardening | `wp14-data-security-ops.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-SEC-03/README.md` | Closes F-SEC-01, F-APP-05 |
| T-OPS-01 | Environment facts | `wp14-data-security-ops.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-OPS-01/README.md` |  |
| T-QA-02 | Electron E2E harness | `wp15-verification-qualification.md` | M0 | `DONE-VERIFIED` | `docs/finish/evidence/T-QA-02/README.md` | Closes F-QA-02, F-X-16 |

## Tasks in M1

| Task | Title | File | Milestone | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-CFG-06 | Decision switch framework | `03-config-and-decisions.md` | M1 | `TODO` | none yet | Closes F-DEC-01 |
| T-ARC-04 | Snapshots and renderer reload survival | `04-target-architecture.md` | M1 | `TODO` | none yet | Closes F-APP-02 |
| T-ARC-05 | Main services and layout | `04-target-architecture.md` | M1 | `TODO` | none yet | Closes F-APP-01 |
| T-ARC-06 | Clock strategies and jitter measurement | `04-target-architecture.md` | M1 | `TODO` | none yet |  |
| T-TRU-03 | No echo IPC | `wp00-truth-and-gates.md` | M1 | `TODO` | none yet | Closes F-APP-04 |
| T-TRU-12 | Runtime invariants | `wp00-truth-and-gates.md` | M1 | `TODO` | none yet | Closes F-QA-14 |
| T-TRU-14 | Delete dead and duplicate code after replacement | `wp00-truth-and-gates.md` | M1 | `TODO` | none yet | Closes F-REND-09, F-GOV-19, F-RBL-07 |
| T-GOV-01 | Bring in govee-toolkit | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-01 |
| T-GOV-02 | Native TypeScript razer engine | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-02 |
| T-GOV-03 | Engine switch DS-02 and parity | `wp03-govee-lan.md` | M1 | `TODO` | none yet |  |
| T-GOV-04 | Persistent sockets | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-06, F-GOV-13 |
| T-GOV-05 | Discovery ladder | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-07, F-GOV-25 |
| T-GOV-06 | Device registry and health | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-09, F-GOV-13, F-RUN-10 |
| T-GOV-07 | Read-back | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-08 |
| T-GOV-08 | Stream lifecycle and newest-frame-wins | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-03, F-GOV-13, F-GOV-14, F-GOV-22, F-GOV-23 |
| T-GOV-09 | Blackout, white, intensity and master brightness policy | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-05, F-GOV-16, F-GOV-30 |
| T-GOV-10 | Capability probe and verified fallback | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-04, F-GOV-24, F-X-09 |
| T-GOV-11 | Qualification wizard runner | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-11, F-GOV-12, F-GOV-22, F-GOV-24, F-X-07 |
| T-GOV-12 | IDENTIFY, TEST CHASE, RECALIBRATE, identify walk | `wp03-govee-lan.md` | M1 | `TODO` | none yet | Closes F-GOV-10 |
| T-RBL-01 | Rekordbox library readers behind DS-15 | `wp06-rekordbox-library-identity.md` | M1 | `TODO` | none yet | Closes F-RBL-01 |
| T-RBL-02 | Library service and ANLZ path resolution | `wp06-rekordbox-library-identity.md` | M1 | `TODO` | none yet | Closes F-RBL-01, F-RBL-08 |
| T-RBL-03 | Beat origin, units and beat to time mapping | `wp06-rekordbox-library-identity.md` | M1 | `TODO` | none yet | Closes F-RBL-06, F-RBL-09 |
| T-RBL-05 | One definition for PSSI labels and section normalization | `wp06-rekordbox-library-identity.md` | M1 | `TODO` | none yet | Closes F-RBL-07 |
| T-RBL-06 | Library change detection and selective invalidation | `wp06-rekordbox-library-identity.md` | M1 | `TODO` | none yet | Closes F-RBL-10 |
| T-LIVE-01 | Provider contract, generation token and the shared contract suite | `wp07-rekordbox-live.md` | M1 | `TODO` | none yet | Closes F-LIVE-13 |
| T-LIVE-02 | Provider manager and the fusion provider (DS-01) | `wp07-rekordbox-live.md` | M1 | `TODO` | none yet | Closes F-LIVE-14, F-APP-08 |
| T-LIVE-03 | rkbx_link OSC provider (`rkbx-osc`) | `wp07-rekordbox-live.md` | M1 | `TODO` | none yet | Closes F-LIVE-03 |
| T-LIVE-04 | rkbx_link setup assistant | `wp07-rekordbox-live.md` | M1 | `TODO` | none yet | Closes F-LIVE-03 |
| T-LIVE-05 | PRO DJ LINK provider (`prolink`, DS-29) | `wp07-rekordbox-live.md` | M1 | `TODO` | none yet | Closes F-LIVE-04 |
| T-LIVE-06 | Accessibility provider (`ax`) on macOS and Windows | `wp07-rekordbox-live.md` | M1 | `TODO` | none yet | Closes F-LIVE-05, F-APP-10, F-QA-06 |
| T-LIVE-08 | Rekordbox local agent API (port 30001) | `wp07-rekordbox-live.md` | M1 | `TODO` | none yet | Closes F-LIVE-09 |
| T-RUN-01 | Deck worlds in the show host | `wp12-runtime-mixer-renderer.md` | M1 | `TODO` | none yet | Closes F-APP-02 |
| T-RUN-02 | State estimator with smooth correction | `wp12-runtime-mixer-renderer.md` | M1 | `TODO` | none yet | Closes F-RUN-01, F-APP-09 |
| T-RUN-03 | Seek as random access | `wp12-runtime-mixer-renderer.md` | M1 | `TODO` | none yet | Closes F-RUN-01 |
| T-RUN-04 | Loops and rolls | `wp12-runtime-mixer-renderer.md` | M1 | `TODO` | none yet | Closes F-RUN-02 |
| T-RUN-05 | Reverse and scratch | `wp12-runtime-mixer-renderer.md` | M1 | `TODO` | none yet | Closes F-RUN-03 |
| T-RUN-07 | Manual overrides and emergency path | `wp12-runtime-mixer-renderer.md` | M1 | `TODO` | none yet | Closes F-RUN-04, F-RUN-07, F-APP-04, F-APP-19 |
| T-REND-01 | Eight-layer stack with real compositing | `wp12-runtime-mixer-renderer.md` | M1 | `TODO` | none yet | Closes F-REND-01, F-REND-08 |
| T-UI-03 | Emergency controls and shortcuts | `wp13-ui.md` | M1 | `TODO` | none yet | Closes F-UI-02, F-APP-17 |
| T-DATA-01 | Storage service and drivers (DS-06) | `wp14-data-security-ops.md` | M1 | `TODO` | none yet | Closes F-DATA-01, F-DATA-02, F-APP-15 |
| T-DATA-02 | Schema and migrations | `wp14-data-security-ops.md` | M1 | `TODO` | none yet | Closes F-DATA-03 |
| T-DATA-03 | Cache versioning and selective invalidation | `wp14-data-security-ops.md` | M1 | `TODO` | none yet | Closes F-DATA-03 |
| T-DATA-04 | Fast path loader | `wp14-data-security-ops.md` | M1 | `TODO` | none yet | Closes F-DATA-04, F-RUN-09 |
| T-SEC-04 | Read-only access enforced by construction | `wp14-data-security-ops.md` | M1 | `TODO` | none yet | Closes F-SEC-02 |
| T-QA-03 | Protocol replay harness | `wp15-verification-qualification.md` | M1 | `TODO` | none yet | Closes F-QA-11, F-LIVE-02 |
| T-QA-05 | Performance harness | `wp15-verification-qualification.md` | M1 | `TODO` | none yet | Closes F-QA-05 |

## Tasks in M2

| Task | Title | File | Milestone | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-DOC-02 | ADRs for every decision | `wp00-truth-and-gates.md` | M2 | `TODO` | none yet | Closes F-DOC-04, F-LIVE-03 |
| T-GOV-13 | H6076 and H1A45 profiles | `wp03-govee-lan.md` | M2 | `TODO` | none yet | Closes F-GOV-15 |
| T-GOV-15 | Segment resolution selection | `wp03-govee-lan.md` | M2 | `TODO` | none yet | Closes F-GOV-28 |
| T-GOV-17 | Unknown firmware policy | `wp03-govee-lan.md` | M2 | `TODO` | none yet | Closes F-GOV-21 |
| T-GOV-18 | ptReal scenes over LAN | `wp03-govee-lan.md` | M2 | `TODO` | none yet | Closes F-GOV-27 |
| T-GOV-19 | Device metrics | `wp03-govee-lan.md` | M2 | `TODO` | none yet | Closes F-GOV-29 |
| T-BLE-01 | BLE backends and placement (DS-04) | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01 |
| T-BLE-02 | Scan and identity binding | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01, F-BLE-04, F-BLE-02 |
| T-BLE-03 | Link manager and pacing | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01, F-BLE-02 |
| T-BLE-04 | Command set and dialects | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01, F-BLE-02 |
| T-BLE-05 | BLE segment stream | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01, F-BLE-02 |
| T-BLE-06 | BLE qualification | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01, F-BLE-02 |
| T-BLE-07 | Encrypted link (DS-05) | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01, F-BLE-02, F-BLE-06, F-SEC-04 |
| T-BLE-09 | BLE simulator | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01, F-QA-12 |
| T-BLE-10 | BLE Wi-Fi provisioning helper | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-01, F-BLE-05 |
| T-MAT-01 | Matter controller process | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-MAT-01 |
| T-MAT-02 | Matter control mapping | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-MAT-01 |
| T-MAT-03 | Matter identity binding | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-MAT-01 |
| T-MAT-04 | Matter simulator | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-MAT-01, F-QA-12 |
| T-CLD-01 | Cloud metadata client | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-CLD-01, F-GOV-17 |
| T-CLD-02 | Cloud cross-check in qualification | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-CLD-01 |
| T-FOV-01 | Transport model and policy (DS-03) | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-GOV-18 |
| T-FOV-02 | Failover state machine and the campus scenario | `wp04-ble-matter-cloud-failover.md` | M2 | `TODO` | none yet | Closes F-BLE-05 |
| T-LIVE-09 | Lighting IPC provider: capture tooling, fixtures, decoder, replay | `wp07-rekordbox-live.md` | M2 | `TODO` | none yet | Closes F-LIVE-01, F-LIVE-02, F-LIVE-15 |
| T-LIVE-10 | OS2L provider (`os2l`) | `wp07-rekordbox-live.md` | M2 | `TODO` | none yet | Closes F-LIVE-10 |
| T-LIVE-11 | Clean-room memory reader (`memory-cleanroom`) | `wp07-rekordbox-live.md` | M2 | `TODO` | none yet | Closes F-LIVE-03, F-SEC-03 |
| T-LIVE-12 | Ableton Link participation | `wp07-rekordbox-live.md` | M2 | `TODO` | none yet | Closes F-LIVE-11 |
| T-LIVE-13 | Version registry, qualification records and the unverified banner | `wp07-rekordbox-live.md` | M2 | `TODO` | none yet | Closes F-LIVE-08 |
| T-LIVE-14 | Master deck, loop, pitch, SYNC, hot cue and roll state | `wp07-rekordbox-live.md` | M2 | `TODO` | none yet | Closes F-LIVE-12, F-LIVE-13, F-MIX-08 |
| T-LIVE-15 | Version and dependency decision packet for the owner | `wp07-rekordbox-live.md` | M2 | `TODO` | none yet | Closes F-LIVE-15, F-LIVE-16 |
| T-FLX-01 | MIDI input backends (DS-13) and non-exclusive observation | `wp08-flx4.md` | M2 | `TODO` | none yet | Closes F-FLX-01, F-FLX-06 |
| T-FLX-02 | Full control map with deck separation | `wp08-flx4.md` | M2 | `TODO` | none yet | Closes F-FLX-02, F-FLX-03 |
| T-FLX-03 | Controller state model | `wp08-flx4.md` | M2 | `TODO` | none yet | Closes F-FLX-03 |
| T-FLX-04 | Transport-relevant signals for the runtime | `wp08-flx4.md` | M2 | `TODO` | none yet | Closes F-FLX-03, F-LIVE-12 |
| T-FLX-07 | Detection, setup and status | `wp08-flx4.md` | M2 | `TODO` | none yet | Closes F-FLX-05 |
| T-SER-01 | serato-connect Remote provider | `wp09-serato.md` | M2 | `TODO` | none yet | Closes F-SER-01 |
| T-SER-04 | Serato library, crates, smart crates and watcher | `wp09-serato.md` | M2 | `TODO` | none yet | Closes F-SER-06 |
| T-SER-05 | Serato protocol fixtures and replay | `wp09-serato.md` | M2 | `TODO` | none yet | Closes F-SER-05 |
| T-RUN-06 | Source loss, device faults and the adaptive clock | `wp12-runtime-mixer-renderer.md` | M2 | `TODO` | none yet | Closes F-RUN-05, F-RUN-10 |
| T-AUD-01 | Capture host outside React (DS-14) | `wp12-runtime-mixer-renderer.md` | M2 | `TODO` | none yet | Closes F-AUD-03, F-AUD-05, F-APP-20 |
| T-AUD-02 | Independent DSP | `wp12-runtime-mixer-renderer.md` | M2 | `TODO` | none yet | Closes F-AUD-01 |
| T-AUD-04 | Audio timing alignment | `wp12-runtime-mixer-renderer.md` | M2 | `TODO` | none yet | Closes F-LIVE-06 |
| T-SEC-01 | Secrets in safeStorage | `wp14-data-security-ops.md` | M2 | `TODO` | none yet | Closes F-DATA-07, F-CLD-01 |
| T-QA-04 | Simulators and fault injection at application level | `wp15-verification-qualification.md` | M2 | `TODO` | none yet | Closes F-QA-05, F-QA-12 |

## Tasks in M3

| Task | Title | File | Milestone | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-TRU-09 | Python lint and types | `wp00-truth-and-gates.md` | M3 | `DONE-VERIFIED` | `docs/finish/evidence/T-TRU-09/README.md` | Closes F-QA-14 |
| T-RBL-04 | Full ANLZ extraction with per-tag outcomes | `wp06-rekordbox-library-identity.md` | M3 | `TODO` | none yet | Closes F-RBL-02, F-RBL-03, F-RBL-04, F-RBL-05 |
| T-RBL-07 | Live deck to library to cached model resolution | `wp06-rekordbox-library-identity.md` | M3 | `TODO` | none yet | Closes F-APP-03 |
| T-ID-01 | Durable identity: alias graph, file hash and PCM fingerprint | `wp06-rekordbox-library-identity.md` | M3 | `TODO` | none yet | Closes F-ID-01, F-LIVE-07 |
| T-ID-02 | Planner seed from the fingerprint | `wp06-rekordbox-library-identity.md` | M3 | `TODO` | none yet | Closes F-ID-02 |
| T-LIVE-07 | Composite FLX4 provider (`composite-flx4`) | `wp07-rekordbox-live.md` | M3 | `TODO` | none yet | Closes F-LIVE-06, F-LIVE-07 |
| T-FLX-06 | Composite provider integration | `wp08-flx4.md` | M3 | `TODO` | none yet | Closes F-LIVE-06 |
| T-SER-02 | DeckState mapping, master inference, generation and coalescing | `wp09-serato.md` | M3 | `TODO` | none yet | Closes F-SER-01, F-SER-04 |
| T-SER-03 | Serato file metadata: containers and GEOB tags | `wp09-serato.md` | M3 | `TODO` | none yet | Closes F-SER-02, F-SER-03 |
| T-ANA-01 | Worker protocol that cannot be corrupted or killed by one bad line | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-21 |
| T-ANA-02 | Supervisor, persistent job queue and the preanalysis queue | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-20 |
| T-ANA-03 | Canonical decode | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-08 |
| T-ANA-04 | Every input shape produces the right model or a typed failure | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-02, F-ANA-03, F-ANA-23 |
| T-ANA-05 | All-In-One persistent session and model management | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-05, F-ANA-07, F-ANA-22, F-ANA-29 |
| T-ANA-06 | Real stems with labelled fallback (DS-10) | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-06 |
| T-ANA-07 | Beat This cross-check | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-15 |
| T-ANA-08 | GRID_WARNING from a real comparison | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-16 |
| T-ANA-09 | The 22 DSP features with correct aggregation | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-09, F-ANA-10 |
| T-ANA-10 | Event detectors for all 19 events | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-11, F-ANA-12, F-ANA-13, F-ANA-14 |
| T-ANA-11 | Fusion with provenance, and the swallowed error | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-01, F-ANA-17, F-ANA-27 |
| T-ANA-12 | TrackModel v2 in both languages from one definition | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-03, F-ANA-11, F-ANA-17, F-ANA-24, F-RBL-04 |
| T-ANA-13 | Artifact identity, versioning and atomic writes | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-18 |
| T-ANA-14 | Numeric correctness fixes | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-19 |
| T-ANA-15 | Readiness computed from inputs | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-04, F-ANA-23 |
| T-ANA-16 | Analysis goldens and detection metrics | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-26, F-QA-10 |
| T-ANA-18 | Harmonic tension proxy and key | `wp10-analysis.md` | M3 | `TODO` | none yet | Closes F-ANA-14, F-ANA-28 |
| T-PLAN-01 | ShowPlan v2, typed cues and spatial selectors | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-02, F-PLAN-16, F-PLAN-18, F-PLAN-01 |
| T-PLAN-02 | Whole-song identity and colour story | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-01, F-PLAN-13 |
| T-PLAN-03 | Six-level hierarchy with future-aware progression | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-04 |
| T-PLAN-05 | Restraint engine | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-07, F-PLAN-15, F-APP-12 |
| T-PLAN-06 | Contrast engine and drop programming | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-08 |
| T-PLAN-07 | Consume every event with its confidence and strength | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-09 |
| T-PLAN-08 | Recurrence and motif memory | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-05 |
| T-PLAN-09 | Show styles | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-06, F-PLAN-17, F-APP-18 |
| T-PLAN-10 | Validator and evaluator in production | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-10 |
| T-PLAN-11 | Corrections, locks and regeneration | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-11 |
| T-PLAN-12 | Candidate scoring hook (DS-19) | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-14 |
| T-PLAN-13 | Layer tags and mixing metadata | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-MIX-06 |
| T-PLAN-14 | Compile performance and caching | `wp11-planner.md` | M3 | `TODO` | none yet |  |
| T-PLAN-15 | Planner goldens and regression | `wp11-planner.md` | M3 | `TODO` | none yet | Closes F-PLAN-12 |
| T-RUN-08 | Track load fast path, prepared-show upgrade and style handover | `wp12-runtime-mixer-renderer.md` | M3 | `TODO` | none yet | Closes F-APP-03, F-APP-11, F-RUN-08, F-RUN-09 |
| T-REND-03 | Colour pipeline and per-fixture calibration | `wp12-runtime-mixer-renderer.md` | M3 | `TODO` | none yet | Closes F-REND-03, F-REND-06, F-REND-11, F-PLAN-01 |
| T-OPS-02 | Structured logging | `wp14-data-security-ops.md` | M3 | `TODO` | none yet | Closes F-OPS-01 |
| T-QA-09 | Curated visual validation set | `wp15-verification-qualification.md` | M3 | `TODO` | none yet | Closes F-ANA-26, F-QA-13 |

## Tasks in M4

| Task | Title | File | Milestone | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-FOV-03 | Capability-aware rendering for degraded fixtures | `wp04-ble-matter-cloud-failover.md` | M4 | `TODO` | none yet | Closes F-GOV-04 |
| T-ROOM-01 | Room and anchor model | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-ROOM-01, F-VEN-04 |
| T-ROOM-02 | Placements and Fixture v2 | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-VEN-01 |
| T-ROOM-03 | Room editor UI | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-VEN-02, F-ROOM-01 |
| T-ROOM-04 | Strip mapping wizard | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-ROOM-01, F-ROOM-03, F-VEN-05 |
| T-ROOM-05 | Spatial field computation | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-ROOM-02, F-ROOM-03, F-REND-05 |
| T-ROOM-06 | Groups and splits | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-VEN-03, F-REND-05, F-ROOM-02 |
| T-ROOM-07 | Spatial primitives | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-ROOM-02 |
| T-ROOM-08 | Renderer integration | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-REND-04, F-REND-05 |
| T-ROOM-09 | Planner integration | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-ROOM-02 |
| T-ROOM-10 | Preview of the real room | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-ROOM-04, F-UI-04, F-APP-07 |
| T-ROOM-11 | Venue persistence, import and export | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-VEN-04 |
| T-ROOM-12 | Geometry tests and goldens | `wp05-room-and-venue.md` | M4 | `TODO` | none yet | Closes F-ROOM-02 |
| T-PLAN-04 | Primitive library: every spec primitive plus the spatial set | `wp11-planner.md` | M4 | `TODO` | none yet | Closes F-PLAN-03, F-PLAN-15 |
| T-REND-02 | Primitive renderers with envelopes | `wp12-runtime-mixer-renderer.md` | M4 | `TODO` | none yet | Closes F-REND-02, F-PLAN-03 |
| T-REND-04 | Global latency compensation | `wp12-runtime-mixer-renderer.md` | M4 | `TODO` | none yet | Closes F-REND-04 |
| T-REND-05 | Physical regions, dense arrays, correct addressing | `wp12-runtime-mixer-renderer.md` | M4 | `TODO` | none yet | Closes F-REND-05, F-REND-07, F-REND-10 |
| T-REND-06 | Renderer goldens | `wp12-runtime-mixer-renderer.md` | M4 | `TODO` | none yet |  |

## Tasks in M5

| Task | Title | File | Milestone | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-CFG-07 | Live-mode change safety | `03-config-and-decisions.md` | M5 | `TODO` | none yet |  |
| T-DOC-04 | THIRD_PARTY_NOTICES and provenance headers | `wp00-truth-and-gates.md` | M5 | `TODO` | none yet | Closes F-DOC-07 |
| T-GOV-16 | Network hygiene and trust status | `wp03-govee-lan.md` | M5 | `TODO` | none yet | Closes F-GOV-20, F-GOV-26 |
| T-BLE-08 | OS permissions | `wp04-ble-matter-cloud-failover.md` | M5 | `TODO` | none yet | Closes F-BLE-01, F-BLE-03 |
| T-ID-03 | Key the UI and cache by TrackId | `wp06-rekordbox-library-identity.md` | M5 | `TODO` | none yet | Closes F-ID-03 |
| T-FLX-05 | Expressive hints for the director and mixer | `wp08-flx4.md` | M5 | `TODO` | none yet | Closes F-FLX-04 |
| T-RUN-09 | Adaptive director | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet | Closes F-RUN-06 |
| T-MIX-01 | Audible weight | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet | Closes F-MIX-01, F-MIX-08 |
| T-MIX-02 | Base mixing in perceptual and linear space | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet | Closes F-MIX-02, F-MIX-05, F-PLAN-13 |
| T-MIX-03 | Exclusive impact ownership | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet | Closes F-MIX-07 |
| T-MIX-04 | Transition-aware blackout translation | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet | Closes F-MIX-03, F-QA-09 |
| T-MIX-05 | Incoming deck introduction by layer | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet | Closes F-MIX-06 |
| T-MIX-06 | One path to pixels | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet | Closes F-MIX-04, F-MIX-05, F-APP-07, F-UI-05 |
| T-REND-07 | Renderer performance | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet |  |
| T-AUD-03 | Overlay rules | `wp12-runtime-mixer-renderer.md` | M5 | `TODO` | none yet | Closes F-AUD-02, F-AUD-04, F-APP-20 |
| T-UI-02 | Live screen | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-03, F-UI-04, F-UI-05, F-UI-15 |
| T-UI-04 | Manual lane for performance | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-01, F-UI-18, F-APP-12, F-APP-19 |
| T-UI-05 | Library screen, readiness and the preanalysis queue | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-06, F-UI-16 |
| T-UI-06 | Track Inspector | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-07, F-UI-08 |
| T-UI-07 | Track corrections | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-09 |
| T-UI-08 | Venue and Device screens | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-10, F-GOV-11 |
| T-UI-09 | Setup experience | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-10, F-APP-08, F-FLX-05 |
| T-UI-10 | Diagnostics and the DJ Event Inspector | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-11, F-GOV-26 |
| T-UI-11 | Settings: every configuration visible | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-17 |
| T-UI-12 | Accessibility, ergonomics and the no-modal guard | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-12, F-UI-13 |
| T-UI-13 | UI performance with real data volumes | `wp13-ui.md` | M5 | `TODO` | none yet |  |
| T-UI-14 | Styles in the UI | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-APP-11, F-APP-18 |
| T-UI-15 | Simulator mode | `wp13-ui.md` | M5 | `TODO` | none yet | Closes F-UI-19 |
| T-DATA-05 | Semantic validation of contracts | `wp14-data-security-ops.md` | M5 | `TODO` | none yet | Closes F-DATA-05 |
| T-DATA-06 | Session recorder and exact replay | `wp14-data-security-ops.md` | M5 | `TODO` | none yet | Closes F-DATA-06 |
| T-SEC-02 | Network exposure | `wp14-data-security-ops.md` | M5 | `TODO` | none yet | Closes F-GOV-20 |
| T-SEC-05 | Consent and audit for privileged helpers | `wp14-data-security-ops.md` | M5 | `TODO` | none yet | Closes F-SEC-03 |
| T-OPS-03 | Metrics | `wp14-data-security-ops.md` | M5 | `TODO` | none yet | Closes F-OPS-02, F-UI-11 |
| T-OPS-04 | Update strategy | `wp14-data-security-ops.md` | M5 | `TODO` | none yet | Closes F-OPS-04 |
| T-OPS-05 | Packaging and the development launcher | `wp14-data-security-ops.md` | M5 | `TODO` | none yet | Closes F-OPS-05, F-OPS-10, F-APP-16, F-ANA-22 |
| T-OPS-07 | Crash handling and safe state | `wp14-data-security-ops.md` | M5 | `TODO` | none yet | Closes F-OPS-09 |

## Tasks in M6

| Task | Title | File | Milestone | Status | Evidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| T-DOC-01 | Rewrite the documentation set | `wp00-truth-and-gates.md` | M6 | `TODO` | none yet | Closes F-DOC-01, F-DOC-03, F-DOC-05, F-APP-13, F-APP-16 |
| T-SER-06 | Serato definition of done | `wp09-serato.md` | M6 | `TODO` | none yet |  |
| T-ANA-17 | Dependency groups, lockfile and packaging of the worker | `wp10-analysis.md` | M6 | `TODO` | none yet | Closes F-ANA-04 |
| T-OPS-06 | Clean-machine install matrix | `wp14-data-security-ops.md` | M6 | `TODO` | none yet | Closes F-OPS-06 |
| T-QA-01 | Every test class exists and is enforced | `wp15-verification-qualification.md` | M6 | `TODO` | none yet |  |
| T-QA-06 | Soak | `wp15-verification-qualification.md` | M6 | `TODO` | none yet | Closes F-QA-03 |
| T-QA-07 | Track-sync qualification matrix | `wp15-verification-qualification.md` | M6 | `TODO` | none yet | Closes F-QA-05 |
| T-QA-08 | Physical output qualification with a camera | `wp15-verification-qualification.md` | M6 | `TODO` | none yet |  |
| T-QA-10 | Goldens everywhere, updated deliberately | `wp15-verification-qualification.md` | M6 | `TODO` | none yet | Closes F-QA-04 |
| T-QA-11 | Gates and the Rekordbox definition of done | `wp15-verification-qualification.md` | M6 | `TODO` | none yet | Closes F-QA-06 |
| T-QA-12 | Property tests | `wp15-verification-qualification.md` | M6 | `TODO` | none yet | Closes F-QA-07 |
| T-QA-13 | The owner's "professional looking" review | `wp15-verification-qualification.md` | M6 | `TODO` | none yet | Closes F-QA-13 |

## Findings

A finding is closed only when every task in "Closed by" is `DONE-VERIFIED`
(or `BLOCKED-HARDWARE` for a physical step with the runbook done by the owner).
`F-X-*` rows are review claims verified false or unverified; they are listed
so nobody acts on them as stated.

| Finding | Verification | Closed by | State |
| --- | --- | --- | --- |
| F-APP-01 | `electron/main.ts:12-26` declares `STARTUP_ORDER` and `SHUTDOWN_ORDER` arrays; `boot()` only creates a window, registers IPC, starts AX polling and a ProLink listener. No DB, show worker, Govee manager, DJ adapter manager, library watcher, analysis worker, venue restore, track resolution, plan compile or stream arming. `quitApp()` is never registered on `before-quit` | V | T-ARC-03, T-ARC-05 |
| F-APP-02 | No show worker thread. The "show loop" is `useLiveCursor()` in `src/renderer/state/resolve-live.ts:130-164`, a 250 ms React `setInterval` (4 Hz). A frozen or reloaded renderer freezes the show. `process.hrtime.bigint()` is never used; diagnostics falsely claims "show worker has no process.hrtime" | V | T-ARC-01, T-ARC-04, T-RUN-01 |
| F-APP-03 | Live decks are two hardcoded fixture files (`live-homecoming.*`, `live-deck2.*`) fetched from `./analysis/` because `vite.config.ts:27` sets `publicDir` to `test-fixtures`. No provider to identity to cache resolution. `show/live` returns `{ live: null }` | V | T-TRU-02, T-RUN-08, T-RBL-07 |
| F-APP-04 | 15 of 23 IPC channels validate and echo (no-ops): `venue/list`, `venue/set-color`, `venue/device-action`, `show/state`, `show/style`, `show/energy`, `show/trigger-build`, `show/trigger-drop`, `follow/mode`, `master/blackout`, `master/full`, `master/freeze`, `master/intensity`, `master/resume`, `diagnostics/get` (`electron/ipc.ts:49-52`) | V | T-TRU-03, T-ARC-02, T-RUN-07 |
| F-APP-05 | Preload exposes a generic `invoke(channel, payload)`; the eight "real" handlers bypass schema validation (they cast the payload); responses unvalidated; no sender check | V | T-ARC-02, T-SEC-03 |
| F-APP-06 | IPC handlers are registered after `await win.loadFile/loadURL`, racing the renderer's first requests; renderer `invoke` swallows every error with `.catch(() => undefined)` | V | T-ARC-02 |
| F-APP-07 | Preview uses `makeFixture("left",14)` and `makeFixture("right",14)` and `makeDeck({playing:true, channelFader:1, crossfader:1})` regardless of real devices and real deck state (`resolve-live.ts:36-60`) | V | T-TRU-02, T-ROOM-10, T-MIX-06 |
| F-APP-08 | Follow mode does not select a provider: the cursor always calls `follow/ax`; ProLink data is hardcoded `{beat:null, peerPresent:false}` in the renderer (`resolve-live.ts:148`); `follow/mode` is an echo; "SoundSwitch IPC (future)" copy | V | T-LIVE-02, T-UI-09 |
| F-APP-09 | Cursor math: deck A preview adds `0.25*(bpm/60)*0.1` per 250 ms tick (10x too slow) while `estimatedBeat` omits the `0.1` (two inconsistent scales); deck B adds a fixed `0.02` per tick; beat clamped to grid length; uses the first grid beat's BPM; AX updates deck A only | V | T-RUN-02 |
| F-APP-10 | Duplicate AX polling: main polls at 1 Hz and the renderer at 4 Hz, each spawning `osascript` with an 8 s timeout, no in-flight coalescing, regardless of mode; macOS-only with Windows silently unavailable | V | T-LIVE-06 |
| F-APP-11 | The planner recompiles both tracks every 250 ms in React; a plan is replaced only if seed or style ID changed (parameter edits under the same ID are ignored); a style switch applies mid-playback with no phrase-boundary handover | V | T-RUN-08, T-UI-14 |
| F-APP-12 | "Blinder on phrase" injects an `ALL` white hit at every multiple of 32 beats at intensity 1, bypassing restraint and real phrase boundaries; the cue can vanish mid-duration after recomputation | V | T-UI-04, T-PLAN-05 |
| F-APP-13 | Comments and UI copy describe behaviour that does not exist ("BOTH decks actually loaded in Rekordbox right now", "real handler", "this is wired", show-service header, Setup copy) | V | T-TRU-05, T-DOC-01 |
| F-APP-14 | React mounts twice: `main.tsx:7` and `shell.tsx:67-69` both call `createRoot(...).render(<Shell/>)` | V | T-UI-01 |
| F-APP-15 | `show-service.ts:9` says "Electron 33's Node lacks node:sqlite" but `apps/desktop/package.json` depends on Electron `^41.10.6`; the reasoning used to justify no DB in main is stale | V | T-DATA-01 |
| F-APP-16 | `yarn dev` starts Vite only; there is no Electron dev launcher; README tells users to launch `dist/electron/main.cjs` by hand | V | T-OPS-05, T-DOC-01 |
| F-APP-17 | Command palette "Emergency" items (Blackout, Freeze) only close the palette (`command-palette.tsx:31-32`) | V | T-UI-03 |
| F-APP-18 | The style dropdown offers House, EDM, Hip-Hop, Chill mapped to 4 of the 7 built-in styles; Pop, Dark and Minimal are unreachable; names do not match spec 135 | V | T-UI-14, T-PLAN-09 |
| F-APP-19 | The manual lane (`ControlGrid`: palette, flash on beat, alternating A/B, manual tier, sensitivity, swatches, White hold, target A/B/Both) changes only local UI state or calls echo channels | V | T-UI-04, T-RUN-07 |
| F-APP-20 | Audio sync: level is computed, but `buildLive()` passes `reactiveEnergy:0, reactiveAmount:0`; the cursor overwrites `reactiveLevel` with `sensitivity*0.2`; the "this is wired" comment is false | V | T-AUD-01, T-AUD-03 |
| F-RBL-01 | No master.db reader in the app: no `options.json` discovery, no SQLCipher key derivation, no read-only open, no playlists, history or tracks; `rekordbox-connect` is not a dependency; `packages/rekordbox-library` is helpers plus `READ_ONLY = true` | V | T-RBL-01, T-RBL-02 |
| F-RBL-02 | PWAV and PWV2 to PWV7 and PWVC are reduced to presence booleans in `native.py:159-163`; no waveform or vocal data is retained | V | T-RBL-04 |
| F-RBL-03 | PCO2 extraction lacks cue type, RGB colour, colour ID and loop quantization | V | T-RBL-04 |
| F-RBL-04 | PSSI mood, bank, end beat, fill, fill beat and raw entries are extracted in `native.py:73-91` and then dropped by `fusion.build_track_model`; the TS schema has no field for them | V | T-RBL-04, T-ANA-12 |
| F-RBL-05 | EXT and 2EX parse failures are swallowed with bare `except Exception`; one unknown tag (the EXT variant that raises `ConstError`) loses all PSSI for the track with no per-tag diagnostics | V | T-RBL-04 |
| F-RBL-06 | `toNativeBeat` multiplies a field named `sourceTimeMs` by 1000 (`rekordbox-library/src/index.ts:29-32`) | V | T-RBL-03 |
| F-RBL-07 | PSSI label tables and section normalization are duplicated in TypeScript (`rekordbox-library`) and Python (`native.py`) | V | T-RBL-05 |
| F-RBL-08 | AnalysisDataPath resolution is pure string math; no mapping from master.db rows to ANLZ files exists in TypeScript | V | T-RBL-02 |
| F-RBL-09 | Beat origin mismatch: grid `index` is 0-based; PSSI phrase beats, AX mapping and ML boundaries are 1-based; the canonical mapping returns grid indices, so cues can land one beat late | V | T-RBL-03 |
| F-RBL-10 | Library change detection (spec 141) is absent: no watcher on master.db and its WAL, ANLZ mtimes, audio mtime or hash | V | T-RBL-06 |
| F-LIVE-01 | No Lighting IPC provider, capture tooling or decoder. `protocol-fixtures/rekordbox/7.2.19/macos/handshake/` holds only a README; the three 7.2.10 fixtures are hand-written DeckState JSON with `"capture": ""`, all paused at 0.0 | V | T-LIVE-09 |
| F-LIVE-02 | `replayFixture` ignores `capture` and returns `expectedEvents` with new timestamps (`rekordbox-live/src/index.ts:24-30`); replay can never fail | V | T-LIVE-09, T-QA-03, T-TRU-15 |
| F-LIVE-03 | No rkbx_link-style memory transport and no consumer of rkbx_link's OSC output; ADR-001 never considered it although the owner marked it "REALLY IMPORTANT" | V | T-LIVE-03, T-LIVE-04, T-LIVE-11, T-DOC-02 |
| F-LIVE-04 | ProLink parser (`electron/follow.ts:59-83`): requires 60-byte packets (real beat packets are 0x60 = 96 bytes), reads offsets 32 and 46 (next-beat interval is at 0x24 and BPM at 0x5a), treats the next-beat interval in milliseconds as a beat counter, validates no header, packet type or device, accepts arbitrary 60-byte datagrams, swallows socket errors, never expires `peerPresent`, is observe-only with no Virtual CDJ keepalive, and its data never reaches the renderer | V | T-LIVE-05 |
| F-LIVE-05 | AX scrape (`follow.ts:22-45`): reads every static text of window 1, takes the first two `mm:ss` matches, cannot tell decks, elapsed from remaining, or paused from playing (any time found marks `playing: true`); main discards the elapsed value (`beat: null`); `axBeatToPlayhead` scans linearly and returns whole beats | V | T-LIVE-06 |
| F-LIVE-06 | The composite FLX4 provider is a pure mapper (`compositeToDeckState`, `compositeDeckState`); loop inactive and master null are hardcoded; nothing acquires the inputs; unused by the app | V | T-LIVE-07, T-FLX-06, T-AUD-04 |
| F-LIVE-07 | Composite identity drops the audio path: the composite row carries `canonicalPath` but `rowToIdentity` reads `filePath` | V | T-LIVE-07, T-ID-01 |
| F-LIVE-08 | Version support is a string-prefix check (`isSupported`); no protocol registry, no qualification records; `unverifiedWarning` never reaches the UI | V | T-LIVE-13 |
| F-LIVE-09 | The local Rekordbox agent API on port 30001 was probed without the bearer token, returned 404s, and was declared "not a transport surface"; rkbx_os2l shows it resolves track IDs to paths with a session token | V | T-LIVE-08 |
| F-LIVE-10 | OS2L (the protocol SoundSwitch accepts from VirtualDJ and that rkbx_os2l emits) is neither consumed nor considered | V | T-LIVE-10 |
| F-LIVE-11 | Ableton Link participation (spec 10) is absent | V | T-LIVE-12 |
| F-LIVE-12 | No path acquires master deck, loop state, pitch, SYNC, hot cue or loop roll state | V | T-LIVE-14, T-FLX-04 |
| F-LIVE-13 | Track switches can leak metadata: no generation token separates the old track's fields from the new one's (spec 120 item 14) | V | T-LIVE-01, T-LIVE-14 |
| F-LIVE-14 | No provider manager or failover; `PROVIDER_ORDER` is an unused constant | V | T-LIVE-02 |
| F-LIVE-15 | SoundSwitch's Rekordbox integration requires a SoundSwitch Creative or Professional plan or trial; the product itself must run without SoundSwitch installed (spec 120 item 15) | C | T-LIVE-09, T-LIVE-15 |
| F-LIVE-16 | Version tension: installed Rekordbox is 7.2.10.0333; rkbx_link macOS community offsets cover 7.2.8, 7.2.17, 7.2.18 (Apple Silicon); the Lighting extension needs 7.2.19+ | V | T-LIVE-15 |
| F-SER-01 | `serato-connect` is not a dependency; no Bonjour `_SeratoIOSRemote._tcp`, OSC, custom TCP delimiter, MD5 auth or subscriptions exist; spec 3.1 says use it directly and write no duplicate | V | T-SER-01, T-SER-02 |
| F-SER-02 | `parseBeatGrid` reads every marker as (f32 position, f32 BPM); non-terminal markers are (f32 position, u32 beats-until-next); marker count read from one byte; footer ignored; `tempoRegionsToBeats` gives the last region 4 beats instead of running to track end | V | T-SER-03 |
| F-SER-03 | No GEOB reader for real files (Markers2 cues, loops, colours, flips; Autotags; Overview) and no ID3, MP4 or FLAC container parsing | V | T-SER-03 |
| F-SER-04 | `remoteToDeckState` sets `master: null`; track-change coalescing only resets loops; no generation token | V | T-SER-02 |
| F-SER-05 | No `protocol-fixtures/serato/` and no replay | V | T-SER-05 |
| F-SER-06 | No Serato library reading (database V2, crates, smart crates) and no watcher | V | T-SER-04 |
| F-FLX-01 | No MIDI library in any package; no device open; `classifyCC` and `confirmAudible` have no callers | V | T-FLX-01 |
| F-FLX-02 | MIDI channel ignored so deck 1 and deck 2 cannot be told apart; CC and note constants are unverified against the official map; crossfader and tempo constants are declared but not classified | V | T-FLX-02 |
| F-FLX-03 | Missing map coverage: jog, pads and pad modes, hot cues, loops, beat length, EQ, colour/filter, browse/load, SHIFT, SYNC, master; 14-bit fader pairs | V | T-FLX-02, T-FLX-03, T-FLX-04 |
| F-FLX-04 | Expressive hints from spec 11 (filter sweep, pad roll, fader rise, loop shrink, loop release) are not implemented and do not inform the director | V | T-FLX-05 |
| F-FLX-05 | No FLX4 detection in setup and no controller status | V | T-FLX-07, T-UI-09 |
| F-FLX-06 | Windows MIDI input through WinMM is single-client; if Rekordbox holds the FLX4 input, a second reader can fail to open it. No handling exists | U | T-FLX-01 |
| F-ID-01 | No durable identity resolver: no alias graph, no file hash (`decode.file_hash` hashes the first MB and is unused), no PCM fingerprint, no rename or move migration | V | T-ID-01 |
| F-ID-02 | The planner seed is `track.identity.id` (a database row ID), not the fingerprint required by spec 27; docs claim fingerprint | V | T-ID-02 |
| F-ID-03 | Library rows and the Inspector key tracks by title | V | T-ID-03 |
| F-ANA-01 | `worker.py:64` calls `events.append` before `events` is assigned at `:69`; the `NameError` is swallowed at `:66-67`; only the first ML boundary reaches drop detection; no section-transition events survive; coverage stays `full` | V | T-ANA-11 |
| F-ANA-02 | Readable audio with no ANLZ short-circuits to a zero-duration empty ADAPTIVE model without decoding the audio (`worker.py:28-35`) | V | T-ANA-04 |
| F-ANA-03 | The ADAPTIVE artifact (empty grid) is rejected by the TS schema (`beats.min(1)`) | V | T-ANA-04, T-ANA-12 |
| F-ANA-04 | `full` coverage is set whenever DSP ran, even with no ML; the ML dependency group is never installed by the client; there is no per-input readiness | V | T-ANA-15, T-ANA-17 |
| F-ANA-05 | All-In-One's persistent session API (`AllInOneSession`) is unused and the comment says none exists; `device="cpu"` is hardcoded so CUDA is ignored | V | T-ANA-05 |
| F-ANA-06 | "Stems" are FFT band proxies (drum = low_mid + high; vocal = 300 to 3400 Hz band), not source-separated stems | V | T-ANA-06 |
| F-ANA-07 | All-In-One tempo, beats, downbeats, labels, 100 Hz activations and embeddings are not retained | V | T-ANA-05 |
| F-ANA-08 | Decode is not one canonical pipeline: `canonical_wav` writes integer PCM WAV, mono is decoded separately, the WAV cache key is the path string (stale after edits) | V | T-ANA-03 |
| F-ANA-09 | `resample_to_beats` stretches envelopes with `linspace` over the beat count and ignores beat timestamps (3 beats, 1.4 s off in a synthetic test) | V | T-ANA-09 |
| F-ANA-10 | About 9 to 14 of the 22 spec 18 features are missing (loudness proxy, centroid, rolloff, flux as a frame series, onset strength and density, ZCR, kick and snare transients, stem RMS, dynamic range, energy derivative); five helpers are dead; no subbeat, bar or phrase aggregation; no frame-level artifact | V | T-ANA-09 |
| F-ANA-11 | Only build-start, drop, fake-drop, breakdown and silence are ever emitted; the contract enum lacks several spec 22 events | V | T-ANA-10, T-ANA-12 |
| F-ANA-12 | Fake drops: silence variant only; 4-beat step search; downbeat-only candidates; fields named `beat`/`endBeat` rather than `fakeImpactBeat`/`actualImpactBeat` | V | T-ANA-10 |
| F-ANA-13 | Drop detection ignores `novelty`; `on_downbeat=True` is hardcoded; candidates are every 4th array index rather than real `beatInBar`; an 8-beat "restraint" inside the detector deletes legitimate events | V | T-ANA-10 |
| F-ANA-14 | Build detection uses energy and drum slope only (no centroid, onset density, bass movement, boundary confidence or harmonic tension slopes) | V | T-ANA-10, T-ANA-18 |
| F-ANA-15 | Beat This CLI invoked as `beat_this audio out` (the output flag is `-o`); every first column is read as a downbeat without beat-in-bar | V | T-ANA-07 |
| F-ANA-16 | GRID_WARNING compares only the first timestamp and is encoded as a fake `section-transition` at beat 1, appended twice | V | T-ANA-08 |
| F-ANA-17 | Evidence is computed and stripped; the TS schema has no evidence field; a test asserts its absence | V | T-ANA-11, T-ANA-12 |
| F-ANA-18 | Duration comes from the last beat (drops the tail); analyzer version hardcoded `0.1.0`; artifact filename is a hash of the track ID only; non-atomic overwrite; default output `/tmp/autolight-analysis`; no source fingerprint | V | T-ANA-13 |
| F-ANA-19 | `silence_probability(0.005)` returns 1.5; `beat_aggregate` divides partial groups by the full group size | V | T-ANA-14 |
| F-ANA-20 | `AnalysisClient`: requeue drops `audioPath` and `nativeMetadataPath`; queue never drained; no restart; duplicate track IDs overwrite pending resolvers; calls before `start()` hang; no timeouts, cancel, progress or concurrency; spawn errors unhandled; relative project path; never instantiated | V | T-ANA-02 |
| F-ANA-21 | `worker.main()` parses JSON outside the error guard (a malformed line kills the worker); third-party stdout can corrupt the protocol | V | T-ANA-01 |
| F-ANA-22 | No fresh-machine preparation: no bundled Python/uv/FFmpeg/models, weights download on first use, no pre-warm, no offline mode | V | T-ANA-05, T-OPS-05 |
| F-ANA-23 | A nonexistent audio file returns `complete` with an empty model instead of a typed failure | V | T-ANA-04, T-ANA-15 |
| F-ANA-24 | TrackModel lacks metadata, nativeAnalysis, phrases, frameFeatures, beatFeatures; Zod strips unknown fields | V | T-ANA-12 |
| F-ANA-25 | Three pytest tests hardcode `/Users/rocket/...` paths and fail on any other machine; CI's pytest step is red; `yarn verify:phase1` exits 1 | V | T-TRU-16 |
| F-ANA-26 | All five committed real-track TrackModels are `structured` with zero events; the only "proven" show has three cue types and no drop programming | V | T-ANA-16, T-QA-09 |
| F-ANA-27 | All-In-One labels never form sections when PSSI is absent; confidences are constants (0.8, 0.7, 0.9) rather than evidence-derived | V | T-ANA-11 |
| F-ANA-28 | Harmonic tension proxy (spec 23) and key are absent | V | T-ANA-18 |
| F-ANA-29 | ML weight download location, licensing and offline behaviour are unmanaged | V | T-ANA-05, T-OPS-05 |
| F-PLAN-01 | `planShow` computes `trackIdentity()` and discards it (`void identity`, `show-planner/src/index.ts:84-85`); the renderer invents hue from `(startBeat*137+210)%360` (15 hues for 15 sections on a real track) | V | T-PLAN-01, T-PLAN-02, T-REND-03 |
| F-PLAN-02 | ShowPlan lacks `globalDesign`, `sections`, `recurrence` (MotifMap) and `constraints`; the planner takes no VenueModel or capability class | V | T-PLAN-01 |
| F-PLAN-03 | About 7 of the 27 required primitives exist, as free strings; no per-primitive parameters (colour, attack, release, direction, origin) | V | T-PLAN-04, T-REND-02 |
| F-PLAN-04 | Hierarchy is a section look plus a fixed 8-beat chase-flip; phrases, bars, beats and sub-beats are not planned | V | T-PLAN-03 |
| F-PLAN-05 | Recurrence is occurrence parity (`motifVariant` ignores its `kind`); no similarity, no motif memory | V | T-PLAN-08 |
| F-PLAN-06 | Style fields `darknessPreference`, `strobeFrequency`, `reactiveAmount` are unused; `spatialDensity`, `colorSaturation`, `paletteChangeRate`, `movementDensity`, `impactAggression`, `symmetry` are missing | V | T-PLAN-09 |
| F-PLAN-07 | The restraint engine is one 8-beat white-hit cooldown with a "ponytail" comment; 10 of 11 required state fields are missing | V | T-PLAN-05 |
| F-PLAN-08 | Contrast is a scalar per section kind; drops get no staged build, no pre-drop darkness, no 90 ms impact, no quantized burst, no reveal | V | T-PLAN-06 |
| F-PLAN-09 | Event confidence and strength are unused; fills, vocals, silence, final hits and outro releases are ignored | V | T-PLAN-07 |
| F-PLAN-10 | `validatePlan` is narrow and never runs in production; `evaluatePlan` computes 5 of the 10 spec 115 diagnostics, crudely | V | T-PLAN-10 |
| F-PLAN-11 | `regenerateSection` uses array indices that shift after regeneration; no cue IDs, lock regions or edit persistence | V | T-PLAN-11 |
| F-PLAN-12 | The planner golden writes itself if missing (`golden.test.ts:19-26`); the reference track is synthetic and tiny | V | T-TRU-15, T-PLAN-15 |
| F-PLAN-13 | `blendRgb` (linear light) is only used by a unit test; no OKLab or OKLCH exists anywhere | V | T-PLAN-02, T-MIX-02 |
| F-PLAN-14 | No candidate-scoring hook (spec 113) | V | T-PLAN-12 |
| F-PLAN-15 | No strobe cue is ever generated, so strobe budgets and invariants are untestable | V | T-PLAN-04, T-PLAN-05 |
| F-PLAN-16 | Cues have no colour field and targets are free strings with no `SpatialSelector` type | V | T-PLAN-01 |
| F-PLAN-17 | `SECTION_ENERGY` and every other planner number are hardcoded | V | T-CFG-04, T-PLAN-09 |
| F-PLAN-18 | Determinism inputs omit the venue capability class (spec 27) | V | T-PLAN-01 |
| F-REND-01 | Cells composite with `Math.max`, so higher-priority darkness cannot override lighter layers; partial blackouts and dips are no-ops (28 of 28 cells stayed lit) | V | T-REND-01 |
| F-REND-02 | White hit and impact are rendered as a chase phase; any `ALL` white or impact whites out every lit cell; no attack or release envelopes | V | T-REND-02 |
| F-REND-03 | Hue comes from the start beats of the lowest-priority active cues, in HSV; the secondary hue drifts as chase cues advance | V | T-REND-03 |
| F-REND-04 | `renderWithLatency` renders each fixture alone, changing global order, parity and phase; zero latency gives a different frame than `renderFrame`; latency converts through one fixed BPM | V | T-REND-04 |
| F-REND-05 | LEFT, RIGHT and CENTER are population thirds of a sorted cell list, not physical regions | V | T-ROOM-06, T-REND-05 |
| F-REND-06 | Calibration gamma, brightness ceiling, orientation and transforms are ignored; gamma is a fixed 2.2 | V | T-REND-03 |
| F-REND-07 | Frames allocate `cells.length*3` bytes but write at `cell.index*3`; sparse indices misaddress; the UI reads frames by array position | V | T-REND-05 |
| F-REND-08 | The 8-layer stack of spec 33 does not exist | V | T-REND-01 |
| F-REND-09 | `renderer/src/index.ts:1` imports `createHash` from `node:crypto` and never uses it | V | T-TRU-14 |
| F-REND-10 | Per-cell `fixtures.find` and string-keyed maps on the hot path (quadratic, allocation-heavy, AGENTS.md section 8) | V | T-REND-05 |
| F-REND-11 | Intensity is applied to a pure hue via `linearScale(255, level*shape)` with a hardcoded 0.75 to 1.0 left-to-right shape; not linear-light scaling of arbitrary colours | V | T-REND-03 |
| F-MIX-01 | `audibleWeight = channelFader * crossfader` for every deck: at crossfader 0 both decks are silent, at 1 both are full; no assignment or curve | V | T-MIX-01 |
| F-MIX-02 | Base weights are normalized, so a lone quiet deck produces a full look | V | T-MIX-02 |
| F-MIX-03 | `translateBlackout` returns unchanged when `target === "ALL"` (the case spec 66 exists for) and emits an unresolvable `SIDE` target | V | T-MIX-04 |
| F-MIX-04 | `liveViewModel` renders `mixA.cues` and `mixB.cues`, bypassing `mixDown`; a non-owner's exclusive white hit changes the pixels | V | T-MIX-06 |
| F-MIX-05 | Deck colours blend as gamma-encoded integers; upcoming cues from both decks are filtered with one deck's beat | V | T-MIX-02, T-MIX-06 |
| F-MIX-06 | Introduction stages use a `priority <= 11` heuristic instead of layer semantics | V | T-MIX-05, T-PLAN-13 |
| F-MIX-07 | Impact ownership uses weight times strength only; master, confidence and structural significance are ignored | V | T-MIX-03 |
| F-MIX-08 | Master deck is ignored everywhere (`master: null`) | V | T-MIX-01, T-LIVE-14 |
| F-RUN-01 | `trackDeck` sets `predicted = prevBeat + 0`, calls `isSeek` with beats as seconds, has no PLL or smooth correction; no production caller | V | T-RUN-02, T-RUN-03 |
| F-RUN-02 | Loops are not integrated (`DeckState.loop` never consumed; pass variation unused); tiny loop and roll degradation (spec 60) absent | V | T-RUN-04 |
| F-RUN-03 | Scratch, reverse and paused seeks are conflated: any negative rate holds, and a paused hot cue jump holds instead of reconstructing | V | T-RUN-05 |
| F-RUN-04 | `quantizeResume` rounds `immediate` up to the next integer; bar and phrase assume multiples of 4 and 16 rather than native downbeats and phrases | V | T-RUN-07 |
| F-RUN-05 | `clockHealth` reports `live` only at exactly 0 ms; degradation is never applied to output; no adaptive switch | V | T-RUN-06 |
| F-RUN-06 | The adaptive director picks one of four strings by `seed % n`; no phrase-length looks; unused | V | T-RUN-09 |
| F-RUN-07 | The manual override state machine (spec 134) does not exist | V | T-RUN-07 |
| F-RUN-08 | No "live track without prepared show" handling or clean upgrade at a phrase boundary (spec 140) | V | T-RUN-08 |
| F-RUN-09 | `loadFastPath` returns an artifact path as `trackJson`; unused | V | T-RUN-08, T-DATA-04 |
| F-RUN-10 | Fault policies (spec 105 to 107) are pure functions with no runtime; no per-device FPS backoff in a real loop | V | T-RUN-06, T-GOV-06 |
| F-AUD-01 | Reactive audio is a time-domain peak; no FFT, mel banks, onset detection, spectral difference or AGC in capture; `agcStep` is unused | V | T-AUD-02 |
| F-AUD-02 | `applyOverlay` adds gain to zero channels (relights darkness) and per channel (shifts hue) | V | T-AUD-03 |
| F-AUD-03 | `getUserMedia({audio:true})` ignores the selected device; repeated Start leaks AudioContexts and RAF loops; stale sensitivity closure; enumeration mislabeled as permission granted | V | T-AUD-01 |
| F-AUD-04 | `MAX_OVERLAY_GAIN = 0.2` is hardcoded with a "ponytail" comment; spec 68 says the amount is style-dependent | V | T-AUD-03, T-CFG-04 |
| F-AUD-05 | Audio capture lives in the React renderer and dies with a UI reload (spec 108) | V | T-AUD-01 |
| F-GOV-01 | `vendor/govee-toolkit/` is a 28-line `PIN.md`; no dependency on `govee-toolkit`; `ToolkitStreamFactory` has only a test double | V | T-GOV-01 |
| F-GOV-02 | `encodeFrame` uses a 1-byte length that counts opcode and checksum and an XOR that skips `0xBB`; no `{"cmd":"razer","data":{"pt":base64}}` envelope; no gradient or segment-count bytes; zero tests; `vendor/README.md` claims "implemented and tested" | V | T-GOV-02 |
| F-GOV-03 | No razer lifecycle (arm B1, settle, stream B0/B4, status B2, disarm); `pushFrame` has no callers | V | T-GOV-08 |
| F-GOV-04 | `frameToLan` collapses a frame to its middle cell and sends whole-device `colorwc`; comments assert "H6076 is single-zone over LAN (community-confirmed)"; spec 153 violation | V | T-GOV-10 |
| F-GOV-05 | Black frames send `turn(false)`; coloured frames send `turn(true)`, `brightness`, `colorwc` every frame (three back-to-back commands, the third of which the toolkit documents as dropped); spec 46, 47, 50 violations | V | T-GOV-09 |
| F-GOV-06 | `sendToDevice` spawns `node -e` per datagram and never closes the socket (5 of 5 children alive after 4 s); `node` is not on PATH in a packaged app | V | T-GOV-04 |
| F-GOV-07 | Discovery: per-interface broadcast addresses are never supplied; broadcast enabled after sends; multicast membership on the default interface only; remembered IPs in memory only; no backoff or background rescan; each scan binds a new socket on 4002; no port-conflict message; replies without `ip` (govee2mqtt issue 437) are rejected | V | T-GOV-05 |
| F-GOV-08 | `devStatus` is sent but replies are never consumed; `parseStatusReply` is unused; Diagnostics claims "devStatus read-back verified per command" | V | T-GOV-07 |
| F-GOV-09 | Identity mismatch: the service keys devices by Govee device ID while UI tiles use the IP as ID, so IDENTIFY and TEST CHASE return `{ok:false}` | V | T-GOV-06 |
| F-GOV-10 | IDENTIFY sends only `turn on` (comment: white flash then restore); TEST CHASE sends one `brightness 100` (comment: 3-step ramp); RECALIBRATE is an echo | V | T-GOV-12 |
| F-GOV-11 | Venue tiles are filled with 14 segments, 30 fps, 25 ms, online, firmware unknown immediately after a scan | V | T-GOV-11, T-UI-08 |
| F-GOV-12 | No qualification runner (spec 52 lists 16 steps; code lists 12 names); no REQUALIFICATION REQUIRED persistence | V | T-GOV-11 |
| F-GOV-13 | `DeviceManager`, `FrameCoalescer`, `LatestStream` are unused in production; no reconnect re-arm or current-frame resend; no real per-device FPS backoff | V | T-GOV-06, T-GOV-08 |
| F-GOV-14 | `LatestStream.flush()` still sends after `close()`; pending `Uint8Array` buffers are shared and mutable | V | T-GOV-08 |
| F-GOV-15 | No H6076 or H1A45 device profiles and no per-unit calibration persistence | V | T-GOV-13 |
| F-GOV-16 | Global brightness is sent per frame; there is no slow master-intensity path | V | T-GOV-09, T-RUN-07 |
| F-GOV-17 | Cloud limits must be configuration; Govee documents 10 requests per minute per device and 10,000 per day per account (toolkit `docs/protocol/cloud.md`, unconfirmed live); cloud is never a frame path | C | T-CLD-01 |
| F-GOV-18 | `LanTransport = "lan" \ | V | T-FOV-01 |
| F-GOV-19 | Comments credit "Lightwave order" for a BLE last-resort fallback; Lightwave has no BLE control | V | T-TRU-14 |
| F-GOV-20 | Spec 111 network hygiene absent: interface binding choice, no-WAN guarantee, network trust status in diagnostics | V | T-GOV-16, T-SEC-02 |
| F-GOV-21 | Unknown firmware model (spec 147) absent: background checks, no spamming of a failing raw stream, verified fallback only | V | T-GOV-17 |
| F-GOV-22 | No frame-rate cap by zone count; toolkit measured ceilings (40 Hz at 20 zones, 25 Hz at 60, 20 Hz at 120 on H61A0) and a 10 Hz fallback are not encoded | V | T-GOV-08, T-GOV-11 |
| F-GOV-23 | Toolkit traps not encoded: arm settle about 50 ms; `turn` or white `colorwc` while armed ends the channel; three back-to-back commands drop the third; a unit may not answer status while armed | V | T-GOV-08, T-GOV-14 |
| F-GOV-24 | Community report that some H6076 hardware revisions lost LAN support | U | T-GOV-10, T-GOV-11 |
| F-GOV-25 | UDP 4002 is exclusive; Govee Desktop, homebridge-govee, SignalRGB or Govee LAN Control can hold it; no detection or message | V | T-GOV-05 |
| F-GOV-26 | The SignalRGB network checklist (LAN toggle, same subnet, firewall, AP or client isolation) is not surfaced in setup or diagnostics | V | T-GOV-16, T-UI-10 |
| F-GOV-27 | `ptReal` over LAN (base64 BLE-format packets, govee2mqtt) is unused; useful for scenes as idle or ending looks | V | T-GOV-18 |
| F-GOV-28 | Segment resolution selection (spec 53: logical, grouped, native) is not implemented; `selectResolution` is unused | V | T-GOV-15 |
| F-GOV-29 | Per-device metrics (frames requested, sent, superseded, FPS, status RTT, last response, health) are not collected | V | T-GOV-19 |
| F-GOV-30 | H1A45 is RGBWWIC; white LEDs must not be used for show-time white hits (spec 48) unless qualified to not disarm the stream; policy undefined | U | T-GOV-09 |
| F-BLE-01 | No BLE transport; `"ble"` exists only as a type string | V | T-BLE-01 to T-BLE-10 |
| F-BLE-02 | Required protocol knowledge is not encoded: GATT service and characteristics, 20-byte `0x33` frames with XOR, one connection at a time, paced writes (100 Hz budget measured on H61A0), masked zone colour `33 05 15 01`, per-zone brightness `33 05 15 03`, reads `aa 0f` (segment count) and `aa 40` (IC count), host colour channel `a5 02 83` with sum checksum, encoded-link flag `0x40` with handshake, address to Wi-Fi MAC binding, advertisement name families | V | T-BLE-02 to T-BLE-07 |
| F-BLE-03 | OS permissions and prompts (macOS `NSBluetoothAlwaysUsageDescription`, Windows capability, Linux BlueZ) are not handled | V | T-BLE-08 |
| F-BLE-04 | Discovery-only versus control must be distinct; LAN and BLE identities must not auto-merge (Lightwave lesson) | V | T-BLE-02 |
| F-BLE-05 | BLE is the owner's answer for campus or venue Wi-Fi with client isolation | V | T-FOV-02 |
| F-BLE-06 | Newer firmware requires an encrypted BLE session (toolkit `E7` handshake; govee-homeassistant AES-GCM v2 read from characteristic `...2b12`) | V | T-BLE-07 |
| F-MAT-01 | No Matter controller (matter.js); no commissioning, multi-admin pairing, OnOff, LevelControl or ColorControl; Matter is basic control only and never a segment stream | V | T-MAT-01 to T-MAT-04 |
| F-CLD-01 | No cloud client for capability discovery, metadata and setup; API key storage in `safeStorage` absent; must never carry frames | V | T-CLD-01, T-CLD-02, T-SEC-01 |
| F-VEN-01 | `Fixture` lacks `topology`, `transform` and `capabilities` (spec 38) | V | T-ROOM-02 |
| F-VEN-02 | No 2D venue editor (drag, rotate, reverse, resize, tags, groups) | V | T-ROOM-03 |
| F-VEN-03 | Default groups are not derived from positions; only explicit `fixture.groups` resolve | V | T-ROOM-06 |
| F-VEN-04 | No persisted venues and no switching between venues | V | T-ROOM-11 |
| F-VEN-05 | Orientation and cell order are never applied in rendering; `applyOrientation` is unused | V | T-ROOM-04, T-REND-03 |
| F-ROOM-01 | The owner's rig has segmented strips on the ceiling tracing the room outline (a square room). The app has no way to draw the room shape, mark the DJ position, set the "middle", or map where the strip's controller sits and where its runs go and meet | V | T-ROOM-01, T-ROOM-03, T-ROOM-04 |
| F-ROOM-02 | Effects must be expressible over that geometry: alternating half-room strobes, pulses originating from a point, a light that continuously circles the room, and more | V | T-ROOM-05, T-ROOM-06, T-ROOM-07 |
| F-ROOM-03 | The controller point and the meeting point of two runs are generally not where the DJ stands, so effects must be anchored to user-defined points, not the strip's index 0 | V | T-ROOM-04, T-ROOM-05 |
| F-ROOM-04 | The preview must show the real room with every real cell | V | T-ROOM-10 |
| F-UI-01 | Many visible controls only change local state (see F-APP-19) | V | T-UI-04 |
| F-UI-02 | Master intensity is a hardcoded "80%" badge; shortcut A sends resume without the required `at` and is rejected; Z always sends `frozen: true` (no toggle); the comment promises Space and 1 to 9 which do not exist | V | T-UI-03 |
| F-UI-03 | No dual waveform; deck cards show about 3 of 17 spec 90 fields; `countdown` is always `undefined` so "DROP IN 8" can never render | V | T-UI-02 |
| F-UI-04 | The venue preview is a flex row of swatches that loses y, z, fixture and segment identity | V | T-ROOM-10, T-UI-02 |
| F-UI-05 | Upcoming cues are rebuilt with a fake duration of 4, intensity 0.8, priority 10, and use one deck's beat for both decks | V | T-UI-02, T-MIX-06 |
| F-UI-06 | Library shows at most the two fixture tracks with title IDs, READY hardcoded, one BPM repeated, blank artist | V | T-UI-05 |
| F-UI-07 | Inspector prints the first 24 values of three text lanes from fixture files; no graphical lanes; no audition | V | T-UI-06 |
| F-UI-08 | Inspector can show deck A when deck B is selected and refetches on every live tick | V | T-UI-06 |
| F-UI-09 | No track corrections UI | V | T-UI-07 |
| F-UI-10 | No venue canvas or calibration wizard; Setup is a checklist that marks "dj" done unconditionally and "identify"/"qualification" done when tiles exist | V | T-UI-08, T-UI-09 |
| F-UI-11 | Diagnostics tabs are strings; no Track Resolver tab; no DJ Event Inspector; metrics forced (`djUpdateRateHz = 1`, `djStateAgeMs = 0`); empty device maps; false "read-back verified" | V | T-UI-10, T-OPS-03 |
| F-UI-12 | Ergonomics: 12 to 14 px text, 32 px controls, Live dominated by the manual lane; readability from several feet unverified | V | T-UI-12 |
| F-UI-13 | `isModalAllowed` is unused; the Toaster mounts unconditionally; no-modal policy is not enforced | V | T-UI-12 |
| F-UI-14 | None of the 14 required reusable components (spec 142) exists | V | T-UI-01 |
| F-UI-15 | Status bar lacks timing health, Govee n of m, FPS and latency (spec 89) | V | T-UI-02 |
| F-UI-16 | No analysis readiness explanation (spec 137) and no preanalysis queue UI (spec 139) | V | T-UI-05 |
| F-UI-17 | No Settings screen (owner request: every configuration visible) | V | T-CFG-05, T-UI-11 |
| F-UI-18 | The manual lane's consumer "party" aesthetic sits on the Live surface, contrary to spec 88 and 151 | V | T-UI-04 |
| F-UI-19 | No explicit, badged simulator mode for demos without hardware | V | T-UI-15, T-TRU-02 |
| F-DATA-01 | The `Store` is never opened by the app; default path `:memory:`; WAL pragma inert | V | T-DATA-01 |
| F-DATA-02 | Uses `node:sqlite`; spec 80 requires better-sqlite3 with Kysely | V | T-DATA-01 |
| F-DATA-03 | 7 of 17 spec 81 tables; no migrations; `analysis_artifacts` keyed by track only; plan cache key lacks style hash, source fingerprint and venue class | V | T-DATA-02, T-DATA-03 |
| F-DATA-04 | Fast path returns an artifact path as `trackJson` | V | T-DATA-04 |
| F-DATA-05 | Contracts validate shape only: duplicate or unsorted beats, reversed ranges, events beyond duration, inconsistent segment counts all pass | V | T-DATA-05 |
| F-DATA-06 | Session recorder records scan, identify and chase only; no DJ observations, decisions, frame hashes or health; no export or replay; `shift()` on a 100k array | V | T-DATA-06 |
| F-DATA-07 | `safeStorage` unused; no Govee API key storage | V | T-SEC-01 |
| F-DATA-08 | No settings persistence | V | T-CFG-02 |
| F-SEC-01 | No content security policy, renderer sandbox flag, navigation guards or IPC sender checks | V | T-SEC-03 |
| F-SEC-02 | Read-only access to Rekordbox and Serato data is a convention, not enforced at open | V | T-SEC-04 |
| F-SEC-03 | Memory reading (rkbx_link or the clean-room reader) requires re-signing Rekordbox and elevated privileges; no consent flow or audit exists | V | T-SEC-05, T-LIVE-11 |
| F-SEC-04 | BLE encrypted-link keys are vendor constants published in an MIT repo; shipping them is an owner decision | V | T-BLE-07 |
| F-OPS-01 | Structured logging (spec 130) is a helper nobody calls; no log files, rotation or diagnostic mode | V | T-OPS-02 |
| F-OPS-02 | Spec 131 metrics are not measured | V | T-OPS-03 |
| F-OPS-03 | Graceful shutdown and ending look (spec 133) absent | V | T-ARC-03 |
| F-OPS-04 | Update strategy (spec 145) absent | V | T-OPS-04 |
| F-OPS-05 | No packaging: no electron-builder or Forge, signing, notarization, installer, bundled uv/Python/FFmpeg/models/native addons, `asarUnpack`, entitlements | V | T-OPS-05 |
| F-OPS-06 | No clean-machine install test | V | T-OPS-06 |
| F-OPS-07 | README says "Node.js 22 (see package.json engines)" but there is no `engines` field; Electron bundles its own Node | V | T-TRU-17 |
| F-OPS-08 | CI: pytest red, Playwright Chromium installed and unused, no lint, no coverage, no packaging job | V | T-TRU-11 |
| F-OPS-09 | No crash handling or safe-state policy (spec 133) | V | T-OPS-07 |
| F-OPS-10 | macOS 15+ Local Network privacy prompt (`NSLocalNetworkUsageDescription`) is required for LAN discovery from a packaged app; not handled | U | T-OPS-05 |
| F-QA-01 | Vitest collects compiled `dist` tests: 214 executions, about 111 unique tests | V | T-TRU-07 |
| F-QA-02 | Playwright "E2E" imports functions and never launches Electron; the blackout test is `expect(true).toBe(true)` | V | T-TRU-15, T-QA-02 |
| F-QA-03 | "4h soak" is 864,000 synchronous iterations in about 21 s; `soak()` resets `pending` every iteration so `maxPending <= 1` is guaranteed | V | T-TRU-15, T-QA-06 |
| F-QA-04 | Goldens are sparse; one renderer hash; planner golden self-writes; several determinism tests compare output to itself | V | T-QA-10 |
| F-QA-05 | Simulator, fault and performance tests are not application-level; no measured spec 117 to 119 targets | V | T-QA-04, T-QA-05, T-QA-07 |
| F-QA-06 | Cross-platform CI proves builds only; AX follow is macOS-only and silently absent on Windows | V | T-QA-11, T-LIVE-06 |
| F-QA-07 | No property tests (fast-check or Hypothesis) | V | T-QA-12 |
| F-QA-08 | No coverage measurement despite AGENTS.md gates (line 85, branch 80, function 90, mutation 75) | V | T-TRU-07, T-TRU-08 |
| F-QA-09 | The `translateBlackout` test uses `SIDE`, an input the planner never produces | V | T-MIX-04 |
| F-QA-10 | No analysis golden tests | V | T-ANA-16 |
| F-QA-11 | Replay "speed" (1x, 2x, 10x, step) only rescales synthetic timestamps | V | T-QA-03 |
| F-QA-12 | No recording or fault-injecting transport; no hardware-in-the-loop harness | V | T-GOV-14, T-QA-04 |
| F-QA-13 | No curated visual validation set (spec 116) or review tooling | V | T-QA-09, T-QA-13 |
| F-QA-14 | Tooling recommendations (Knip, dependency-cruiser, CodeQL, Semgrep and ast-grep rule packs, Stryker, mutmut, Playwright Electron, capability manifest, claim tests, runtime invariants, recording and fault transports, timing harness, staged CI) not adopted | V | T-TRU-04 to T-TRU-12 |
| F-DOC-01 | `docs/*.md` other than SPEC, the capture log and ADR-001 are 3 to 5 line stubs; the owner's "DOCUMENT EVERYTHING" was not honoured | V | T-DOC-01 |
| F-DOC-02 | README capability table over-claims (see briefing section 1) | V | T-TRU-05 |
| F-DOC-03 | README says spec covers sections 1 to 150; it has 155 | V | T-DOC-01 |
| F-DOC-04 | ADR-001 chose AX and ProLink and omitted rkbx_link; needs superseding ADRs for every decision switch | V | T-DOC-02 |
| F-DOC-05 | `vendor/README.md` claims the codec is implemented and tested | V | T-DOC-01 |
| F-DOC-06 | CONTRIBUTING describes E2E and replay practices the repo does not have; AGENTS.md repository memory has TBD canonical commands and an empty scars section | V | T-DOC-03 |
| F-DOC-07 | No `THIRD_PARTY_NOTICES` | V | T-DOC-04 |
| F-CFG-01 | Operational values are hardcoded across the codebase (seek thresholds, clock health 500/2000 ms, introduction 0.05/0.3/0.7, blackout translation 0.3, overlay 0.2, section energies, cooldowns, chase period, build windows, drop thresholds, silence thresholds, band edges, FFT sizes, scan timeouts, poll intervals, ports, cursor interval, blinder period, tile metrics, FPS backoff floor, gamma, shape curve, recorder capacity, AGC constants, director cooldowns) | V | T-CFG-04 |
| F-CFG-02 | No configuration file and no UI to see or change any of it | V | T-CFG-01, T-CFG-02, T-CFG-05 |
| F-DEC-01 | Where there is a choice between approaches, implement each, plus a combined mode, behind a visible switch | V | T-CFG-06 and every task listed in the decision catalog |
| F-X-01 | `follow.ts` polls master.db mtime every 2000 ms through `rekordbox-connect` | X | `follow.ts` is AX scraping plus a ProLink listener; `rekordbox-connect` is not installed |
| F-X-02 | Rekordbox database access "WORKING" in `packages/rekordbox-library` | X | Helpers only; nothing opens master.db (F-RBL-01) |
| F-X-03 | FLX4 telemetry "WORKING" | X | No MIDI I/O (F-FLX-01) |
| F-X-04 | ANLZ parsers live in `packages/rekordbox-library/src/anlz/` | X | ANLZ parsing is Python `native.py` through pyrekordbox |
| F-X-05 | `govee-lan.ts` does multicast only | X | It sends multicast, optional broadcast addresses, global broadcast and remembered-IP unicast (partially broken, F-GOV-07) |
| F-X-06 | govee2mqtt `quirks.rs` declares `segment_rgb: 0..14` for H6076 | X | `quirks.rs:300` is `Quirk::lan_api_capable_light("H6076", FLOOR_LAMP)`; no segment table exists |
| F-X-07 | H6076 has exactly 14 addressable razer segments and H1A45 has 12 | U | Govee product material says 14 segmented controls for H6076 (spec 42); nothing verifies razer zone counts or H1A45. Measure per unit (T-GOV-11) |
| F-X-08 | Razer arm frame is `BB 02 B1 01 xor` and frames are `BB len B0 ...` with 1-byte length | X | Pinned toolkit: 16-bit payload-only length, XOR over all preceding bytes including `BB`, inside `{"msg":{"cmd":"razer","data":{"pt":"<base64>"}}}`; arm is `bb 00 01 b1 01 0a` |
| F-X-09 | "H6076 ignores razer; single-zone over LAN" and "H6076 accepts razer at 14 segments" | U | Both unverified. Probe per unit (T-GOV-10) |
| F-X-10 | `store.ts` initial state is pre-populated from `test-fixtures` | X | Store starts with `live: null`; `resolve-live.ts` fetches fixtures (F-APP-03) |
| F-X-11 | Python analysis falls back to synthetic sinusoids and pseudo-random markers when models are missing | X | It returns `None` and skips ML; the defect is silent `full` labelling (F-ANA-04) |
| F-X-12 | Serato "PARTIAL/wrapped" transport | X | Parsers only; no transport (F-SER-01) |
| F-X-13 | The cloud comment "10/min/device" contradicts a researched "2 requests per second" | X | Govee documents 10 per minute per device and 10,000 per day per account; make both configuration (F-GOV-17) |
| F-X-14 | "Per-segment colour requires the cloud" | X | True for the official LAN JSON API; the undocumented razer channel and BLE masked writes carry segments locally, per unit |
| F-X-15 | "Venue canvas provides basic positioning" | X | No positioning exists (F-VEN-02) |
| F-X-16 | "Electron boots cleanly under xvfb" | U | Reported by R11; R1 could not launch Electron (binary download blocked). Re-verify in T-QA-02 |
| F-X-17 | "Some H6076 revisions dropped LAN in firmware" | U | Community report; mitigated by per-unit probing (F-GOV-24) |
| F-X-18 | "Rekordbox 7.2.10 predates the SoundSwitch integration" | C | Consistent with spec 8 (7.2.19 introduced it) |
| F-X-19 | UI built with Tailwind v4, shadcn and Radix | C | True (`apps/desktop/package.json`, `components/ui/*`) |

## Owner decisions

Record the owner's answer, the date and the measurements shown. Tasks waiting
on one of these are `BLOCKED-OWNER-DECISION` for that step only; everything
else in the task is built and verified first.

| ID | Decision | Options | Measurements to show | Tasks | Answer |
| --- | --- | --- | --- | --- | --- |
| OD-01 | Rekordbox version path | Stay on 7.2.10; update to 7.2.17 or 7.2.18 (rkbx_link on macOS); update to 7.2.19+ (Lighting integration); use Windows with a paid rkbx_link license, which covers 7.2.10 | Provider matrix from `T-LIVE-15` with SIM accuracy per provider | T-LIVE-03, T-LIVE-09, T-LIVE-15 | open |
| OD-02 | SoundSwitch for the one-time Lighting capture | Creative or Professional plan, or trial; or skip Lighting | Capture matrix size and time estimate | T-LIVE-09 | open |
| OD-03 | Install rkbx_link as a sidecar | Yes (re-sign Rekordbox, run with sudo); no | Accuracy and risk summary | T-LIVE-03, T-LIVE-04 | open |
| OD-04 | Clean-room memory reader | Enable with consent; do not build further than the test target | Same as OD-03 plus maintenance cost | T-LIVE-11, T-SEC-05 | open |
| OD-05 | Ship BLE encrypted-link keys | Ship; require the user to supply; disable encrypted link | Which owner units need it | T-BLE-07 | open |
| OD-06 | Signing spend | Apple Developer ID, Windows certificate, or unsigned builds | Install friction with and without | T-OPS-05 | open |
| OD-07 | Ableton Link licensing | Sidecar only; request Ableton's license for the SDK | Link value measured in the composite provider | T-LIVE-12 | open |
| OD-08 | Acoustic fingerprint binary | Bundle LGPL fpcalc; own implementation; pcm-hash only | Re-encode match rate | T-ID-01 | open |
| OD-09 | ML weights distribution | Bundle where licenses allow; download in Setup | Sizes, licenses | T-ANA-05, T-OPS-05 | open |
| OD-10 | Validation set tracks | The owner confirms the candidate list per category | Candidate list with analysis hints | T-QA-09 | open |
| OD-11 | Update mechanism | electron-builder updater; manual downloads | n/a | T-OPS-04 | open |
| OD-12 | Windows reference machine | Which machine runs Windows qualification | n/a | T-QA-05, T-QA-11 | open |

## Hardware and real-software runbook queue

Run in this order once the code for each is `DONE-VERIFIED` on SIM. Results go
in the named task's evidence folder.

| Runbook | Purpose | Tasks | Done |
| --- | --- | --- | --- |
| HW-GOV-01 | Discovery and identity per unit (all ladder rungs, MAC, SKU, firmware, port 4002 conflict check) | T-GOV-05, T-GOV-06 | no |
| HW-GOV-02 | razer capability probe per unit (status, arm, B2 state, native resolution sweep, fallback) | T-GOV-10 | no |
| HW-GOV-03 | 16-step qualification wizard per unit (rate ceiling, stability, latency, orientation) | T-GOV-11 | no |
| HW-GOV-04 | Blackout with stream armed (100 cycles), RGB white, brightness path, no power commands | T-GOV-09 | no |
| HW-GOV-05 | Disconnect and reconnect (power the lamp off and on, Wi-Fi drop, router restart) | T-GOV-06, T-GOV-08 | no |
| HW-GOV-06 | IDENTIFY, TEST CHASE, RECALIBRATE, identify walk | T-GOV-12 | no |
| HW-GOV-07 | ptReal scenes as idle and ending looks | T-GOV-18 | no |
| HW-BLE-01 | BLE scan, binding to LAN identity, link, masked zones, encrypted link detection, write budget | T-BLE-01 to T-BLE-07 | no |
| HW-BLE-02 | OS permission prompts on the packaged app | T-BLE-08 | no |
| HW-MAT-01 | Matter commissioning with multi-admin pairing and control | T-MAT-01 to T-MAT-03 | no |
| HW-FOV-01 | Failover scenarios on the real network (client isolation, multicast blocked) | T-FOV-02 | no |
| HW-ROOM-01 | Draw the owner's room, map the ceiling strip (seam, corners, gaps, mirrored check), verify orbit, room probes | T-ROOM-03, T-ROOM-04, T-ROOM-12 | no |
| HW-RB-LIB-01 | Library reader counts against Rekordbox | T-RBL-01 | no |
| HW-RB-RKBX-01 | rkbx_link OSC capture (owner decision gated) | T-LIVE-03 | no |
| HW-RB-PL-01 | Does the owner's setup emit PRO DJ LINK packets; capture if so | T-LIVE-05 | no |
| HW-RB-AX-01 | Accessibility element trees on macOS and Windows | T-LIVE-06 | no |
| HW-RB-COMP-01 | Composite provider lock time and error | T-LIVE-07 | no |
| HW-RB-AGENT-01 | Agent API liveness and token sources | T-LIVE-08 | no |
| HW-RB-LIGHT-01 | Lighting IPC surface inventory and full capture matrix on macOS and Windows (owner decision gated) | T-LIVE-09 | no |
| HW-RB-MEM-01 | Clean-room memory reader offsets (owner decision gated) | T-LIVE-11 | no |
| HW-RB-LINK-01 | Ableton Link with Rekordbox | T-LIVE-12 | no |
| HW-FLX-01 | Non-exclusive MIDI observation with Rekordbox running | T-FLX-01 | no |
| HW-FLX-02 | LED feedback observability | T-FLX-04 | no |
| HW-SER-01 | Serato Remote session capture | T-SER-01, T-SER-05 | no |
| HW-SYNC-01 | Spec 119 matrix on real software | T-QA-07 | no |
| HW-CAM-01 | Camera latency, spread and definitions of done for H6076, H1A45 and multi-device | T-QA-08 | no |
| HW-SOAK-01 | Four-hour soak on the rig | T-QA-06 | no |
| HW-INST-01 | Clean-machine install on the owner's second machine or a VM | T-OPS-06 | no |
| HW-REVIEW-01 | Owner review of the validation set and spec 151 moments | T-QA-09, T-QA-13 | no |
| HW-NIGHT-01 | The normal-night script of `99-final-acceptance.md` section 3 on the real rig, recorded | T-QA-11 | no |

## Final gate runs

Paste the exact commands and outputs of the last runs here when you stop
(`00-agent-briefing.md` section 9).

| Command | Date | Result | Output file |
| --- | --- | --- | --- |
| `node docs/finish/tools/check-coverage.mjs` | | | |
| `yarn verify:all` | | | |
| `yarn gates` | | | |

## Uncertainties

List anything you are unsure of here, as uncertainty, not as success.

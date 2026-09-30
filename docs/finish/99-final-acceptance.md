# 99. Final acceptance

This file decides whether AutoLight is finished. It restates SPEC section 153
(hard definition of done), section 152 (gates A to H) and section 150 (the
normal night) as scripts with measured pass criteria, adds the owner's
additions, and maps the companion completion contract's probe families onto
this plan. Read it before you start so you know the finish line. Run it when
every task in `STATUS.md` is `DONE-VERIFIED`, or `BLOCKED-HARDWARE` with the
runbook completed by the owner (physical steps only), or
`CLOSED-OWNER-DECLINED` with its decision record (section 11).

## 1. Global metrics (all must hold at the end)

| Metric | Threshold | Source |
| --- | --- | --- |
| Unit test coverage, every package | line 85, branch 80, function 90, statements 85 | AGENTS.md, `T-TRU-07` |
| Coverage, critical packages | line 95, branch 90 | `T-TRU-07` |
| Mutation score, listed modules | at least 85 | `T-TRU-08` |
| Surviving mutants in the safety-critical list | zero | `T-TRU-08` |
| Test classes present | all 12 of spec 126 | `T-QA-01` |
| Show host tick | 60 Hz logical, jitter p99 under 5 ms on reference Mac and Windows, including during a busy or frozen UI | spec 117, `T-QA-05`, `P-56` |
| Emergency blackout keypress to LAN send | p99 under 100 ms (target 20 ms) | spec 118, `P-94` |
| Visible impact spread across fixtures after calibration | p95 within 50 ms | spec 118, `T-QA-08` |
| Output queue per device | never above 1 pending frame; zero stale frames delivered | spec 51, 118 |
| Track load to installed plan (cached) | p95 under `runtime.fastPath.budgetMs` (100 ms) | spec 138 |
| UI frame time on Live with 2,000 cells | p95 under 16.7 ms | spec 88, 117 |
| Four-hour soak | all seven spec 125 conditions with trend tests | `T-QA-06` |
| Replay | 100 percent of committed real captures pass at 1x, 2x, 10x, step | spec 128 |
| Session replay | 100 percent frame hash equality | spec 103 |
| Truth gates | `yarn truth` (alias `yarn audit:truth`) green: no echo IPC, no fixtures in bundles, no forbidden words, no swallowed errors, no magic numbers, capability manifest truthful | `wp00` |

## 2. Minimum proof scenario (milestone M1 exit)

Run first on SIM, then on the owner's rig with one H6076 at least. This is
the vertical slice that the previous pass never had. Every step is automated
in `apps/desktop/e2e/m1-slice.spec.ts` for SIM (written in M0 by `T-QA-02` as
a failing probe). Some steps exercise tasks that finish in later milestones
(for example the planner, which WP11 rewrites in M3); those tasks stay
`IN-PROGRESS` and the slice uses their current state (README "Milestones").

1. Clean userData. Launch the built app (not `yarn dev`).
2. Startup stages appear in order with timings (spec 132, `P-132`).
3. The library reader opens the fixture Rekordbox DB (SIM) or the owner's
   library (HW); one real ANLZ-analysed track is resolved.
4. The Govee manager discovers the simulated H6076 (SIM) or the real lamp
   (HW) through the discovery ladder; qualification detects its segment count
   (no literal 14 anywhere).
5. The rkbx-osc simulator (SIM) or the best available real provider (HW)
   reports deck 1 loaded and playing.
6. The track resolves to its TrackModel and a ShowPlan compiled by the real
   planner, installed in the show host within the fast-path budget.
7. The recording transport (SIM) or a packet capture (HW) shows razer frames
   with per-segment colours that differ across segments, at the qualified
   rate, one arm, zero `turn` commands.
8. The show host snapshot the UI renders equals the transported logical frame
   (`P-92-snapshot-equals-output`, owned by `T-ARC-04`; the full room-view
   probe `P-92-preview-equals-output` comes with `T-ROOM-10` in M4).
9. Press B: black frames within 100 ms, stream still armed; press A: resume on
   the next bar.
10. Pause the renderer for 5 s: frames keep flowing (`P-56`).
11. Quit: the ending look is sent, streams disarmed, DB flushed (`P-133`).

Pass: all eleven steps green on SIM; steps 3 to 11 green on HW with a video.

## 3. Normal night script (spec 150), SIM and HW

The SIM version runs nightly as `apps/desktop/e2e/normal-night.spec.ts`
(owned by `T-QA-11`) in Simulator mode with the spec 124 rig: two H6076
profiles, one H1A45 perimeter strip mapped in the reference square room, and
one additional simulated Govee fixture, plus a Rekordbox source through
fusion and a scripted DJ. The HW version is `HW-NIGHT-01`, run by the owner with the real
rig, recorded on video, with the session recorder on.

| # | Action | Pass criterion (measured) |
| --- | --- | --- |
| 1 | Open the app | READY within `ops.startup.budgetMs`; status bar shows REKORDBOX with provider and quality |
| 2 | Rekordbox connects automatically | Source badge live without user action |
| 3 | Govee rig connects automatically | `Govee n/n` armed without user action |
| 4 | Library already analysed | Library shows FULL for the prepared playlist |
| 5 | Load track A | Show installed within the fast-path budget; deck card shows sections and the predictive field |
| 6 | Press play | Beat error p95 under `qa.sync.maxBeatErrorMs` against ground truth (SIM) or camera and audio (HW) |
| 7 | Load track B | B's plan installed; B contributes nothing visible while its fader is down (frame diff test) |
| 8 | Raise B's fader | B's palette and secondary spatial layer enter first, then rhythm, then impacts (`P-67` stages in order) |
| 9 | Crossfade | Visual ownership moves toward B (owner metric in the mixer trace) |
| 10 | Drop in B | B owns the impact; A's exclusive effects do not fire (`P-65-no-leak`) |
| 11 | Loop in B | The loop region repeats with pass variation; no score cursor confusion |
| 12 | Hot cue and seek | The lighting snaps to the correct song state within one tick |
| 13 | Pitch B plus and minus 8 percent | Beat error still within bound |
| 14 | Unplug one lamp for 10 s | Others unaffected; the lamp returns re-armed with the current frame within `govee.lan.reconnect.maxMs` |
| 15 | Busy UI (scroll the Library, open the Inspector) during a build | Tick jitter p99 under 5 ms |
| 16 | Ceiling strip effects | During the set, at least one Orbit, one two-way Ripple from the DJ and one half-room SplitAlternate are chosen by the planner and render continuously across the strip's seam |
| 17 | End the night | Graceful shutdown: configured ending look, streams disarmed |

No manual lighting programming is used at any step.

## 4. Hard definition of done (spec 153) checklist

Each line is proven by the evidence named. All must be checked.

- [ ] A user installs on a clean supported Mac and a clean supported Windows
      machine (`P-153-clean-install`, `T-OPS-06`).
- [ ] Connects a DDJ-FLX4 (`T-FLX-07`).
- [ ] Opens Rekordbox or Serato (`P-120`, `P-121`).
- [ ] Discovers multiple Govee fixtures including H6076 and H1A45
      (`HW-GOV-01`).
- [ ] Places and calibrates them visually, including drawing the room and
      mapping the ceiling strip, without editing code or JSON (`P-98`,
      `HW-ROOM-01`).
- [ ] Selects the music library for analysis (`P-139`).
- [ ] DJs normally while the system autonomously produces coherent,
      phrase-aware, section-aware, drop-aware, spatially coordinated,
      segmented lighting (section 3, `HW-NIGHT-01`, `T-QA-13`).
- [ ] Decks can be pitched; tracks can be changed; hot cues used; loops
      entered and exited; crossfades occur; both decks audible; fixtures
      briefly disconnect; the UI stays busy; playback seeks (`P-119` matrix,
      section 3 rows 6 to 15).
- [ ] Major musical events still produce intentional lighting; quiet music
      stays restrained; drops have meaningful impact; darkness is deliberate;
      effects do not degrade into random repetition (`T-QA-09` review,
      spec 115 diagnostics within bounds on the validation set, `P-151`).
- [ ] The Govee lights stay synchronized (`T-QA-08` spread).
- [ ] No cloud round trip is required (network test with WAN blocked during
      the normal-night run; runtime invariant counters zero).
- [ ] Rekordbox is fully supported, not half (all 18 spec 120 items on both
      OSes, `T-QA-11`).
- [ ] H6076 is driven as segmented RGBIC, not one bulb (`P-122`), unless a
      unit's firmware provably lacks the razer channel, in which case the
      product says so on that unit and the qualification record proves it.
- [ ] No "TODO: implement" anywhere in product code or UI (`T-TRU-06`).
- [ ] The UI is finished, not a debug surface (owner review of every screen,
      `T-UI-12` distance review).

## 5. Gates (spec 152)

`yarn gates` (`T-QA-11`) prints each gate with its probes and evidence. All
must say PASS.

| Gate | Pass means | Main probes |
| --- | --- | --- |
| A DJ data | Rekordbox and Serato acceptance suites pass on macOS and Windows | `P-120`, `P-121`, `P-119`, `P-128` |
| B Track intelligence | Native plus ML analysis produces valid TrackModels with events | `P-20`, `P-22` to `P-25`, `T-ANA-16` metrics |
| C Govee | H6076 and H1A45 segmented local rendering | `P-46`, `P-47`, `P-51`, `P-122`, `P-123`, `P-124` |
| D Show compiler | Reference tracks produce coherent deterministic scores | `P-27`, `P-114`, `P-115`, `P-116`, `P-129`, `P-151` |
| E Runtime | Loops, seeks, pitch, two-deck mixing | `P-57` to `P-67`, `P-119` |
| F UI | Primary workflows without developer tools | `P-89` to `P-102`, `P-100`, `P-143`, `P-144` |
| G Reliability | Four-hour soak | `P-125`, `HW-SOAK-01` |
| H Packaged application | Fresh-machine installation on supported macOS and Windows | `P-153-clean-install` |

## 6. Owner additions acceptance

| Addition | Acceptance |
| --- | --- |
| rkbx_link | The rkbx-osc provider passes the contract suite and the SIM sync matrix; the setup assistant verifies the owner's installation; the decision packet (`T-LIVE-15`) is in the owner's hands; a real capture replays after the owner's decision |
| Every live source as an option | DS-01 shows every provider with measurements; fusion is the default and visible |
| BLE | BLE transport qualified on at least one owner unit (`HW-BLE-01`) or recorded as unavailable on that unit's firmware with evidence; campus scenario passes on SIM (`T-FOV-02`) |
| Matter | Commissioning and basic control on SIM in CI and on the owner's unit where Matter is supported |
| All configuration visible | Settings enumerates every registry key and every DS (`T-UI-11` test); `no-magic-number` rule green |
| Decisions are switches | DS-01 to DS-36 each implemented in all of its modes, plus its combined mode where the catalog defines one (DS-25 is a pure choice without a combined mode; DS-30 is a build-time choice recorded in ADR-006), each with a test per mode and the measurements shown |
| Room perimeter mapping | The owner draws the room, marks the DJ and the middle, maps the ceiling strip with the wizard, sets the logical zero, and sees a continuous orbit, a two-way pulse from the DJ and a half-room alternating strobe on the real ceiling (`HW-ROOM-01`, `P-ROOM-01` to `P-ROOM-07`) |
| Document everything | Every doc in `T-DOC-01` written, linked to capability IDs, claim check green |

## 7. Probe family alias table (companion completion contract)

The owner also received a "Final Completion Contract" from another agent. Its
probe IDs use family prefixes. Every probe in that contract maps to at least
one probe or task here by family; if you have that contract, list each of its
probe IDs in `docs/finish/evidence/T-QA-11/contract-map.md` next to the
matching `P-*` probe or task, and add a probe here for any of its checks that
this plan lacks. The coverage tool does not read that contract, so this step
is manual and required.

| Contract family | Meaning | Where it lives in this plan |
| --- | --- | --- |
| `TRUTH` | Fakes removed, tests can fail, claims generated | `wp00` (`T-TRU-01` to `T-TRU-17`), briefing sections 2.1 and 5.1a |
| `RUN` | Show host, clock, estimator, seek, loops, scratch, overrides | `T-ARC-*`, `T-RUN-*`, `P-56` to `P-61`, `P-105`, `P-134`, `P-138`, `P-140` |
| `GOV` | Govee LAN, BLE, Matter, cloud, failover | `wp03`, `wp04`, `P-42` to `P-55`, `P-106`, `P-107`, `P-147`, `P-148` |
| `VEN` | Venue, room, seam, logical zero, anchors, zones, spatial effects | `wp05`, `P-ROOM-01` to `P-ROOM-08`, `P-38` to `P-41`, `P-77`, `P-79`, `P-92`, `P-98` |
| `RB` | Rekordbox library and live providers | `wp06`, `wp07`, `P-4.1` to `P-12`, `P-120`, `P-145`, `P-146` |
| `SER` | Serato | `wp09`, `P-3.1`, `P-121` |
| `FLX` | DDJ-FLX4 | `wp08`, `P-11` |
| `ANA` | Analysis worker, ML, DSP, events, readiness | `wp10`, `P-13` to `P-25`, `P-70`, `P-137`, `P-139` |
| `PLAN` | Planner | `wp11`, `P-2.1` to `P-2.6`, `P-26` to `P-37`, `P-113` to `P-115`, `P-129`, `P-135` |
| `MIX` | Two-deck mixer | `T-MIX-*`, `P-62` to `P-67` |
| `RENDER` | Layer stack, colour, latency, goldens | `T-REND-*`, `P-2.5`, `P-33`, `P-49`, `P-55`, `P-76`, `P-127` |
| `AUDIO` | Live audio capture, DSP, overlay | `T-AUD-*`, `P-68`, `P-69` |
| `UI` | Every screen, emergency controls, settings, accessibility | `wp13`, `P-88` to `P-102`, `P-143`, `P-144` |
| `DATA` | Storage, migrations, cache, recorder, security | `wp14` (`T-DATA-*`, `T-SEC-*`), `P-80` to `P-82`, `P-103`, `P-110`, `P-111` |
| `QA` | Test classes, replay, simulators, faults, performance, soak, sync matrix, camera, validation set | `wp15`, `P-104`, `P-116` to `P-128` |
| `PKG` | Packaging, clean install, updates, crash policy | `T-OPS-04` to `T-OPS-07`, `P-145`, `P-153-clean-install` |
| `DOC` | Documentation, ADRs, notices, AGENTS memory | `T-DOC-01` to `T-DOC-04`, `T-TRU-13`, `P-112` |

The contract's phases A to G correspond to this plan's milestones M0 to M6 in
order; where the two disagree on order, follow `README.md` (the vertical slice
comes before breadth).

## 8. Release checklist

- [ ] `STATUS.md`: every task `DONE-VERIFIED`, or `BLOCKED-HARDWARE` with a
      completed owner runbook, or `CLOSED-OWNER-DECLINED` with its decision
      record; zero `TODO`, zero `IN-PROGRESS`, zero `BLOCKED-OWNER-DECISION`.
- [ ] `node docs/finish/tools/check-coverage.mjs` green.
- [ ] `yarn verify:all` green on macOS, Windows and Linux CI.
- [ ] `yarn gates` all PASS.
- [ ] Capability manifest: every capability `PASS` or
      `UNAVAILABLE_ON_THIS_DEVICE` with reason; the README table regenerated.
- [ ] `THIRD_PARTY_NOTICES` generated; license audit green; nothing from
      rkbx_link, rkbx_os2l or LedFx in the tree or installer; no code,
      weights or data from the unlicensed Skip-BART or SeqLight repositories
      (spec 112).
- [ ] Owner decisions OD-01 to OD-12 on `STATUS.md` answered and recorded
      with their outcomes.
- [ ] Section 11 lists every accepted deviation, and the owner has signed it.
- [ ] Packaged installers built (signed if the owner provided credentials)
      and installed on clean machines.
- [ ] `AGENTS.md` repository memory updated with scars S1 to S28 and every
      new learning; canonical commands verified.
- [ ] Docs set complete and truthful (`T-DOC-01`), ADRs complete
      (`T-DOC-02`).
- [ ] Owner sign-off on the normal-night HW run and the spec 151 review.

## 9. If you stop before the end

Follow `00-agent-briefing.md` section 9. Never describe partial work as
finished. A status board with honest `BLOCKED-*` entries and runbooks is a
good outcome; a green-looking board without evidence is the failure this plan
exists to prevent.

## 10. Config keys added (added to `03` section 3.1)

`ops.startup.budgetMs` (10000, unmeasured target).

## 11. Deviations the owner accepted

A deviation exists only when the owner declined an owner decision
(`CLOSED-OWNER-DECLINED`) and a spec item therefore cannot be met. Each row
names the task, the decision, the spec items affected, and what the product
does instead. The agent never adds a row for work it could have built. Empty
until the owner declines something.

| Task | Decision | Spec items not met | What the product does instead | Owner signature and date |
| --- | --- | --- | --- | --- |

Examples of what would belong here, so the consequences are clear before the
owner answers: declining the SoundSwitch capture (OD-02) leaves spec 7's
first-priority Lighting provider and spec 8 and 9 unmet, and spec 120 is then
satisfied by the remaining providers only if every one of its 18 items passes
with them; declining rkbx_link and the memory reader (OD-03, OD-04) removes
the sample-accurate Rekordbox sources on macOS 7.2.10, so spec 120 items 4, 5
and 7 rest on ProLink, the composite provider and AX, and their measured
accuracy must still meet `qa.sync.maxBeatErrorMs`, or the item fails and is
listed here.

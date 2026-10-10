# Qualification

Gates A–H per SPEC §152. Soak 4 h (§125). Track-sync matrix (§119).
H6076/H1A45 DoD (§§122–124).

## SPEC §52: 16-step wizard

Runner: `packages/govee/src/qualification.ts` (`QUALIFICATION_STEPS`, one
resumable state machine; the record persists after each step in the
`device_calibrations` row keyed by hardware ID + SKU + firmware).
Step order, `spec` = step number inside SPEC §52:

| # | id | What the user does / what is measured |
|---|----|----------------------------------------|
| 1 | discover | Unit found on LAN (scan reply) |
| 2 | identify | Flash + user confirm |
| 3 | read-sku | SKU read-back |
| 4 | read-firmware | Firmware from scan reply fields |
| 5 | verify-power | Power read-back |
| 6 | verify-brightness | Global brightness read-back |
| 7 | verify-rgb | RGB read-back |
| 8 | verify-stream | Local RGBIC stream (capability probe) |
| 9 | segment-count | Logical count: stripe count + changepoint sweep (`SEGMENT_CANDIDATES`: 2–60, lan.md 2.3) |
| 10 | segment-order | Single moving zone |
| 11 | orientation | Reverse orientation |
| 12 | arm-settle | Sweep 0–200 ms; first delay that lands a paint |
| 13 | stable-rate | Descending rate sweep (`RATE_SWEEP_HZ`: 60→10 Hz); first stutter-free rate = `maxStableFps` |
| 14 | visual-latency | Camera or guided tap (T-QA-08 procedure) |
| 15 | reconnect | User power-cycles the unit; re-arm observed |
| 16 | save | Calibration saved (hardware ID + SKU + firmware) |

Firmware change marks REQUALIFICATION REQUIRED: normal control continues
on the last verified capability (SPEC §147); steps 8, 9, 12, 13 must pass
again before segmented streaming resumes.

## SPEC §53–54: per-unit records

Nothing is SKU-assumed (SPEC §42): segment count, order, arm settle, rate
ceiling, and latency are measured per unit. Profile defaults live in
`devices/H6076.yaml` / `devices/H1A45.yaml`; every value carries
`value` + `source` + `receipt`, and the loader
(`packages/govee/src/profiles.ts`) rejects a number without a receipt.
Sources in use: `product-material` (line claim, not a measurement),
`toolkit-default` (lan.md §1), `toolkit-measured-other-sku` (H61A0, not
our units), `unmeasured` (wizard replaces it).

## SPEC §§122–124: multi-device DoD

- §122: 2× H6076 simultaneously, phase-alignment measured.
- §124: 2+1+1 rig demo sequence — cross-device chase/wave, partial
  darkness, full blackout, white impact, two-deck palette transition —
  recorded.
- Disconnect/reconnect re-arm observed against hardware (step 15).

## Gate C status

Wizard, probes, fixtures (`protocol-fixtures/govee/razer/`), and profiles
are implemented and sim-proven. **No unit has been on hardware yet**
(2026-09-29 LAN scan found no Govee devices): the calibration tables are
empty and Gate C stays blocked until §52 runs against 2× H6076 + 1× H1A45
with results committed. Sim runs prove code, never hardware.

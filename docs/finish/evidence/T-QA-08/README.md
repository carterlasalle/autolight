# T-QA-08 Physical output qualification with a camera

Closes spec 118, 122, 123, 124; probes P-118-physical, P-122-h6076-dod, P-123-h1a45-dod, P-124-multi-dod, part of P-55.

## What changed

- `tools/camera/analyze.py` (new): sim-capable onset detector (`find_onsets`), per-flash visible latency (`latencies`), p95, and the spec 118 spread check (`spread_ok`: cross-fixture median spread within ~50 ms).
- `tools/camera/test_analyze.py` (new, 3 tests): synthetic 240 fps brightness series with planted flashes at known times plus noise; onsets match within one frame; latencies recover the planted 90 ms; spread passes for close fixtures and fails for a 160 ms outlier; empty series give no onsets.

## Proof

- `python3 -m pytest tools/camera/test_analyze.py -q`: 3 passed.
- Failing-capable: shift a planted flash by 50 ms and the onset test fails; widen one fixture latency to 250 ms and `spread_ok` returns False.

## Delete test

Delete the hysteresis (`threshold * 0.5` re-arm) and noisy plateaus double-count onsets. Delete `spread_ok` and the 50 ms bound is unenforced.

## Seams / runbooks

- OpenCV video reader plus owner-drawn regions plus the measurement flash sequence in the app arrive with `HW-CAM-01`: BLOCKED-HARDWARE. Reports per unit and per spec 122-124 demonstration with video timestamps are the owner run.
- DS-17 `measured` latency calibration consumes this tool's output; that wiring is the calibration task's step.

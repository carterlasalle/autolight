"""Sim-capable tests for the camera onset detector (T-QA-08)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from tools.camera.analyze import find_onsets, latencies, p95, spread_ok


def synth(fps=240.0, flashes=(1.0, 2.0, 3.0), latency=0.09, noise=0.02):
    import random

    rng = random.Random(7)
    n = int(4 * fps)
    series = [rng.uniform(0, noise) for _ in range(n)]
    for t in flashes:
        start = int((t + latency) * fps)
        for i in range(start, min(n, start + int(0.2 * fps))):
            series[i] = 0.9 + rng.uniform(-noise, noise)
    return series


def test_onsets_match_flashes():
    series = synth()
    seen = find_onsets(series, 240.0)
    assert len(seen) == 3
    for got, want in zip(seen, (1.09, 2.09, 3.09)):
        assert abs(got - want) < 1 / 240 + 0.005


def test_latency_and_spread():
    series = synth()
    seen = find_onsets(series, 240.0)
    lats = latencies([1.0, 2.0, 3.0], seen)
    assert all(abs(l - 0.09) < 0.01 for l in lats)
    assert p95(lats) < 0.12
    assert spread_ok([[0.09, 0.1, 0.095], [0.11, 0.105, 0.1]]) is True
    assert spread_ok([[0.09], [0.25]]) is False


def test_no_onset_without_flash():
    assert find_onsets([0.01] * 240, 240.0) == []
    assert latencies([1.0], []) == []

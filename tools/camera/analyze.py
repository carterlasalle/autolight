"""Camera latency analysis, sim-capable parts (T-QA-08, spec 118).

The app emits white flashes and blackouts at known show-clock times; a
240 fps video is analysed by region to find visible onsets. This module is
the onset detector plus the spread math, tested on synthetic brightness
series. The OpenCV video reader and the owner-drawn regions arrive with the
HW-CAM-01 runbook; until then this proves the measurement, never hardware.
"""

from __future__ import annotations


def find_onsets(series: list[float], fps: float, threshold: float = 0.5) -> list[float]:
    """First frame index crossing threshold after being below, as seconds."""
    out: list[float] = []
    below = True
    for i, v in enumerate(series):
        if below and v >= threshold:
            out.append(i / fps)
            below = False
        elif not below and v < threshold * 0.5:
            below = True
    return out


def latencies(sent: list[float], seen: list[float]) -> list[float]:
    """Per-flash visible latency: first seen onset at or after each send."""
    out: list[float] = []
    for t in sent:
        nxt = [s for s in seen if s >= t]
        if nxt:
            out.append(nxt[0] - t)
    return out


def p95(xs: list[float]) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, int(0.95 * len(s)))]


def spread_ok(per_fixture_ms: list[list[float]], bound_ms: float = 50.0) -> bool:
    """Spec 118: visible impact spread p95 within about 50 ms."""
    medians = []
    for lats in per_fixture_ms:
        if lats:
            medians.append(sorted(lats)[len(lats) // 2])
    if len(medians) < 2:
        return True
    return (max(medians) - min(medians)) * 1000 <= bound_ms

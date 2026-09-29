"""Deterministic DSP evidence channels (§18). Analysis describes; never directs (§2.3)."""
import math


def rms(frames: list[float]) -> float:
    if not frames:
        return 0.0
    return math.sqrt(sum(x * x for x in frames) / len(frames))


def energy_slope(energies: list[float]) -> float:
    """Least-squares slope; positive = building."""
    n = len(energies)
    if n < 2:
        return 0.0
    mean_x = (n - 1) / 2
    mean_y = sum(energies) / n
    num = sum((i - mean_x) * (y - mean_y) for i, y in enumerate(energies))
    den = sum((i - mean_x) ** 2 for i in range(n))
    return num / den if den else 0.0


def spectral_flux(prev: list[float], cur: list[float]) -> float:
    """Positive-only frame-to-frame magnitude change (onset proxy)."""
    return sum(max(0.0, c - p) for p, c in zip(prev, cur))


def silence_probability(frame_rms: float, threshold: float = 0.01) -> float:
    """1 when effectively silent, linear ramp below 2× threshold."""
    if frame_rms <= 0:
        return 1.0
    if frame_rms >= 2 * threshold:
        return 0.0
    return 1.0 - (frame_rms - threshold) / threshold


def beat_aggregate(frame_values: list[float], frames_per_beat: int) -> list[float]:
    """Mean-pool frame evidence to beat grid (§18 aggregation)."""
    if frames_per_beat <= 0:
        raise ValueError(f"frames_per_beat={frames_per_beat}")
    return [
        sum(frame_values[i : i + frames_per_beat]) / frames_per_beat
        for i in range(0, len(frame_values), frames_per_beat)
    ]

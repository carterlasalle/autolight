"""Deterministic DSP evidence channels (§18)."""
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

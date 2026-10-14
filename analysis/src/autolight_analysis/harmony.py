"""Chroma, key estimate and harmonic tension proxy (T-ANA-18, spec 23).

CQT-based chroma per frame; key by profile correlation (our own code, Krumhansl
profiles on 12-dim chroma); tension per beat as tonal distance from the
estimated key centre plus a dissonance measure, aggregated like other features
and fed to build detection.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

NOTE_NAMES = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")

# Krumhansl major/minor profiles (documented algorithm, own code).
KRUMHANSL_MAJOR = (
    6.35,
    2.23,
    3.48,
    2.33,
    4.38,
    4.09,
    2.52,
    5.19,
    2.39,
    3.66,
    2.29,
    2.88,
)
KRUMHANSL_MINOR = (
    6.33,
    2.68,
    3.52,
    5.38,
    2.60,
    3.53,
    2.54,
    4.75,
    3.98,
    2.69,
    3.34,
    3.17,
)


@dataclass(frozen=True)
class CqtBands:
    """Constant-Q band layout: lowest frequency, resolution and span."""

    fmin: float = 55.0
    bins_per_octave: int = 12
    octaves: int = 6


def cqt_chroma(
    mono: np.ndarray,
    *,
    rate: int = 44100,
    frame: int = 4096,
    hop: int = 2048,
    bands: CqtBands = CqtBands(),
) -> np.ndarray:
    """Constant-Q style chroma: sparse-kernel magnitude to pitch classes.

    Upgrade path if this dominates runtime: an FFT + parabolic-mapping chroma
    replacing the O(frames * bins) Goertzel-style kernel dot products.
    """
    if mono.size < frame:
        return np.zeros((1, 12), dtype=np.float64)
    n_frames = 1 + (mono.size - frame) // hop
    bin_count = bands.bins_per_octave * bands.octaves
    freqs = bands.fmin * 2.0 ** (np.arange(bin_count) / bands.bins_per_octave)
    t = np.arange(frame) / rate
    window = np.hanning(frame)
    # The cos/sin basis depends only on frequency and time: build it once
    # instead of evaluating two transcendentals per bin per frame.
    phases = 2.0 * math.pi * np.outer(freqs, t)
    basis_cos = np.cos(phases)
    basis_sin = np.sin(phases)
    classes = np.arange(len(freqs)) % 12
    chroma = np.zeros((n_frames, 12), dtype=np.float64)
    for n in range(n_frames):
        seg = mono[n * hop : n * hop + frame].astype(np.float64) * window
        mags = np.hypot(basis_cos @ seg, basis_sin @ seg)
        np.add.at(chroma[n], classes, mags)
    row_max = chroma.max(axis=1, keepdims=True)
    row_max[row_max <= 0] = 1.0
    return chroma / row_max


def estimate_key(chroma: np.ndarray) -> dict:
    """Profile correlation over 12 roots x major/minor. Returns key+confidence."""
    mean = chroma.mean(axis=0) if chroma.size else np.zeros(12)
    norm = float(np.linalg.norm(mean))
    if norm <= 0:
        return {"key": "C", "mode": "major", "confidence": 0.0}
    mean = mean / norm
    best: dict = {"key": "C", "mode": "major", "confidence": 0.0}
    for root in range(12):
        modes = (("major", KRUMHANSL_MAJOR), ("minor", KRUMHANSL_MINOR))
        for mode, profile in modes:
            shifted = [profile[(i - root) % 12] for i in range(12)]
            p = np.array(shifted, dtype=np.float64)
            p = p / float(np.linalg.norm(p))
            corr = float(np.dot(mean, p))
            if corr > best["confidence"]:
                best = {"key": NOTE_NAMES[root], "mode": mode, "confidence": corr}
    return best


def harmonic_tension(chroma: np.ndarray, key: dict) -> np.ndarray:
    """Per-frame tension: distance from key centre plus dissonance.

    Distance: 1 - cosine to the one-hot-ish key profile. Dissonance: energy on
    pitch classes a semitone/tritone away from the key root.
    """
    if chroma.shape[0] == 0:
        return np.zeros(0, dtype=np.float64)
    root = NOTE_NAMES.index(key.get("key", "C"))
    major = key.get("mode", "major") == "major"
    profile = KRUMHANSL_MAJOR if major else KRUMHANSL_MINOR
    centre = np.array([profile[(i - root) % 12] for i in range(12)], dtype=np.float64)
    centre = centre / float(np.linalg.norm(centre))
    norms = np.linalg.norm(chroma, axis=1, keepdims=True)
    norms[norms <= 0] = 1.0
    unit = chroma / norms
    distance = 1.0 - unit.dot(centre)
    # Root-relative dissonance: semitone, tritone and the raised fourth /
    # minor seventh above the KEY ROOT, not absolute C-based pitch classes.
    offsets = (1, 6, 8) if major else (1, 6, 10)
    dissonant = [(root + offset) % 12 for offset in offsets]
    diss = chroma[:, dissonant].sum(axis=1) / (chroma.sum(axis=1) + 1e-9)
    return (0.6 * distance + 0.4 * diss).astype(np.float64)

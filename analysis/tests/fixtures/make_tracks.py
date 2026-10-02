"""Planted-event track generator (T-ANA-10, T-ANA-16).

Envelope suites (and WAVs) with known ground truth: builds, drops, fake drops
at 1 to 4 beat offsets, breakdowns, re-entries, vocal entries and exits,
fills, silences and a final hit. WEAKEN=1 flattens every planted jump and
drops the ML/fill inputs so the T-ANA-16 gate goes red on purpose.
"""

from __future__ import annotations

import os

import numpy as np

WEAKEN = os.environ.get("WEAKEN") == "1"

N_BEATS = 128


def _lvl(x: float, base: float = 0.15) -> float:
    if not WEAKEN:
        return x
    return base + (x - base) * 0.08


def suite() -> tuple[dict, list[dict]]:
    """Envelope-level suite: (detector inputs, ground-truth events)."""
    n = N_BEATS
    beats = [float(i + 1) for i in range(n)]
    beat_in_bar = [(i % 4) + 1 for i in range(n)]
    kinds = (
        ["verse"] * 32
        + ["build"] * 16
        + ["chorus"] * 32
        + ["breakdown"] * 16
        + ["verse"] * 16
        + ["outro"] * 16
    )
    energy = [0.2] * 32 + [0.2 + 0.7 * i / 15 for i in range(16)]
    energy += [1.0] * 32 + [0.08] * 16 + [0.25] * 16 + [0.25] * 8 + [0.1] * 8
    bass = [0.15] * 48 + [1.0] * 32 + [0.1] * 16 + [0.2] * 32
    drum = [0.2] * 32 + [0.15 + 0.1 * i / 15 for i in range(16)]
    drum += [1.0] * 32 + [0.12] * 16 + [0.22] * 32
    vocal = [0.02] * 96 + [0.8] * 16 + [0.02] * 16
    novelty = [0.05] * n
    novelty[48] = 2.5
    novelty[50] = 3.0
    novelty[64] = 2.0
    onset = [0.1] * n
    onset[48] = 2.0
    onset[88] = 1.5
    silence = [0.0] * n
    for i in range(100, 102):
        silence[i] = 0.95
    for i in range(120, 124):
        silence[i] = 0.95
    silence[64] = 0.9
    # Fake-drop sculpt: dip the plateau for a bar, slam back on beat 65.
    for arr, dip in ((energy, 0.2), (bass, 0.15), (drum, 0.15)):
        arr[60], arr[61], arr[62], arr[63], arr[64] = dip, dip, dip, dip, dip
    if WEAKEN:
        energy = [_lvl(v) for v in energy]
        bass = [_lvl(v) for v in bass]
        drum = [_lvl(v) for v in drum]
        vocal = [0.05 if v > 0.4 else v for v in vocal]
        novelty = [_lvl(v, 0.05) for v in novelty]
        onset = [_lvl(v, 0.1) for v in onset]
        silence = [v * 0.1 for v in silence]
    truth = [
        {"type": "build-start", "beat": 33},
        {"type": "major-section-transition", "beat": 33},
        {"type": "predrop", "beat": 45},
        {"type": "major-section-transition", "beat": 49},
        {"type": "drop", "beat": 49},
        {"type": "drop-continuation", "beat": 49},
        {"type": "bass-re-entry", "beat": 49},
        {"type": "drum-re-entry", "beat": 49},
        {"type": "large-transient", "beat": 49},
        {"type": "fake-drop", "beat": 65},
        {"type": "drop", "beat": 66},
        {"type": "drop-continuation", "beat": 66},
        {"type": "major-section-transition", "beat": 81},
        {"type": "breakdown", "beat": 81},
        {"type": "fill", "beat": 89},
        {"type": "minor-phrase-transition", "beat": 97},
        {"type": "bass-re-entry", "beat": 97},
        {"type": "drum-re-entry", "beat": 97},
        {"type": "vocal-entry", "beat": 97},
        {"type": "drop", "beat": 97},
        {"type": "pause", "beat": 101},
        {"type": "minor-phrase-transition", "beat": 113},
        {"type": "vocal-exit", "beat": 113},
        {"type": "silence", "beat": 121},
        {"type": "outro-release", "beat": 125},
        {"type": "final-hit", "beat": 128},
    ]
    data = {
        "beats": beats,
        "beat_in_bar": beat_in_bar,
        "kinds": kinds,
        "energy": energy,
        "bass": bass,
        "drum": drum,
        "vocal": vocal,
        "novelty": novelty,
        "onset": onset,
        "silence": silence,
        "ml_boundaries": set() if WEAKEN else {65},
        "fills": [] if WEAKEN else [88],
    }
    return data, truth


def render_wav(path: str, bpm: float = 120.0, sr: int = 44100) -> list[dict]:
    """Render the suite as audio (clicks plus bass plus noise swells)."""
    data, truth = suite()
    beat_s = 60.0 / bpm
    total = int(N_BEATS * beat_s * sr)
    out = np.zeros(total, dtype=np.float64)
    t = np.arange(int(beat_s * sr)) / sr
    for i in range(N_BEATS):
        start = int(i * beat_s * sr)
        seg = out[start : start + len(t)]
        if len(seg) == 0:
            continue
        e = data["energy"][i]
        click = np.sin(2 * np.pi * 1000 * t[: len(seg)]) * e * 0.4
        seg += click[: len(seg)]
        if data["bass"][i] > 0.5:
            seg += np.sin(2 * np.pi * 55 * t[: len(seg)]) * 0.5
        if data["vocal"][i] > 0.4:
            seg += (
                np.sin(2 * np.pi * 440 * t[: len(seg)])
                + 0.5 * np.sin(2 * np.pi * 880 * t[: len(seg)])
            ) * 0.2
    peak = np.abs(out).max() or 1.0
    stereo = np.stack([out / peak * 0.8, out / peak * 0.8], axis=1)
    _write_wav(path, stereo.astype(np.float32), sr)
    return truth


def _write_wav(path: str, stereo: np.ndarray, sr: int) -> None:
    import struct

    blob = stereo.astype(np.float32).tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + len(blob)))
        f.write(b"WAVEfmt ")
        f.write(struct.pack("<IHHIIHH", 16, 3, 2, sr, sr * 8, 8, 32))
        f.write(b"data")
        f.write(struct.pack("<I", len(blob)))
        f.write(blob)

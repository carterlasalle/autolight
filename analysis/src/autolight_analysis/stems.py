"""Stem-band DSP evidence from canonical PCM (§18): bass/drum proxies, vocal-band
energy, novelty, and beat-aggregated envelopes. Pure numpy/std DSP — no ML
weights, no torch. Feeds build/drop detectors; never drives the show (§2.3).
"""
from __future__ import annotations

import numpy as np

CANONICAL_RATE = 44100


def load_mono_pcm(path: str, seconds: float | None = None) -> tuple[np.ndarray, int]:
    """Decode via FFmpeg to canonical mono float32. Raises on failure."""
    import subprocess

    args = ["ffmpeg", "-v", "error", "-i", path, "-ar", str(CANONICAL_RATE),
            "-ac", "1", "-f", "f32le", "-"]
    if seconds is not None:
        args[3:3] = ["-t", str(seconds)]
    proc = subprocess.run(args, check=True, capture_output=True)
    return np.frombuffer(proc.stdout, dtype=np.float32).copy(), CANONICAL_RATE


def _windowed_frames(mono: np.ndarray, frame: int, hop: int) -> np.ndarray:
    """Hann-windowed frames via stride trick (rectangular windows leak)."""
    n_frames = 1 + (mono.size - frame) // hop
    shape = (n_frames, frame)
    strides = (mono.strides[0] * hop, mono.strides[0])
    windowed = np.lib.stride_tricks.as_strided(mono, shape=shape, strides=strides)
    return windowed * np.hanning(frame).astype(mono.dtype)


def band_envelope(
    mono: np.ndarray,
    rate: int = CANONICAL_RATE,
    low_hz: float = 20.0,
    high_hz: float = 20000.0,
    frame: int = 2048,
    hop: int = 1024,
) -> np.ndarray:
    """Mean |rFFT| magnitude in [low_hz, high_hz) per hop, via stride trick."""
    if mono.size < frame:
        return np.zeros(1, dtype=np.float64)
    windowed = _windowed_frames(mono, frame, hop)
    spec = np.abs(np.fft.rfft(windowed, axis=1))
    freqs = np.fft.rfftfreq(frame, 1.0 / rate)
    mask = (freqs >= low_hz) & (freqs < high_hz)
    return spec[:, mask].mean(axis=1).astype(np.float64)


def stem_proxies(mono: np.ndarray, rate: int = CANONICAL_RATE) -> dict[str, np.ndarray]:
    """Bass/drum/vocal/other band envelopes (§18 stem RMS channels)."""
    return {
        "bass": band_envelope(mono, rate, 20, 150),
        "low_mid": band_envelope(mono, rate, 150, 500),
        "mid": band_envelope(mono, rate, 500, 2000),
        "high": band_envelope(mono, rate, 2000, 20000),
        "vocal": band_envelope(mono, rate, 300, 3400),
    }


def spectral_novelty(mono: np.ndarray, hop: int = 1024, frame: int = 2048) -> np.ndarray:
    """Log-magnitude positive spectral change, normalized 0..1.

    Log domain keeps steady tones quiet: only genuine onsets move.
    """
    if mono.size < frame * 2:
        return np.zeros(1, dtype=np.float64)
    windowed = _windowed_frames(mono, frame, hop)
    spec = np.log1p(np.abs(np.fft.rfft(windowed, axis=1)) * 10.0)
    diff = np.maximum(0.0, np.diff(spec, axis=0)).sum(axis=1)
    peak = diff.max()
    return (diff / peak).astype(np.float64) if peak > 0 else np.zeros_like(diff)


def resample_to_beats(envelope: np.ndarray, n_beats: int) -> list[float]:
    """Linear-resample a frame envelope onto the native beat grid."""
    if n_beats <= 0:
        raise ValueError(f"n_beats={n_beats}")
    if envelope.size == 0:
        return [0.0] * n_beats
    idx = np.linspace(0, envelope.size - 1, n_beats)
    lo = np.floor(idx).astype(int)
    frac = idx - lo
    hi = np.minimum(lo + 1, envelope.size - 1)
    return (envelope[lo] * (1 - frac) + envelope[hi] * frac).tolist()

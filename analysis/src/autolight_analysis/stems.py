"""Stem-band DSP evidence from canonical PCM (T-ANA-06 DS-10, spec 18).

``band-proxies``: the FFT band approach, labelled ``dsp.stemProxies``
everywhere. ``allinone-stems``: real source separation via All-In-One,
stored as stem envelopes and features. ``fusion`` (default): real stems
when available, proxies otherwise; features record which source they came
from. Pure numpy/std DSP unless All-In-One is available; no torch here.
Feeds build/drop detectors; never drives the show (spec 2.3).
"""

from __future__ import annotations

from typing import NamedTuple

import numpy as np

CANONICAL_RATE = 44100

# The frame/hop pair travels together through every windowed helper; bundling
# it keeps each call site to one argument and one default.
_DEFAULT_FRAME = 2048
_DEFAULT_HOP = 1024

# Two frames is the minimum np.diff can work with.
_MIN_NOVELTY_FRAMES = 2


class FrameWindow(NamedTuple):
    """Analysis window: frame length and hop size in samples."""

    frame: int = _DEFAULT_FRAME
    hop: int = _DEFAULT_HOP


DEFAULT_WINDOW = FrameWindow()


def load_mono_pcm(path: str, seconds: float | None = None) -> tuple[np.ndarray, int]:
    """Decode via FFmpeg to canonical mono float32. Raises on failure."""
    import shutil
    import subprocess

    exe = shutil.which("ffmpeg") or "ffmpeg"
    args = [
        exe,
        "-v",
        "error",
        "-i",
        path,
        "-ar",
        str(CANONICAL_RATE),
        "-ac",
        "1",
        "-f",
        "f32le",
        "-",
    ]
    if seconds is not None:
        args[3:3] = ["-t", str(seconds)]
    proc = subprocess.run(  # noqa: S603 - local ffmpeg binary from PATH lookup, fixed flags
        args, check=True, capture_output=True
    )
    return np.frombuffer(proc.stdout, dtype=np.float32).copy(), CANONICAL_RATE


def _windowed_frames(
    mono: np.ndarray, window: FrameWindow = DEFAULT_WINDOW
) -> np.ndarray:
    """Hann-windowed frames via stride trick (rectangular windows leak).

    Short input is zero-padded to one frame: current callers pre-guard, and
    the pad keeps the helper total for any future caller.
    """
    frame = window.frame
    hop = window.hop

    if mono.size < frame:
        mono = np.pad(mono, (0, frame - mono.size))
    n_frames = 1 + (mono.size - frame) // hop
    shape = (n_frames, frame)
    strides = (mono.strides[0] * hop, mono.strides[0])
    windowed = np.lib.stride_tricks.as_strided(mono, shape=shape, strides=strides)
    return windowed * np.hanning(frame).astype(mono.dtype)


def band_envelope(
    mono: np.ndarray,
    *,
    rate: int = CANONICAL_RATE,
    low_hz: float = 20.0,
    high_hz: float = 20000.0,
    window: FrameWindow = DEFAULT_WINDOW,
) -> np.ndarray:
    """Mean |rFFT| magnitude in [low_hz, high_hz) per hop, via stride trick."""
    if mono.size < window.frame:
        return np.zeros(1, dtype=np.float64)
    windowed = _windowed_frames(mono, window)
    spec = np.abs(np.fft.rfft(windowed, axis=1))
    freqs = np.fft.rfftfreq(window.frame, 1.0 / rate)
    mask = (freqs >= low_hz) & (freqs < high_hz)

    # No bins in band (low >= high, or the band sits above Nyquist for a
    # custom rate) means no energy to report, not a NaN from an empty mean.
    if not mask.any():
        return np.zeros(spec.shape[0], dtype=np.float64)

    return spec[:, mask].mean(axis=1).astype(np.float64)


def stem_proxies(
    mono: np.ndarray,
    rate: int = CANONICAL_RATE,
    *,
    window: FrameWindow = DEFAULT_WINDOW,
) -> dict[str, np.ndarray]:
    """FFT band proxies, labelled ``dsp.stemProxies`` (T-ANA-06, DS-10)."""

    def band(low: float, high: float) -> np.ndarray:
        return band_envelope(
            mono, rate=rate, low_hz=low, high_hz=high, window=window
        )

    return {
        "bass": band(20, 150),
        "drum": band(150, 500) + band(2000, 20000),
        "vocal": band(300, 3400),
        "other": band(500, 2000),
        "low_mid": band(150, 500),
        "mid": band(500, 2000),
        "high": band(2000, 20000),
    }


def spectral_novelty(
    mono: np.ndarray, *, window: FrameWindow = DEFAULT_WINDOW
) -> np.ndarray:
    """Log-magnitude positive spectral change, normalized 0..1.

    Log domain keeps steady tones quiet: only genuine onsets move.
    """
    if mono.size < window.frame:
        return np.zeros(1, dtype=np.float64)
    windowed = _windowed_frames(mono, window)

    # hop > frame can leave a single frame even at 2x frame length; diff needs
    # two, so the guard checks the real frame count, not the sample count.
    if windowed.shape[0] < _MIN_NOVELTY_FRAMES:
        return np.zeros(1, dtype=np.float64)
    spec = np.log1p(np.abs(np.fft.rfft(windowed, axis=1)) * 10.0)
    diff = np.maximum(0.0, np.diff(spec, axis=0)).sum(axis=1)
    peak = diff.max()
    return (diff / peak).astype(np.float64) if peak > 0 else np.zeros_like(diff)


def resample_to_beats(
    envelope: np.ndarray,
    beat_times: list[float] | int,
    rate: int = CANONICAL_RATE,
    hop: int = 1024,
    n_beats: int = 0,
) -> list[float]:
    """Map a frame envelope onto beat windows from real beat timestamps.

    F-ANA-09: each beat window runs from its time to the next beat time and
    divides by its true frame count. The legacy ``(envelope, n)`` call shape
    (even split) is kept for envelope-only callers and tests.
    """
    if isinstance(beat_times, int):
        return _even_split(envelope, beat_times)
    if not beat_times:
        if isinstance(n_beats, int) and n_beats > 0:
            return _even_split(envelope, n_beats)
        raise ValueError("resample_to_beats needs beat_times or n_beats")
    frame_times = np.arange(envelope.size) * hop / rate
    out = []
    for i, start in enumerate(beat_times):
        end = (
            beat_times[i + 1]
            if i + 1 < len(beat_times)
            else start + (beat_times[1] - beat_times[0] if len(beat_times) > 1 else 0.5)
        )
        mask = (frame_times >= start) & (frame_times < end)
        out.append(float(envelope[mask].mean()) if mask.any() else 0.0)
    return out


def _even_split(envelope: np.ndarray, n_beats: int) -> list[float]:
    if n_beats <= 0:
        raise ValueError(f"n_beats={n_beats}")
    if envelope.size == 0:
        return [0.0] * n_beats
    idx = np.linspace(0, envelope.size - 1, n_beats)
    lo = np.floor(idx).astype(int)
    frac = idx - lo
    hi = np.minimum(lo + 1, envelope.size - 1)
    return (envelope[lo] * (1 - frac) + envelope[hi] * frac).tolist()


def select_stems(
    mono: np.ndarray,
    rate: int = CANONICAL_RATE,
    mode: str = "fusion",
    allinone_stems: dict[str, np.ndarray] | None = None,
) -> tuple[dict[str, np.ndarray], str]:
    """DS-10 stem source selection (T-ANA-06).

    ``allinone-stems``: real separation; ``band-proxies``: FFT bands;
    ``fusion`` (default): real stems when available, proxies otherwise.
    Returns (envelopes, source_label) where the label is ``ml.stems`` or
    ``dsp.stemProxies`` and is recorded in features.
    """
    if mode not in ("fusion", "allinone-stems", "band-proxies"):
        raise ValueError(f"stems mode={mode!r}")
    if mode == "band-proxies":
        return stem_proxies(mono, rate), "dsp.stemProxies"
    if allinone_stems:
        return allinone_stems, "ml.stems"
    if mode == "allinone-stems":
        raise ValueError("allinone-stems requested but no separation available")
    return stem_proxies(mono, rate), "dsp.stemProxies"

"""Deterministic DSP evidence channels (T-ANA-09, spec 18).

All 22 spec 18 features as frame series at ``analysis.frame.hop`` /
``analysis.frame.size``, aggregated to sub-beat (``analysis.aggregate.
subdivisions``, default 4), beat, bar and phrase using the actual beat
timestamps: each beat window runs from its time to the next beat time, with
partial edge windows divided by their true length (F-ANA-19).
"""

from __future__ import annotations

import math

import numpy as np

FEATURE_NAMES_22 = (
    "loudness_proxy",
    "rms",
    "bass",
    "low_mid",
    "mid",
    "high",
    "centroid",
    "rolloff",
    "flux",
    "onset_strength",
    "onset_density",
    "zcr",
    "kick",
    "snare",
    "stem_bass",
    "stem_drum",
    "stem_vocal",
    "stem_other",
    "silence",
    "novelty",
    "dynamic_range",
    "energy_derivative",
)


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
    """Clamped to [0, 1] (F-ANA-19: 0.005 with threshold 0.01 returned 1.5)."""
    if frame_rms <= 0:
        return 1.0
    if frame_rms >= 2 * threshold:
        return 0.0
    value = 1.0 - (frame_rms - threshold) / threshold
    return min(1.0, max(0.0, value))


def beat_aggregate(frame_values: list[float], frames_per_beat: int) -> list[float]:
    """Mean-pool frame evidence to beat grid, partial groups by real size.

    F-ANA-19: a trailing partial group divides by its own length, not the
    full group size.
    """
    if frames_per_beat <= 0:
        raise ValueError(f"frames_per_beat={frames_per_beat}")
    out = []
    for i in range(0, len(frame_values), frames_per_beat):
        group = frame_values[i:i + frames_per_beat]
        out.append(sum(group) / len(group))
    return out


def frame_series(mono: np.ndarray, rate: int = 44100, frame: int = 2048,
                 hop: int = 512,
                 stem_envelopes: dict[str, np.ndarray] | None = None
                 ) -> dict[str, np.ndarray]:
    """All 22 spec 18 features as frame series (T-ANA-09)."""
    from autolight_analysis.stems import spectral_novelty, stem_proxies

    if mono.size < frame:
        mono = np.pad(mono.astype(np.float64),
                      (0, frame - mono.size)).astype(np.float32)
    n_frames = 1 + (mono.size - frame) // hop
    idx = (np.arange(n_frames) * hop)[:, None] + np.arange(frame)[None, :]
    windowed = mono[idx].astype(np.float64) * np.hanning(frame)
    mag = np.abs(np.fft.rfft(windowed, axis=1))
    freqs = np.fft.rfftfreq(frame, 1.0 / rate)
    nyquist = rate / 2.0

    # K-weighted loudness proxy (EBU R128 style, documented proxy): high-shelf
    # emphasis plus mean-square, in dB-ish log domain clipped at floor.
    shelved = mag * (1.0 + (freqs / 4000.0) ** 2) ** 0.5
    loud = 10.0 * np.log10((shelved ** 2).mean(axis=1) + 1e-12)
    loud_proxy = np.clip((loud + 70.0) / 70.0, 0.0, 1.0)

    short_rms = np.sqrt((windowed ** 2).mean(axis=1))
    bass = mag[:, (freqs >= 20) & (freqs < 150)].mean(axis=1)
    low_mid = mag[:, (freqs >= 150) & (freqs < 500)].mean(axis=1)
    mid = mag[:, (freqs >= 500) & (freqs < 2000)].mean(axis=1)
    high = mag[:, (freqs >= 2000)].mean(axis=1)
    wsum = mag.sum(axis=1) + 1e-12
    centroid = (mag * freqs).sum(axis=1) / wsum
    cumsum = np.cumsum(mag, axis=1)
    roll_idx = np.argmax(cumsum >= 0.85 * wsum[:, None], axis=1)
    rolloff = freqs[np.clip(roll_idx, 0, len(freqs) - 1)] / nyquist
    flux = np.zeros(n_frames)
    flux[1:] = np.maximum(0.0, np.diff(mag, axis=0)).sum(axis=1)
    peak = flux.max()
    flux = flux / peak if peak > 0 else flux
    onset_strength = flux.copy()
    onset_density = np.convolve((flux > 0.25).astype(float),
                                np.ones(8) / 8.0, mode="same")
    signs = np.sign(windowed)
    zcr = (np.abs(np.diff(signs, axis=1)) > 0).sum(axis=1) / (2.0 * frame)
    kick = mag[:, (freqs >= 40) & (freqs < 120)].mean(axis=1) * (1.0 + flux)
    snare = mag[:, (freqs >= 1500) & (freqs < 3000)].mean(axis=1) * (1.0 + flux)

    stems = stem_envelopes
    if stems is None:
        try:
            stems = stem_proxies(mono.astype(np.float32), rate,
                                 frame=frame, hop=hop)
        except (ValueError, RuntimeError):
            stems = {}
    stem_bass = _align(np.asarray(stems.get("bass", np.zeros(1))), n_frames)
    stem_drum = _align(np.asarray(stems.get("drum", stems.get("low_mid",
                 np.zeros(1)) if stems else np.zeros(1))), n_frames)
    stem_vocal = _align(np.asarray(stems.get("vocal", np.zeros(1))), n_frames)
    stem_other = _align(np.asarray(stems.get("other", stems.get("mid",
                  np.zeros(1)) if stems else np.zeros(1))), n_frames)

    silence = np.array([silence_probability(float(v), 0.01) for v in short_rms])
    novelty = _align(np.atleast_1d(spectral_novelty(mono.astype(np.float32))),
                     n_frames)
    env = short_rms + 1e-12
    dyn = np.convolve(20.0 * np.log10(env / env.max()),
                      np.ones(43) / 43.0, mode="same")
    dynamic_range = np.clip((dyn.max() - dyn) / 60.0, 0.0, 1.0) * 0.0 + np.clip(
        (np.convolve(np.abs(np.diff(env, prepend=env[:1])),
                     np.ones(43) / 43.0, mode="same")) / (env.max() + 1e-12),
        0.0, 1.0)
    energy_derivative = np.diff(short_rms, prepend=short_rms[:1])
    scale = np.abs(energy_derivative).max()
    energy_derivative = energy_derivative / scale if scale > 0 else energy_derivative

    return {
        "loudness_proxy": loud_proxy.astype(float),
        "rms": short_rms.astype(float),
        "bass": bass.astype(float),
        "low_mid": low_mid.astype(float),
        "mid": mid.astype(float),
        "high": high.astype(float),
        "centroid": (centroid / nyquist).astype(float),
        "rolloff": rolloff.astype(float),
        "flux": flux.astype(float),
        "onset_strength": onset_strength.astype(float),
        "onset_density": onset_density.astype(float),
        "zcr": zcr.astype(float),
        "kick": _norm(kick),
        "snare": _norm(snare),
        "stem_bass": _norm(stem_bass),
        "stem_drum": _norm(stem_drum),
        "stem_vocal": _norm(stem_vocal),
        "stem_other": _norm(stem_other),
        "silence": silence.astype(float),
        "novelty": _norm(novelty),
        "dynamic_range": dynamic_range.astype(float),
        "energy_derivative": energy_derivative.astype(float),
    }


def aggregate_to_beats(frames: dict[str, np.ndarray],
                       beat_times: list[float], rate: int = 44100,
                       hop: int = 512, subdivisions: int = 4) -> dict:
    """Aggregate frame series onto beat windows from real beat timestamps.

    Each beat window runs from its time to the next beat time; sub-beat splits
    divide evenly. Partial edge windows divide by their true frame count.
    """
    n_frames = len(next(iter(frames.values()))) if frames else 0
    frame_times = np.arange(n_frames) * hop / rate
    n_beats = len(beat_times)
    beat_means: dict[str, list[float]] = {k: [] for k in frames}
    subbeat: dict[str, list[float]] = {k: [] for k in frames}
    spans = ([beat_times[1] - beat_times[0]] if n_beats > 1 else [0.5])
    spans += [beat_times[i + 1] - beat_times[i]
              for i in range(1, max(1, n_beats - 1))]
    if n_beats > 1:
        spans.append(spans[-1])
    for i in range(n_beats):
        start = beat_times[i]
        end = beat_times[i + 1] if i + 1 < n_beats else start + spans[-1]
        mask = (frame_times >= start) & (frame_times < end)
        if not mask.any():
            nearest = int(np.argmin(np.abs(frame_times - start)))
            mask = np.zeros(n_frames, dtype=bool)
            mask[min(nearest, n_frames - 1)] = True
        for k, series in frames.items():
            beat_means[k].append(float(series[mask].mean()))
            edges = np.linspace(start, end, subdivisions + 1)
            for s in range(subdivisions):
                sm = (frame_times >= edges[s]) & (frame_times < edges[s + 1])
                subbeat[k].append(float(series[sm].mean()) if sm.any()
                                  else beat_means[k][-1])
    bars: dict[str, list[float]] = {k: [] for k in frames}
    for b in range(0, n_beats, 4):
        for k in frames:
            bars[k].append(float(np.mean(beat_means[k][b:b + 4])))
    return {"beat": beat_means, "subbeat": subbeat, "bar": bars}


def _align(series: np.ndarray, n: int) -> np.ndarray:
    series = np.atleast_1d(np.asarray(series, dtype=float))
    if series.size == n:
        return series
    if series.size == 0:
        return np.zeros(n)
    idx = np.linspace(0, series.size - 1, n)
    lo = np.floor(idx).astype(int)
    frac = idx - lo
    hi = np.minimum(lo + 1, series.size - 1)
    return series[lo] * (1 - frac) + series[hi] * frac


def _norm(series: np.ndarray) -> np.ndarray:
    peak = float(np.abs(series).max()) if series.size else 0.0
    return (series / peak).astype(float) if peak > 0 else np.zeros_like(series, dtype=float)

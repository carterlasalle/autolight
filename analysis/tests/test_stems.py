import numpy as np
import pytest

from autolight_analysis.stems import (
    band_envelope,
    resample_to_beats,
    spectral_novelty,
    stem_proxies,
)


def test_band_envelope_separates_tones():
    rate = 44100
    t = np.arange(rate * 2) / rate
    bass_tone = np.sin(2 * np.pi * 60 * t).astype(np.float32)
    bass = band_envelope(bass_tone, rate=rate, low_hz=20, high_hz=150)
    airy = band_envelope(bass_tone, rate=rate, low_hz=8000, high_hz=20000)
    assert bass.mean() > airy.mean() * 10


def test_band_envelope_returns_zeros_for_empty_band():
    # low >= high (or a band above Nyquist) has no bins: zeros, not NaN.
    mono = np.ones(44100, dtype=np.float32)
    empty = band_envelope(mono, rate=44100, low_hz=150, high_hz=20)
    assert not np.isnan(empty).any()
    assert (empty == 0).all()


def test_windowed_frames_pads_short_input():
    # The helper stays total for short input even though current callers
    # pre-guard: one padded frame, no crashed stride trick.
    from autolight_analysis.stems import _windowed_frames

    padded = _windowed_frames(np.ones(100, dtype=np.float32))
    assert padded.shape == (1, 2048)


def test_novelty_handles_sparse_frame_counts():
    # hop > frame with only just over one frame of samples: the frame-count
    # guard returns zeros instead of crashing on an empty diff.
    from autolight_analysis.stems import FrameWindow

    mono = np.ones(4096, dtype=np.float32)
    out = spectral_novelty(mono, window=FrameWindow(frame=2048, hop=4096))
    assert out.tolist() == [0.0]


def test_stem_proxies_cover_bands():
    rate = 44100
    noise = np.random.default_rng(0).standard_normal(rate).astype(np.float32)
    stems = stem_proxies(noise, rate)
    assert {"bass", "drum", "vocal", "other"} <= set(stems)
    assert all(v.size > 0 for v in stems.values())


def test_select_stems_labels_source():
    from autolight_analysis.stems import select_stems

    rate = 44100
    noise = np.random.default_rng(1).standard_normal(rate).astype(np.float32)
    _, source = select_stems(noise, rate, "fusion")
    assert source == "dsp.stemProxies"
    fake = {
        "bass": np.ones(8),
        "drum": np.ones(8),
        "vocal": np.ones(8),
        "other": np.ones(8),
    }
    _, source = select_stems(noise, rate, "fusion", fake)
    assert source == "ml.stems"


def test_novelty_quiet_mean_for_steady_tone():
    rate = 44100
    n = rate * 2
    quiet = (0.05 * np.sin(2 * np.pi * 440 * np.arange(n) / rate)).astype(np.float32)
    struck = quiet.copy()
    struck[n // 2 : n // 2 + 2048] += np.hanning(2048).astype(np.float32)  # one onset
    # Onset concentrates change at one frame; steady hiss spreads it everywhere.
    assert spectral_novelty(struck).mean() < spectral_novelty(quiet).mean()


def test_resample_to_beats_linear():
    env = np.array([0.0, 10.0])
    assert resample_to_beats(env, 3) == pytest.approx([0.0, 5.0, 10.0])
    with pytest.raises(ValueError):
        resample_to_beats(env, 0)

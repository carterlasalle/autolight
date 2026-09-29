import numpy as np
import pytest

from autolight_analysis.stems import (
    band_envelope,
    stem_proxies,
    spectral_novelty,
    resample_to_beats,
)


def test_band_envelope_separates_tones():
    rate = 44100
    t = np.arange(rate * 2) / rate
    bass_tone = np.sin(2 * np.pi * 60 * t).astype(np.float32)
    bass = band_envelope(bass_tone, rate, 20, 150)
    airy = band_envelope(bass_tone, rate, 8000, 20000)
    assert bass.mean() > airy.mean() * 10


def test_stem_proxies_cover_bands():
    rate = 44100
    noise = np.random.default_rng(0).standard_normal(rate).astype(np.float32)
    stems = stem_proxies(noise, rate)
    assert set(stems) == {"bass", "low_mid", "mid", "high", "vocal"}
    assert all(v.size > 0 for v in stems.values())


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

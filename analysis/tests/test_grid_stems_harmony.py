"""Grid comparison, stems separation, harmonic key/tension (T-ANA-06..08, 18)."""

import numpy as np

from autolight_analysis.metrical import compare_grids, metrical_vote


def _grid(n=128, step=0.5, shift_from=None, shift=0.25):
    native = [i * step for i in range(n)]
    ml = [
        (t + shift if shift_from is not None and i >= shift_from else t)
        for i, t in enumerate(native)
    ]
    return native, ml


def test_aligned_grid_raises_nothing():
    native, ml = _grid()
    got = compare_grids(native, ml)
    assert got["warn"] is False
    assert got["segments"] == []


def test_shift_after_bar_64_warns_with_segments():
    native, ml = _grid(shift_from=64, shift=0.25)
    got = compare_grids(native, ml)
    assert got["warn"] is True
    assert got["medianOffsetMs"] > 50
    assert got["segments"], "must name the shifted segment"
    seg = got["segments"][0]
    assert seg["startAnchor"] >= 60


def test_typed_warnings_round_trip_through_vote():
    native, ml = _grid(shift_from=64, shift=0.25)
    vote = metrical_vote(native, {"beats": ml}, {"beats": list(native)})
    assert vote["warnings"], "shifted beat-this source must warn"
    w = vote["warnings"][0]
    assert w["evidence"] and w["beatRange"] == [1, len(native)]
    assert vote["downbeatConfidence"] < 1.0


def test_stems_separate_better_than_proxies():
    from autolight_analysis.stems import band_envelope, select_stems

    sr = 44100
    t = np.arange(sr * 2) / sr
    # A bass line (amplitude-gated 55 Hz) under a kick: both sources pulse on
    # the same grid, so same-domain envelopes correlate when separation works.
    env = 0.3 + 0.7 * ((t % 0.5) < 0.25)
    bass_src = (0.6 * np.sin(2 * np.pi * 55 * t) * env).astype(np.float32)
    kick = ((t % 0.5) < 0.05).astype(np.float32)
    mix = (bass_src + kick * 0.5).astype(np.float32)
    proxies, source = select_stems(mix, sr, "fusion")
    assert source == "dsp.stemProxies"
    known_bass = band_envelope(bass_src, sr, 20, 150)
    known_kick = band_envelope(kick, sr, 150, 500) + band_envelope(
        kick, sr, 2000, 20000
    )
    bass_corr = float(np.corrcoef(proxies["bass"], known_bass)[0, 1])
    drum_corr = float(np.corrcoef(proxies["drum"], known_kick)[0, 1])
    assert bass_corr > 0.5, bass_corr
    assert drum_corr > 0.5, drum_corr
    real = {
        "bass": known_bass,
        "drum": known_kick,
        "vocal": np.zeros_like(known_bass),
        "other": np.zeros_like(known_bass),
    }
    got, label = select_stems(mix, sr, "fusion", real)
    assert label == "ml.stems"
    assert got is real


def test_harmonic_tension_rises_on_dominant():
    from autolight_analysis.harmony import cqt_chroma, estimate_key, harmonic_tension

    sr = 44100
    dur = 1.0
    t = np.arange(int(sr * dur)) / sr

    def chord(freqs):
        parts = [np.sin(2 * np.pi * f * t) for f in freqs]
        return np.sum(parts, axis=0).astype(np.float32) / len(freqs)

    c = chord([261.63, 329.63, 392.00])
    g = chord([196.00, 246.94, 293.66, 349.23])
    seq = np.concatenate([c, g, c])
    chroma = cqt_chroma(seq, sr)
    key = estimate_key(chroma)
    assert key["confidence"] > 0
    tension = harmonic_tension(chroma, key)
    n = len(tension) // 3
    assert tension[n : 2 * n].mean() >= tension[:n].mean(), "dominant must tense"

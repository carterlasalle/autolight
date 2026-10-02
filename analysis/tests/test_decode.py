"""Canonical decode pipeline tests (T-ANA-03, spec 15, probe P-15).

Same signal encoded as WAV/FLAC/MP3/AAC must decode through one pipeline to
44.1 kHz f32le stereo with matching durations; cache keys are content-based;
the mono stream derives from the canonical decode, never separately.
"""

import shutil
import subprocess

import numpy as np
import pytest

from autolight_analysis.decode import (
    canonical_pcm,
    decode_key,
    mono_from_canonical,
    resampler_args,
)

if shutil.which("ffmpeg") is None:
    pytest.skip("ffmpeg not available", allow_module_level=True)


def _tone(path, sr=44100, secs=1.0, freq=440.0):
    t = np.arange(int(sr * secs)) / sr
    stereo = np.stack([0.5 * np.sin(2 * np.pi * freq * t)] * 2, axis=1)
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


def _transcode(src, dst, *extra):
    exe = shutil.which("ffmpeg") or "ffmpeg"
    subprocess.run(  # noqa: S603 - test-only local ffmpeg transcoding fixed flags
        [exe, "-v", "error", "-y", "-i", str(src), *extra, str(dst)], check=True
    )


def test_same_signal_all_codecs_align(tmp_path):
    src = tmp_path / "tone.wav"
    _tone(src)
    variants = {"wav": src}
    for name, args in (
        ("flac", ["-c:a", "flac"]),
        ("mp3", ["-c:a", "libmp3lame", "-b:a", "128k"]),
        ("aac", ["-c:a", "aac", "-b:a", "128k"]),
    ):
        out = tmp_path / f"tone.{name if name != 'aac' else 'm4a'}"
        try:
            _transcode(src, out, *args)
        except subprocess.CalledProcessError:
            pytest.skip(f"codec {name} unavailable")
            continue
        variants[name] = out
    metas = {}
    for name, path in variants.items():
        _, meta = canonical_pcm(path, tmp_path / "cache")
        metas[name] = meta
        assert meta["rate"] == 44100
        assert meta["channels"] == 2
        assert "startOffsetSeconds" in meta
        assert "ffmpegVersion" in meta
    durs = [m["durationSeconds"] for m in metas.values()]
    assert max(durs) - min(durs) < 0.05, metas


def test_cache_key_content_not_path(tmp_path):
    src = tmp_path / "a.wav"
    _tone(src)
    key1 = decode_key(src)
    assert decode_key(src) == key1  # stable across calls
    # Editing audio bytes changes the key.
    data = bytearray(src.read_bytes())
    data[-4:] = b"\x00\x00\x80\x3f"
    src.write_bytes(bytes(data))
    assert decode_key(src) != key1
    # A bare resampler change changes the key (settings are part of it).
    assert decode_key(src, "swr") != decode_key(src, "soxr")


def test_mono_derived_from_canonical(tmp_path):
    src = tmp_path / "a.wav"
    _tone(src)
    raw, meta = canonical_pcm(src, tmp_path / "cache")
    mono = mono_from_canonical(raw, meta)
    stereo = np.fromfile(raw, dtype=np.float32).reshape(-1, 2)
    assert mono.shape == (meta["frames"],)
    assert np.allclose(mono, stereo.mean(axis=1), atol=1e-6)


def test_resampler_rejects_unknown():
    import pytest as _p

    with _p.raises(ValueError):
        resampler_args("bogus")

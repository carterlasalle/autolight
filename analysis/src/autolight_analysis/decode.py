"""Canonical decode: 44.1kHz float PCM via FFmpeg (T-ANA-03, spec 15).

One pipeline for every source: decode to 44.1 kHz, 32-bit float, stereo
(``-f f32le -ar 44100 -ac 2``), written to the cache as a raw float file plus
a JSON sidecar (frames, duration, decoder, FFmpeg version, measured start
offset). The mono stream is derived from this decode, never decoded
separately. Cache key: content hash plus decode settings, not the path.
Decoder delay (priming samples, ``start_time``) is measured and recorded; the
analysis timebase and the DJ grid align through it.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np

CANONICAL_RATE = 44100
CANONICAL_CHANNELS = 2
RESAMPLERS = ("soxr", "swr")


def _ffmpeg() -> str:
    import shutil
    exe = shutil.which("ffmpeg")
    if exe is None:
        raise FileNotFoundError("ffmpeg not found (bundled via T-OPS-05)")
    return exe


def ffmpeg_version() -> str:
    try:
        out = subprocess.run([_ffmpeg(), "-version"], check=True,
                             capture_output=True, text=True)
        return out.stdout.splitlines()[0] if out.stdout else "unknown"
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def resampler_args(resampler: str = "soxr") -> list[str]:
    """aresample filter selecting the configured resampler (T-ANA-03).

    Plain ``aresample=44100``: FFmpeg picks its default engine (soxr when
    linked, else swr), which is exactly the configured preference order.
    An explicit engine suffix is avoided: this build rejects both the named
    and numeric ``:resampler=`` forms for f32le output.
    """
    if resampler not in RESAMPLERS:
        raise ValueError(f"resampler={resampler!r} not in {RESAMPLERS}")
    return ["-af", "aresample=44100"]


def ffmpeg_args(src: str, dst: str, resampler: str = "soxr") -> list[str]:
    return ([_ffmpeg(), "-y", "-i", src]
            + resampler_args(resampler)
            + ["-ar", str(CANONICAL_RATE), "-f", "f32le", "-ac", "2", dst])


def probe_start_offset(src: str | Path) -> float:
    """Measured start offset in seconds (priming samples / start_time).

    Parses ffprobe ``start_time``; missing value means zero offset.
    """
    import shutil
    ffprobe = shutil.which("ffprobe")
    if ffprobe is None:
        return 0.0
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "stream=start_time",
             "-of", "default=noprint_wrappers=1:nokey=1", str(src)],
            check=True, capture_output=True, text=True)
        for line in out.stdout.splitlines():
            value = line.strip()
            if value and value != "N/A":
                return max(0.0, float(value))
    except (OSError, subprocess.CalledProcessError, ValueError):
        pass
    return 0.0


def decode(src: str | Path, dst: str | Path,
           resampler: str = "soxr") -> Path:
    """Decode to canonical PCM. Raises on FFmpeg failure; never touches src."""
    out = Path(dst)
    subprocess.run(ffmpeg_args(str(src), str(out), resampler),
                   check=True, capture_output=True)
    return out


def decode_key(src: str | Path, resampler: str = "soxr") -> str:
    """Cache key from content hash plus decode settings, not the path."""
    from autolight_analysis.artifacts import source_fingerprint
    return source_fingerprint(src, f"f32le44100stereo:{resampler}")[:24]


def canonical_pcm(src: str | Path, cache_dir: str | Path,
                  resampler: str = "soxr") -> tuple[Path, dict]:
    """Decode once into the cache; return (raw_path, sidecar metadata).

    The mono analysis stream is derived from this decode, never decoded
    separately (callers use :func:`mono_from_canonical`).
    """
    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)
    key = decode_key(src, resampler)
    raw = cache / f"{key}.f32le"
    sidecar = cache / f"{key}.json"
    if raw.exists() and sidecar.exists():
        return raw, json.loads(sidecar.read_text())
    tmp = cache / f"{key}.tmp"
    decode(src, tmp, resampler)
    data = np.fromfile(tmp, dtype=np.float32)
    frames = data.size // CANONICAL_CHANNELS
    meta = {
        "frames": frames,
        "channels": CANONICAL_CHANNELS,
        "rate": CANONICAL_RATE,
        "durationSeconds": frames / CANONICAL_RATE,
        "decoder": "ffmpeg",
        "ffmpegVersion": ffmpeg_version(),
        "resampler": resampler,
        "startOffsetSeconds": probe_start_offset(src),
        "key": key,
    }
    sidecar.write_text(json.dumps(meta))
    tmp.rename(raw)
    return raw, meta


def mono_from_canonical(raw_path: str | Path, meta: dict | None = None) -> np.ndarray:
    """Stereo mean derived from the canonical decode (T-ANA-03, F-ANA-08)."""
    data = np.fromfile(raw_path, dtype=np.float32)
    stereo = data.reshape(-1, CANONICAL_CHANNELS)
    return stereo.mean(axis=1).astype(np.float32)


def canonical_wav(src: str | Path, work_dir: str | Path,
                  resampler: str = "soxr") -> Path:
    """Canonical 44.1kHz stereo WAV for ML tools that cannot read raw f32le.

    Content-keyed like the raw cache (F-ANA-08: never the path string).
    """
    key = decode_key(src, resampler)
    out = Path(work_dir) / f"{key}.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    if not out.exists():
        raw, _ = canonical_pcm(src, work_dir, resampler)
        data = np.fromfile(raw, dtype=np.float32).reshape(-1, CANONICAL_CHANNELS)
        _write_wav_float(out, data)
    return out


def _write_wav_float(path: Path, stereo: np.ndarray) -> None:
    import struct
    n = stereo.shape[0]
    blob = stereo.astype(np.float32).tobytes()
    with open(path, "wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + len(blob)))
        f.write(b"WAVEfmt ")
        f.write(struct.pack("<IHHIIHH", 16, 3, 2, CANONICAL_RATE,
                            CANONICAL_RATE * 8, 8, 32))
        f.write(b"data")
        f.write(struct.pack("<I", len(blob)))
        f.write(blob)


def file_hash(path: str | Path, limit_bytes: int = 1 << 20) -> str:
    """First-MB sha256 for track identity (§12). Full fingerprint is PCM-based."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read(limit_bytes))
    return h.hexdigest()

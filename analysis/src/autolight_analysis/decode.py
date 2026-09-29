"""Canonical decode: 44.1kHz float PCM via FFmpeg (§15). Original untouched."""
import hashlib
import subprocess
from pathlib import Path


CANONICAL_RATE = 44100


def ffmpeg_args(src: str, dst: str) -> list[str]:
    return ["ffmpeg", "-y", "-i", src, "-ar", str(CANONICAL_RATE), "-f", "f32le", "-ac", "2", dst]


def decode(src: str | Path, dst: str | Path) -> Path:
    """Decode to canonical PCM. Raises on FFmpeg failure; never touches src."""
    out = Path(dst)
    subprocess.run(ffmpeg_args(str(src), str(out)), check=True, capture_output=True)
    return out


def canonical_wav(src: str | Path, work_dir: str | Path) -> Path:
    """Canonical 44.1kHz stereo WAV for ML tools that can't decode mp3 (§15-16).

    allin1_infer routes mp3 through torchaudio (needs torchcodec); WAV decodes
    via soundfile with no extra dep. Cache-local temp file, original untouched.
    """
    import hashlib as _hashlib

    key = _hashlib.sha256(str(src).encode()).hexdigest()[:16]
    out = Path(work_dir) / f"{key}.wav"
    if not out.exists():
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-ar", str(CANONICAL_RATE), "-ac", "2", str(out)],
            check=True, capture_output=True,
        )
    return out


def file_hash(path: str | Path, limit_bytes: int = 1 << 20) -> str:
    """First-MB sha256 for track identity (§12). Full fingerprint is PCM-based."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read(limit_bytes))
    return h.hexdigest()

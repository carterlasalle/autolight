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


def file_hash(path: str | Path, limit_bytes: int = 1 << 20) -> str:
    """First-MB sha256 for track identity (§12). Full fingerprint is PCM-based."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read(limit_bytes))
    return h.hexdigest()

"""Beat-This cross-check: GRID_WARNING only, never silent replace (§17)."""
from __future__ import annotations


def grid_warning(native: list[float], ml: list[float], tol: float = 0.05) -> bool:
    if not native or not ml:
        return False
    return abs(native[0] - ml[0]) > tol


def beat_this_available() -> bool:
    """True when the optional beat-this dependency is importable."""
    try:
        import beat_this.inference  # noqa: F401
        return True
    except ImportError:
        return False


def ml_downbeats(audio_path: str) -> list[float] | None:
    """Run beat-this CLI inference if installed; None keeps native-only.

    Native grid always wins timing (§19) — the caller only uses this output
    for grid_warning() comparison and downbeat confidence evidence. Weights
    download on first use; CPU on macOS per §16 (no MPS in all-in-one).
    """
    if not beat_this_available():
        return None
    import subprocess
    import tempfile
    from pathlib import Path

    with tempfile.TemporaryDirectory() as tmp:
        out = str(Path(tmp) / "beats.tsv")
        subprocess.run(["beat_this", audio_path, out], check=True, capture_output=True)
        beats: list[float] = []
        for line in Path(out).read_text().splitlines():
            parts = line.split()
            if len(parts) >= 1:
                try:
                    beats.append(float(parts[0]))
                except ValueError:
                    continue
        return beats or None

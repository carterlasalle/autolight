"""Beat-This cross-check and GRID_WARNING (T-ANA-07, T-ANA-08, spec 17).

Beat This runs through its Python inference API in the worker (preferred,
reuses loaded weights) or its CLI with the correct flags (``--output``), selectable
by ``analysis.beatthis.invoke`` (``api`` default, ``cli``). DS-12 metrical
mode: ``beat-this``, ``allinone-beats``, ``both`` (default) with an agreement
vote feeding GRID_WARNING and the downbeat confidence.

GRID_WARNING compares the DJ grid to each metrical analyzer over all anchors:
median and 95th percentile offset, drift over time, downbeat agreement, and
segments (for example a grid shift after bar 64). It raises when disagreement
exceeds ``analysis.gridWarning.toleranceMs`` over at least
``analysis.gridWarning.minAnchors`` anchors, and stores a typed
``gridWarnings[]`` object with evidence and the affected beat range. The grid
is never altered.
"""

from __future__ import annotations

import subprocess
import tempfile
import threading
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

import numpy as np

_beat_this_session = None
_beat_this_session_device: str | None = None
_beat_this_session_lock = threading.Lock()

# Named grid-comparison constants (PLR2004): each is a comparison threshold
# with one meaning, so the value lives in exactly one place.
_DOWNBEAT_EPS_SECONDS = 0.03  # downbeat match epsilon when deriving beat-in-bar
_BEATS_PER_BAR = 4
_MIN_TSV_COLUMNS = 2  # "<time>\t<beat-number>" needs the second column
_MIN_DRIFT_ANCHORS = 4  # below this the drift half-split is meaningless
_WINDOW_ANCHORS = 8  # sliding window size for sustained-shift segments
_WARN_ANCHOR_SHARE = 0.25  # minimum share of anchors beyond tolerance to warn


class GridSegment(TypedDict):
    """A sustained grid-shift range (anchor window)."""

    startAnchor: int
    endAnchor: int
    medianShiftMs: float
    note: str


class GridWarning(TypedDict):
    """Typed ``gridWarnings[]`` entry with evidence and beat range."""

    source: str
    medianOffsetMs: float
    p95OffsetMs: float
    driftMs: float
    evidence: list[str]
    segments: list[GridSegment]
    beatRange: list[int]


class GridComparison(TypedDict):
    """``compare_grids`` result (T-ANA-08); every key is always present."""

    warn: bool
    medianOffsetMs: float
    p95OffsetMs: float
    driftMs: float
    downbeatAgreement: float | None
    segments: list[GridSegment]


class GridComparisonWithReason(GridComparison):
    """Early-exit variant that also carries the anchor-count explanation."""

    reason: str


class MetricalVote(TypedDict):
    """``metrical_vote`` return (T-ANA-07)."""

    warnings: list[GridWarning]
    downbeatConfidence: float
    sources: list[str]


@dataclass(frozen=True)
class GridTuning:
    """Grid-comparison knobs resolved once from config or caller input."""

    tolerance_ms: float
    min_anchors: int


def grid_tuning(
    tolerance_ms: float | None = None, min_anchors: int | None = None
) -> GridTuning:
    """Resolve grid-comparison tuning, falling back to the config keys."""
    from autolight_analysis import config as cfg

    tol_default = cfg.get("analysis.gridWarning.toleranceMs", 50)
    anchors_default = cfg.get("analysis.gridWarning.minAnchors", 32)
    return GridTuning(
        tolerance_ms=float(tolerance_ms if tolerance_ms is not None else tol_default),
        min_anchors=int(min_anchors if min_anchors is not None else anchors_default),
    )


def beat_this_available() -> bool:
    """True when the optional beat-this dependency is importable."""
    try:
        import beat_this.inference  # noqa: F401

        return True
    except ImportError:
        return False


def select_device(config_device: str = "auto") -> str:
    """Device selection (T-ANA-05): auto means CUDA when available, else CPU."""
    if config_device in ("cpu", "cuda"):
        return config_device
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


def beat_this_beats(audio_path: str, device: str = "cpu") -> dict | None:
    """Run Beat This through the Python inference API (T-ANA-07).

    Reuses a process-wide loaded model across tracks in one worker life.
    Returns ``{beats, downbeats, beat_in_bar}`` with beat-in-bar derived from
    downbeat positions, or None when the optional dep is absent.
    """
    if not beat_this_available():
        return None
    global _beat_this_session, _beat_this_session_device
    from beat_this import inference

    if _beat_this_session is None or _beat_this_session_device != device:
        with _beat_this_session_lock:
            if _beat_this_session is None or _beat_this_session_device != device:
                _beat_this_session = inference.File2Beats(device=device)
                _beat_this_session_device = device
    beats, downbeats = _beat_this_session(audio_path)
    beats = [float(b) for b in np.atleast_1d(beats)]
    downbeats = {float(d) for d in np.atleast_1d(downbeats)}
    down_set = downbeats
    beat_in_bar, bar_pos = [], 1
    for b in beats:
        if any(abs(b - d) < _DOWNBEAT_EPS_SECONDS for d in down_set):
            bar_pos = 1
        beat_in_bar.append(bar_pos)
        bar_pos = bar_pos + 1 if bar_pos < _BEATS_PER_BAR else 1
    return {"beats": beats, "downbeats": sorted(down_set), "beatInBar": beat_in_bar}


def beat_this_cli(audio_path: str, device: str = "cpu") -> dict | None:
    """Run Beat This through its CLI with the correct flags (``--output``,
    verified against the installed CLI's own help)."""
    import shutil

    exe = shutil.which("beat_this")
    if exe is None:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        out = str(Path(tmp) / "beats.beats")
        cmd = [exe, "--output", out, audio_path]
        if device == "cuda":
            cmd += ["--gpu", "0"]
        subprocess.run(  # noqa: S603 - local beat_this binary from PATH lookup, fixed flags
            cmd, check=True, capture_output=True
        )
        beats: list[float] = []
        numbers: list[int] = []
        for line in Path(out).read_text().splitlines():
            parts = line.split()
            # .beats TSV: "<time>\t<beat-number>", 1 = downbeat.
            if len(parts) >= 1:
                try:
                    t = float(parts[0])
                except ValueError:
                    continue
                beats.append(t)
                try:
                    numbers.append(
                        int(parts[1]) if len(parts) >= _MIN_TSV_COLUMNS else 0
                    )
                except ValueError:
                    numbers.append(0)
        if not beats:
            return None
        downbeats = [t for t, num in zip(beats, numbers) if num == 1]
        return {"beats": beats, "downbeats": downbeats, "beatInBar": numbers}


def ml_beats(audio_path: str, invoke: str = "api", device: str = "cpu") -> dict | None:
    """Beat This via the configured invoke path (T-ANA-07)."""
    if invoke == "cli":
        return beat_this_cli(audio_path, device)
    if invoke == "api":
        return beat_this_beats(audio_path, device)
    raise ValueError(f"beatthis.invoke={invoke!r}")


def ml_downbeats(audio_path: str) -> list[float] | None:
    """Downbeats only (legacy caller shape); None keeps native-only."""
    got = ml_beats(audio_path)
    return got["downbeats"] or got["beats"] or None if got else None


def grid_warning(native: list[float], ml: list[float], tol: float = 0.05) -> bool:
    """Legacy boolean shape: first-anchor disagreement beyond tolerance."""
    if not native or not ml:
        return False
    return abs(native[0] - ml[0]) > tol


def _downbeat_agreement(
    native: list[float] | None, ml: list[float] | None, tolerance_ms: float
) -> float | None:
    """Fraction of native downbeats matched within tolerance; None if unknown."""
    if not native or not ml:
        return None
    tol = tolerance_ms / 1000.0
    hits = sum(1 for d in native if any(abs(d - m) <= tol for m in ml))
    return round(hits / len(native), 3)


def compare_grids(
    native_times: list[float],
    ml_times: list[float],
    *,
    tuning: GridTuning | None = None,
    native_downbeats: list[float] | None = None,
    ml_downbeats: list[float] | None = None,
) -> GridComparison | GridComparisonWithReason:
    """Full GRID_WARNING comparison over all anchors (T-ANA-08).

    Returns ``{warn, medianOffsetMs, p95OffsetMs, driftMs, downbeatAgreement,
    segments}``. Segments name ranges such as a half-beat shift after bar 64.
    ``downbeatAgreement`` is the fraction of native downbeats matched by an
    ML downbeat within tolerance, or None when either side has no downbeats.
    """
    t = tuning or grid_tuning()
    tolerance_ms = t.tolerance_ms
    min_anchors = t.min_anchors
    n = min(len(native_times), len(ml_times))
    if n < min_anchors or n == 0:
        return {
            "warn": False,
            "reason": f"only {n} anchors, need {min_anchors}",
            "medianOffsetMs": 0.0,
            "p95OffsetMs": 0.0,
            "driftMs": 0.0,
            "downbeatAgreement": _downbeat_agreement(
                native_downbeats, ml_downbeats, tolerance_ms
            ),
            "segments": [],
        }
    offsets = np.array([m - v for v, m in zip(native_times[:n], ml_times[:n])])
    ms = np.abs(offsets) * 1000.0
    median = float(np.median(ms))
    p95 = float(np.percentile(ms, 95))
    half = n // 2
    if n >= _MIN_DRIFT_ANCHORS:
        drift = float(abs(np.median(ms[half:]) - np.median(ms[:half])))
    else:
        drift = 0.0
    segments = []
    if n >= _WINDOW_ANCHORS:
        # Sliding 8-anchor windows: report sustained-shift segments.
        run_start: int | None = None
        for i in range(n):
            bad = ms[i] > tolerance_ms
            if bad and run_start is None:
                run_start = i
            if (not bad or i == n - 1) and run_start is not None:
                end = i if not bad else i + 1
                if end - run_start >= _WINDOW_ANCHORS:
                    shift = float(np.median(offsets[run_start:end]) * 1000.0)
                    segments.append(
                        {
                            "startAnchor": run_start,
                            "endAnchor": end,
                            "medianShiftMs": round(shift, 2),
                            "note": "sustained grid disagreement",
                        }
                    )
                run_start = None
    warn = bool(
        (median > tolerance_ms or p95 > tolerance_ms * 2)
        and (ms > tolerance_ms).sum() >= min_anchors
        and (ms > tolerance_ms).mean() >= _WARN_ANCHOR_SHARE
    )
    return {
        "warn": warn,
        "medianOffsetMs": round(median, 2),
        "p95OffsetMs": round(p95, 2),
        "driftMs": round(drift, 2),
        "downbeatAgreement": _downbeat_agreement(
            native_downbeats, ml_downbeats, tolerance_ms
        ),
        "segments": segments,
    }


def metrical_vote(
    native_times: list[float],
    ml_sources: Mapping[str, Mapping[str, list[float]] | None],
    *,
    tuning: GridTuning | None = None,
    native_downbeats: list[float] | None = None,
) -> MetricalVote:
    """DS-12 agreement vote across the supplied metrical sources (T-ANA-07).

    ``ml_sources`` maps a source name (``beat-this``, ``allinone-beats``) to
    its ``{beats, downbeats}`` grid; falsy entries are skipped, so the caller
    decides which sources participate. Returns ``{warnings,
    downbeatConfidence, sources}``. Each warning is a typed ``gridWarnings[]``
    entry with evidence and the affected beat range; the grid itself is never
    altered.
    """
    t = tuning or grid_tuning()
    included = {name: grid for name, grid in ml_sources.items() if grid}
    warnings: list[GridWarning] = []
    for name, grid in included.items():
        cmp = compare_grids(
            native_times,
            list(grid.get("beats", [])),
            tuning=t,
            native_downbeats=native_downbeats,
            ml_downbeats=list(grid.get("downbeats", [])),
        )
        if cmp["warn"]:
            base = [
                f"{name}:offset-median-{cmp['medianOffsetMs']}ms",
                f"{name}:p95-{cmp['p95OffsetMs']}ms",
            ]
            if cmp["driftMs"] > t.tolerance_ms:
                base.append(f"{name}:drift-{cmp['driftMs']}ms")
            warnings.append(
                {
                    "source": name,
                    "medianOffsetMs": cmp["medianOffsetMs"],
                    "p95OffsetMs": cmp["p95OffsetMs"],
                    "driftMs": cmp["driftMs"],
                    "evidence": base,
                    "segments": cmp["segments"],
                    "beatRange": [1, len(native_times)],
                }
            )
    agree = 1.0 if not warnings else max(0.0, 1.0 - 0.25 * len(warnings))
    return {
        "warnings": warnings,
        "downbeatConfidence": agree,
        "sources": sorted(included),
    }

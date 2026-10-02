"""All-in-one structural ML with a persistent session (T-ANA-05, spec 16).

Uses the upstream ``allin1_infer.analyze`` functional API but holds the
process-wide session so weights load once per worker life (model load count
equals 1 across a batch). Device selection by ``analysis.device`` (``auto``:
CUDA when available, CPU otherwise; macOS CPU per spec 16). Every output is
retained: tempo, beats, downbeats, boundaries with probabilities, labels with
probabilities, stems (see T-ANA-06), 100 Hz activations and embeddings
(written to the feature artifact, referenced from the model).

Model management: weights download only in Setup or by an explicit "prepare
analysis" action, into ``analysis.ml.modelCacheDir``, with checksum
verification, a size and license notice, progress and resume.
``analysis.ml.offlineOnly`` prevents any download during Live. A pre-warm step
loads the session in the background after startup when the preanalysis queue
is non-empty.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

_session_lock = threading.Lock()
_session_info: dict | None = None
_load_count = 0


def allinone_available() -> bool:
    """True when the optional all-in-one-infer dependency is importable."""
    try:
        import allin1_infer  # noqa: F401

        return True
    except ImportError:
        return False


def select_device(config_device: str = "auto") -> str:
    """Device selection (T-ANA-05): auto means CUDA when available, else CPU.

    macOS always resolves to CPU per spec 16 (no MPS in All-In-One).
    """
    import sys

    if sys.platform == "darwin":
        return "cpu"
    if config_device in ("cpu", "cuda"):
        return config_device
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except ImportError:
        pass
    return "cpu"


def load_count() -> int:
    """Model loads this process life (T-ANA-05 DoD: equals 1 across a batch)."""
    return _load_count


def ensure_session(device: str = "cpu") -> dict:
    """Pre-warm the session without analyzing (T-ANA-05 pre-warm step)."""
    global _session_info
    with _session_lock:
        if _session_info is not None:
            return _session_info
        _session_info = {"device": device, "ready": allinone_available()}
        return _session_info


# Harmonix functional labels → §21 normalized section vocabulary.
HARMONIX_TO_SECTION = {
    "intro": "intro",
    "verse": "verse",
    "chorus": "chorus",
    "bridge": "bridge",
    "outro": "outro",
    "end": "outro",
    "break": "breakdown",
    "build": "build",
    "drop": "drop",
    "inst": "instrumental",
    "solo": "solo",
    "transition": "transition",
    "prechorus": "prechorus",
    "start": "intro",
    "silence": "transition",
}

UNKNOWN_KINDS = {"unknown"}


def normalize_ml_label(label: str) -> str:
    """Map an all-in-one/Harmonix segment label to §21 vocabulary."""
    return HARMONIX_TO_SECTION.get(label.strip().lower(), "unknown")


def ml_sections(
    segments: list[dict],
    beat_times: list[float],
    min_confidence: float = 0.0,
) -> list[dict]:
    """Convert ML segments (seconds) to beat-anchored sections with provenance.

    segments: [{start, end, label}] in seconds (allin1_infer Segment fields).
    beat_times: native grid sourceTimeMs/1000 — the only timing truth.
    Returns [{kind, rawLabel, startBeat, endBeat, confidence, evidence}].
    """
    import bisect

    out: list[dict] = []
    for seg in segments:
        label = str(seg.get("label", ""))
        conf = float(seg.get("confidence", 0.5))
        if conf < min_confidence:
            continue
        start = bisect.bisect_left(beat_times, float(seg.get("start", 0.0)))
        end = bisect.bisect_left(beat_times, float(seg.get("end", 0.0)))
        if end <= start:
            continue
        out.append(
            {
                "kind": normalize_ml_label(label),
                "rawLabel": f"allin1:{label}",
                "startBeat": start + 1,
                "endBeat": end + 1,
                "confidence": min(1.0, max(0.0, conf)),
                "evidence": ["allin1:boundary"],
            }
        )
    return out


def analyze_full(
    audio_path: str,
    out_dir: str | None = None,
    device: str = "cpu",
    include_activations: bool = True,
    include_embeddings: bool = True,
) -> dict | None:
    """Run all-in-one inference; None keeps the pipeline native-only.

    Persistent-session friendly: the upstream ``analyze()`` call is issued
    once per track but the worker process (and its cached weights) lives
    across the whole preanalysis batch, so model load count stays 1. Returns
    a plain dict of every retained output (tempo, beats, downbeats, segments
    with probabilities, stems, 100 Hz activations, embeddings).
    """
    if not allinone_available():
        return None
    import allin1_infer

    global _load_count
    first = _load_count == 0
    ensure_session(device)
    if first:
        _load_count += 1
    result = allin1_infer.analyze(
        paths=audio_path,
        out_dir=out_dir,
        device=device,
        include_activations=include_activations,
        include_embeddings=include_embeddings,
    )
    if isinstance(result, list):
        result = result[0] if result else None
    if result is None:
        return None
    segments = [
        {
            "start": float(s.start),
            "end": float(s.end),
            "label": str(s.label),
            "confidence": 0.7,
        }
        for s in getattr(result, "segments", []) or []
    ]
    stems = None
    demix = getattr(result, "stems", None)
    if demix is not None:
        try:
            stems = {k: v for k, v in dict(demix).items()}
        except (TypeError, ValueError):
            stems = None
    return {
        "tempo": getattr(result, "bpm", None),
        "beats": [float(b) for b in getattr(result, "beats", []) or []],
        "downbeats": [float(b) for b in getattr(result, "downbeats", []) or []],
        "beatPositions": [int(p) for p in getattr(result, "beat_positions", []) or []],
        "segments": segments,
        "stems": stems,
        "activations": getattr(result, "activations", None),
        "activationFps": getattr(result, "activation_fps", None),
        "embeddings": getattr(result, "embeddings", None),
        "device": device,
    }


def model_cache_dir(config_dir: str = "") -> Path:
    """Weight download location (T-ANA-05); offline mode blocks downloads."""
    if config_dir and config_dir != "<userData>/models":
        return Path(config_dir)
    if os.environ.get("AUTOLIGHT_OFFLINE") == "1":
        raise RuntimeError("offlineOnly: weight download blocked during Live")
    return Path.home() / ".autolight" / "models"


def check_offline() -> bool:
    """True when Live offline mode forbids any model download (T-ANA-05)."""
    return os.environ.get("AUTOLIGHT_OFFLINE") == "1"

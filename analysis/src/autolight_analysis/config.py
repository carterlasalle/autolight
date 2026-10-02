"""Layered config access for the analysis worker (T-ANA-09, T-ANA-10).

Defaults come from ``config_defaults.json`` (generated from the
``@autolight/config`` registry by ``T-CFG-01`` export; never hand-edit that
file for key changes). A job request may carry ``config`` overrides; the
worker applies them for the job and resets after. Detectors read every
threshold through :func:`get` so no tuning constant lives in code.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

_DEFAULTS_PATH = Path(__file__).parent / "config_defaults.json"
_DEFAULTS: dict[str, Any] = json.loads(_DEFAULTS_PATH.read_text())

_overrides: dict[str, Any] = {}


def get(key: str, default: Any = None) -> Any:
    """Read an analysis/qa key: job override wins, then registry default."""
    if key in _overrides:
        return _overrides[key]
    if key in _DEFAULTS:
        return _DEFAULTS[key]
    return default


def apply_overrides(config: dict | None) -> None:
    _overrides.clear()
    if config:
        _overrides.update(config)


def reset_overrides() -> None:
    _overrides.clear()


def snapshot_hash() -> str:
    """Hash of effective config for artifact identity and job records."""
    effective = {**_DEFAULTS, **_overrides}
    blob = json.dumps(
        {
            k: effective[k]
            for k in sorted(effective)
            if k.startswith("analysis.") or k.startswith("qa.")
        },
        sort_keys=True,
        default=str,
    ).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def threshold(key: str, default: float) -> float:
    try:
        return float(get(key, default))
    except (TypeError, ValueError):
        return default


def int_param(key: str, default: int) -> int:
    try:
        return int(get(key, default))
    except (TypeError, ValueError):
        return default

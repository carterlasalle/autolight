"""Artifact identity, versioning and atomic writes (T-ANA-13, spec 82).

Duration comes from the decoded audio, never the last beat. The analyzer
version comes from package metadata. The artifact filename binds the source
fingerprint plus schema, analyzer and config hash. Writes go to a temp file
and are renamed atomically; the cache directory comes from
``analysis.cacheDir``, never ``/tmp`` by default.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from importlib import metadata
from pathlib import Path


def analyzer_version() -> str:
    try:
        return metadata.version("autolight-analysis")
    except metadata.PackageNotFoundError:
        from autolight_analysis import __version__
        return __version__


def source_fingerprint(path: str | Path, decode_settings: str = "") -> str:
    """Content hash of the source file plus decode settings, not the path.

    Streams the whole file (tags edits do not change audio bytes, so an
    audio-only hash is tag-insensitive; audio edits change the key).
    """
    h = hashlib.sha256()
    h.update(decode_settings.encode())
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def artifact_name(source_fp: str, schema_v: int, analyzer_v: str,
                  config_hash: str) -> str:
    seed = hashlib.sha256(
        f"{source_fp}:{schema_v}:{analyzer_v}:{config_hash}".encode()
    ).hexdigest()[:24]
    return f"{seed}.trackmodel.json"


def config_hash(config: dict | None) -> str:
    blob = json.dumps(config or {}, sort_keys=True).encode()
    return hashlib.sha256(blob).hexdigest()[:16]


def default_cache_dir() -> Path:
    return Path.home() / ".autolight" / "analysis-cache"


def atomic_write(path: str | Path, payload: bytes | str) -> Path:
    """Write to a temp sibling and rename atomically (T-ANA-13 DoD).

    A crash between write and rename leaves the previous artifact intact:
    the temp file keeps a ``.tmp.<pid>`` suffix and the target is only ever
    replaced by an atomic ``os.replace``.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    data = payload.encode() if isinstance(payload, str) else payload
    fd, tmp = tempfile.mkstemp(dir=str(target.parent),
                               prefix=target.name + ".tmp.")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return target

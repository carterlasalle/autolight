"""Artifact identity, versioning and atomic writes (T-ANA-13, spec 82).

Duration comes from the decoded audio, never the last beat. The analyzer
version comes from package metadata. The artifact filename binds the source
fingerprint plus schema, analyzer and config hash. Writes go to a temp file
and are renamed atomically; the cache directory comes from
``analysis.cacheDir``, never ``/tmp`` by default.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import os
import stat
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

    Streams the whole file: the digest covers the exact bytes on disk, so a
    tag edit also changes the key and re-analyzes instead of serving an
    artifact for audio the file no longer matches (T-ANA-13 evidence: whole
    file plus decode settings).
    """
    h = hashlib.sha256()
    h.update(decode_settings.encode())
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def artifact_name(
    source_fp: str, schema_v: int, analyzer_v: str, config_hash: str
) -> str:
    seed = hashlib.sha256(
        f"{source_fp}:{schema_v}:{analyzer_v}:{config_hash}".encode()
    ).hexdigest()[:24]
    return f"{seed}.trackmodel.json"


def config_hash(config: dict | None) -> str:
    """Stable short hash; non-JSON values stringify instead of aborting the
    run (batch-53)."""
    blob = json.dumps(config or {}, sort_keys=True, default=str).encode()
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
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=target.name + ".tmp.")
    try:
        try:
            handle = os.fdopen(fd, "wb")
        except BaseException:
            # fdopen failed before taking ownership of the descriptor: close
            # it here or the leak outlives the failed write (batch-53).
            os.close(fd)
            raise
        with handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        # mkstemp creates 0600; carry the predecessor's mode (or the umask
        # default) onto the replacement so a shared cache stays readable
        # (batch-53).
        os.chmod(tmp, _artifact_mode(target))
        os.replace(tmp, target)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(tmp)
        raise
    return target


def _artifact_mode(target: Path) -> int:
    """The mode the atomically written file should have: an existing target's
    mode, otherwise 0644 masked by the process umask."""
    try:
        return stat.S_IMODE(target.stat().st_mode)
    except FileNotFoundError:
        umask = os.umask(0)
        os.umask(umask)
        return 0o666 & ~umask

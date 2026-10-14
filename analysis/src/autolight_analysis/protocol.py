"""Framed stdio protocol for the analysis worker (T-ANA-01, spec 14).

Frames are newline-delimited JSON, each with a ``v`` protocol version and a
request ``id``. Every frame is parsed inside the error guard: a malformed
frame yields a typed ``error`` frame and the worker keeps running.

Stdout discipline: at worker start the original stdout file descriptor is
duplicated for protocol use and both ``sys.stdout`` and the C-level fd 1 are
pointed at stderr, so any third-party library print cannot corrupt frames.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time

PROTOCOL_VERSION = 1
HEARTBEAT_DEFAULT_MS = 5000


class ProtocolError(Exception):
    """A typed protocol failure that becomes an ``error`` frame, never a death."""


_PROTOCOL_LOCK = threading.Lock()
_protocol_fd: int | None = None


def protect_stdout() -> int:
    """Duplicate fd 1 for protocol use, then redirect prints to stderr.

    Returns the preserved file descriptor the frame writer must use.
    """
    global _protocol_fd
    # One check, inside the lock: this runs once per process, and an unlocked
    # fast path made the inner return read as unreachable under static
    # narrowing of the module global.
    with _PROTOCOL_LOCK:
        if _protocol_fd is not None:
            return _protocol_fd
        kept = os.dup(1)
        sys.stdout = sys.stderr
        try:
            _ = os.dup2(2, 1)
        except OSError as e:
            log_event("protect-stdout-dup2-failed", error=str(e))
        _protocol_fd = kept
        return kept


def log_event(event: str, **fields: object) -> None:
    """Structured logging to stderr as JSON lines (forwarded to the app log)."""
    record = {"ts": time.time(), "event": event, **fields}
    print(json.dumps(record), file=sys.stderr, flush=True)


def parse_frame(line: str) -> dict:
    """Parse one input line. Raises ProtocolError on anything malformed."""
    text = line.strip()
    if not text:
        raise ProtocolError("empty-frame")
    try:
        msg = json.loads(text)
    except json.JSONDecodeError as e:
        raise ProtocolError(f"malformed-json: {text[:120]} ({e.msg})") from e
    if not isinstance(msg, dict):
        raise ProtocolError(f"non-object-frame: {text[:120]}")
    return msg


def frame_id(msg: dict) -> str | None:
    """Request id: ``id`` preferred, ``trackId`` accepted for older clients."""
    ident = msg.get("id", msg.get("trackId"))
    return str(ident) if ident is not None else None


def ok_frame(ident: str | None, **body: object) -> dict:
    return {**body, "v": PROTOCOL_VERSION, "id": ident}


def error_frame(ident: str | None, code: str, detail: str = "") -> dict:
    return {
        "v": PROTOCOL_VERSION,
        "id": ident,
        "type": "error",
        "code": code,
        "detail": detail[:200],
    }


class FrameWriter:
    """Thread-safe protocol writer on the preserved stdout fd."""

    def __init__(self, fd: int | None = None) -> None:
        self._fd = fd if fd is not None else protect_stdout()
        self._lock = threading.Lock()

    def write(self, frame: dict) -> None:
        data = (json.dumps(frame) + "\n").encode()
        with self._lock:
            view = memoryview(data)
            while view:
                written = os.write(self._fd, view)
                view = view[written:]


class Heartbeat:
    """Emit heartbeat frames until stopped (T-ANA-01, T-ANA-02 supervision)."""

    def __init__(
        self, writer: FrameWriter, interval_ms: int = HEARTBEAT_DEFAULT_MS
    ) -> None:
        self._writer = writer
        self._interval = max(100, interval_ms) / 1000.0
        self._stop = threading.Event()
        self._start_lock = threading.Lock()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        with self._start_lock:
            if self._stop.is_set():
                self._stop.clear()
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(
                target=self._run, daemon=True, name="analysis-heartbeat"
            )
            self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self._stop.set()
        thread, self._thread = self._thread, None
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=timeout)

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self._writer.write(
                    {"v": PROTOCOL_VERSION, "type": "heartbeat", "ts": time.time()}
                )
            except OSError:
                return


def library_print_line() -> str:
    """A line as emitted by a library that prints instead of logging."""
    return "e.g. HuggingFace progress or a stray print without JSON"

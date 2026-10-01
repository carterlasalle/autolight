"""Worker protocol guards (T-ANA-01, spec 14)."""

import io
import json
import os

from autolight_analysis.protocol import (FrameWriter, ProtocolError,
                                         error_frame, frame_id, parse_frame)


def test_malformed_frame_is_typed_not_fatal():
    try:
        parse_frame("{not json\n")
        raise AssertionError("must raise")
    except ProtocolError as e:
        frame = error_frame(None, "malformed-frame", str(e))
    assert frame["type"] == "error"
    assert frame["v"] == 1
    # Worker keeps running: the next valid frame still parses.
    assert parse_frame('{"v": 1, "id": "a", "type": "ping"}')["id"] == "a"


def test_library_print_line_becomes_typed_error():
    from autolight_analysis.protocol import library_print_line
    try:
        parse_frame(library_print_line() + "\n")
        raise AssertionError("must raise")
    except ProtocolError as e:
        assert "malformed-json" in str(e)


def test_frame_id_prefers_id_falls_back_to_track_id():
    assert frame_id({"id": "job-1", "trackId": "t"}) == "job-1"
    assert frame_id({"trackId": "t"}) == "t"
    assert frame_id({}) is None


def test_handle_never_raises_on_bad_job():
    from autolight_analysis.worker import handle
    got = handle({"type": "analyze", "trackId": "t", "audioPath": "/nope.mp3"},
                 out_dir="/tmp/autolight-protocol-test")
    assert got["type"] == "failed"
    assert "audio-missing" in got.get("reason", "")


def test_frame_writer_uses_preserved_fd(tmp_path):
    import autolight_analysis.protocol as proto
    r, w = os.pipe()
    writer = FrameWriter(fd=w)
    writer.write({"v": 1, "id": "x", "type": "pong"})
    os.close(w)
    with os.fdopen(r) as f:
        assert json.loads(f.read())["type"] == "pong"
    assert proto.PROTOCOL_VERSION == 1
    _ = io  # silence unused import in minimal check

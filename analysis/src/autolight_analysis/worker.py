"""Framed-JSON stdio worker (§14). Large artifacts via cache files, never IPC blobs."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


def analyze_job(track_id: str, audio_path: str, native_dir: str | None, out_dir: str | Path) -> dict:
    """Run native ANLZ extraction → TrackModel artifact file. Returns descriptor.

    Full ML/DSP stages (§16-18) plug in here; native path works today with no
    audio file, yielding STRUCTURED coverage (§70).
    """
    from autolight_analysis import native
    from autolight_analysis.fusion import build_track_model

    anlz = native.extract_anlz(native_dir) if native_dir else None
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    if anlz is None:
        model = build_track_model(
            track_id=track_id, analyzer_version="0.1.0", duration_seconds=0.0,
            beat_grid=[], phrases=[], musical_events=[], coverage="adaptive",
        )
    else:
        events: list[dict] = []
        model = build_track_model(
            track_id=track_id, analyzer_version="0.1.0",
            duration_seconds=(anlz["beatGrid"][-1]["sourceTimeMs"] / 1000.0) if anlz["beatGrid"] else 0.0,
            beat_grid=anlz["beatGrid"], phrases=anlz["phrases"],
            musical_events=events, coverage="structured",
        )
    seed = hashlib.sha256(track_id.encode()).hexdigest()[:16]
    path = out / f"{seed}.trackmodel.json"
    path.write_text(json.dumps(model))
    _ = audio_path
    return {"trackId": track_id, "artifactPath": str(path)}


def handle(msg: dict, out_dir: str | Path = "/tmp/autolight-analysis") -> dict:
    if msg.get("type") == "analyze":
        try:
            job = analyze_job(
                msg["trackId"], msg["audioPath"], msg.get("nativeMetadataPath"), out_dir
            )
            return {"type": "complete", **job}
        except Exception as e:  # worker never crashes the show (§14, §109)
            return {"type": "failed", "trackId": msg.get("trackId"), "error": str(e)}
    if msg.get("type") == "ping":
        return {"type": "pong"}
    return {"type": "error", "error": f"unknown type {msg.get('type')!r}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        print(json.dumps(handle(json.loads(line))), flush=True)


if __name__ == "__main__":
    main()

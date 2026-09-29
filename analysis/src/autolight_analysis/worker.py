"""Framed-JSON stdio worker (§14). Large artifacts via cache files, never IPC blobs."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path


def analyze_job(track_id: str, audio_path: str, native_dir: str | None, out_dir: str | Path) -> dict:
    """Native ANLZ + DSP event extraction → TrackModel artifact file.

    Coverage: FULL when audio decodes (native grid + DSP events), STRUCTURED
    for native-only, ADAPTIVE with neither (§70). Native grid always wins (§19).
    """
    from autolight_analysis import native
    from autolight_analysis.fusion import build_track_model
    from autolight_analysis.schema import validate_track_model
    from autolight_analysis.stems import load_mono_pcm, stem_proxies, spectral_novelty, resample_to_beats
    from autolight_analysis.structure import detect_builds, detect_drops

    anlz = native.extract_anlz(native_dir) if native_dir else None
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    if anlz is None:
        model = build_track_model(
            track_id=track_id, analyzer_version="0.1.0", duration_seconds=0.0,
            beat_grid=[], phrases=[], musical_events=[], coverage="adaptive",
        )
        problems = validate_track_model(model)
        if problems:
            raise ValueError(f"contract violations: {problems[:3]}")
    else:
        grid = anlz["beatGrid"]
        n = len(grid)
        phrases = anlz["phrases"]
        try:
            mono, rate = load_mono_pcm(audio_path)
            stems = stem_proxies(mono, rate)
            energy = resample_to_beats(stems["mid"] + stems["high"], n)
            bass = resample_to_beats(stems["bass"], n)
            drum = resample_to_beats(stems["low_mid"] + stems["high"], n)
            novelty = resample_to_beats(spectral_novelty(mono), n)
            silence = [1.0 if e < 0.05 * (max(energy) or 1.0) else 0.0 for e in energy]
            beats = [i + 1 for i in range(n)]
            kinds = [next((p["kind"] for p in phrases if p["startBeat"] <= b < p["endBeat"]), "unknown") for b in beats]
            builds = detect_builds(beats, energy, drum, kinds)
            events = detect_drops(beats, bass, drum, energy, novelty, builds, kinds, silence)
            for b in builds:
                events.append({"type": "build-start", "beat": b["beat"], "endBeat": b.get("impactBeat"),
                               "confidence": b["confidence"], "strength": b["strength"]})
            events.sort(key=lambda e: e["beat"])
            coverage = "full"
        except Exception:
            events = []
            coverage = "structured"
        model = build_track_model(
            track_id=track_id, analyzer_version="0.1.0",
            duration_seconds=(grid[-1]["sourceTimeMs"] / 1000.0) if grid else 0.0,
            beat_grid=grid, phrases=phrases,
            musical_events=events, coverage=coverage,
        )
        # Beat-This cross-check (§17): flag disagreement, never replace grid.
        from autolight_analysis.metrical import grid_warning, ml_downbeats
        try:
            ml = ml_downbeats(audio_path)
            native_times = [b["sourceTimeMs"] / 1000.0 for b in grid[:8]]
            if ml is not None and grid_warning(native_times, ml[:8], tol=0.05):
                events.append({"type": "section-transition", "beat": 1, "confidence": 0.5})
                model = {**model, "musicalEvents": model["musicalEvents"] + [
                    {"type": "section-transition", "beat": 1, "confidence": 0.5}]}
        except Exception:
            pass  # ML cross-check is advisory; native pipeline stands alone
        problems = validate_track_model(model)
        if problems:
            raise ValueError(f"contract violations: {problems[:3]}")
    seed = hashlib.sha256(track_id.encode()).hexdigest()[:16]
    path = out / f"{seed}.trackmodel.json"
    path.write_text(json.dumps(model))
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

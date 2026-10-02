"""Framed-JSON stdio worker (T-ANA-01, T-ANA-04, T-ANA-11, spec 14).

Native ANLZ + canonical decode + ML + DSP event extraction → TrackModel
artifact file. Coverage: FULL when audio decodes and ML ran, STRUCTURED for
native-only, ADAPTIVE with neither (spec 70); readiness is computed from the
input map only, never set by hand (T-ANA-15). Native grid always wins timing
(spec 19). A nonexistent file returns typed ``failed`` with reason
``audio-missing``, not ``complete`` (T-ANA-04).
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


def analyze_job(
    track_id: str,
    audio_path: str,
    native_dir: str | None,
    out_dir: str | Path,
    config: dict | None = None,
) -> dict:
    """Native ANLZ + DSP event extraction → TrackModel artifact file."""
    import warnings

    from autolight_analysis import config as cfg
    from autolight_analysis.artifacts import (
        analyzer_version,
        config_hash,
        default_cache_dir,
    )
    from autolight_analysis.fusion import fuse_sections
    from autolight_analysis.readiness import blank_inputs
    from autolight_analysis.schema import validate_track_model
    from autolight_analysis.stems import select_stems
    from autolight_analysis.structure import detect_builds, detect_drops

    cfg.apply_overrides(config)
    try:
        analyzer_v = analyzer_version()
        chash = config_hash(config)
        cache_dir = cfg.get("analysis.cacheDir", "")
        if cache_dir in ("", "<userData>/analysis-cache"):
            cache = default_cache_dir()
        else:
            cache = Path(cache_dir or "")
        default_out = "/tmp/autolight-analysis"  # noqa: S108 - documented local fallback
        out = cache if str(out_dir) in ("", default_out) else Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        inputs = blank_inputs()

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            from autolight_analysis import native

            try:
                anlz = native.extract_anlz(native_dir) if native_dir else None
            except (FileNotFoundError, NotADirectoryError, ValueError) as e:
                return _failed(
                    track_id, f"native-unreadable: {e}", inputs, analyzer_v, out, chash
                )
            if anlz is None and native_dir:
                _mark(inputs, "native.rekordbox.grid", "absent", "no ANLZ found")
        if anlz is None:
            if audio_path and Path(audio_path).is_file():
                return _audio_only(track_id, audio_path, out, inputs, analyzer_v, chash)
            return _failed(
                track_id,
                "audio-missing: no ANLZ and no readable audio",
                inputs,
                analyzer_v,
                out,
                chash,
            )

        grid = anlz["beatGrid"]
        n = len(grid)
        phrases = anlz["phrases"]
        beat_times = [b["sourceTimeMs"] / 1000.0 for b in grid]
        beat_in_bar = [b.get("beatInBar", (i % 4) + 1) for i, b in enumerate(grid)]
        _mark(inputs, "native.rekordbox.grid", "present", version=f"{n}-beats")
        if phrases:
            _mark(inputs, "native.rekordbox.pssi", "present")
            for p in phrases:
                p.setdefault("evidence", [f"rekordbox:PSSI:{p.get('rawLabel', '')}"])
        else:
            _mark(inputs, "native.rekordbox.pssi", "absent", "no PSSI entries")
        if anlz.get("cues"):
            _mark(inputs, "native.rekordbox.cues", "present")
        else:
            _mark(inputs, "native.rekordbox.cues", "absent", "no PCO2 cues")
        has_waves = (
            anlz.get("hasWaveform")
            or anlz.get("hasColorWaveform")
            or anlz.get("has3Band")
        )
        if has_waves:
            _mark(inputs, "native.rekordbox.waveforms", "present")
        else:
            _mark(inputs, "native.rekordbox.waveforms", "absent", "no PWAV/PWV")
        _mark(
            inputs,
            "native.rekordbox.vocal",
            "present" if anlz.get("hasVocals") else "absent",
            "" if anlz.get("hasVocals") else "no PWVC",
        )
        # No readable audio with ANLZ: STRUCTURED from native data (spec 70).
        if not audio_path or not Path(audio_path).is_file():
            model = _model(
                track_id,
                analyzer_v,
                grid,
                phrases,
                [],
                inputs,
                duration=beat_times[-1] if beat_times else 0.0,
                coverage_hint="structured",
            )
            return _store(track_id, model, out, None, chash, analyzer_v)
        from autolight_analysis.decode import canonical_pcm, mono_from_canonical

        try:
            resampler = cfg.get("analysis.decode.resampler", "soxr")
            raw, meta = canonical_pcm(audio_path, out, resampler)
        except (OSError, ValueError, subprocess.CalledProcessError) as e:
            _mark(inputs, "source.audio", "failed", str(e)[:120])
            model = _model(
                track_id,
                analyzer_v,
                grid,
                phrases,
                [],
                inputs,
                duration=beat_times[-1] if beat_times else 0.0,
                coverage_hint="structured",
            )
            return _store(track_id, model, out, None, chash, analyzer_v)
        _mark(inputs, "source.audio", "present", version=meta.get("ffmpegVersion", ""))
        mono = mono_from_canonical(raw, meta)
        rate = meta["rate"]
        duration = meta["durationSeconds"]

        from autolight_analysis.allinone import (
            allinone_available,
            analyze_full,
            ml_sections,
            select_device,
        )
        from autolight_analysis.features import aggregate_to_beats, frame_series
        from autolight_analysis.harmony import (
            cqt_chroma,
            estimate_key,
            harmonic_tension,
        )
        from autolight_analysis.metrical import metrical_vote, ml_beats

        device = select_device(str(cfg.get("analysis.device", "auto")))
        metrical_mode = str(cfg.get("analysis.metrical.mode", "both"))
        invoke = str(cfg.get("analysis.beatthis.invoke", "api"))

        ml_result = None
        ml_error = ""
        if allinone_available() and cfg.get("analysis.ml.enabled", True):
            try:
                from autolight_analysis.decode import canonical_wav

                ml_result = analyze_full(
                    str(canonical_wav(audio_path, out)), device=device
                )
            except (ImportError, OSError, ValueError, RuntimeError) as e:
                ml_error, ml_result = f"{type(e).__name__}: {e}", None
        if ml_result:
            _mark(inputs, "ml.allinone.structure", "present", version=device)
            _mark(inputs, "ml.allinone.metrical", "present", version=device)
            if ml_result.get("activations") is not None:
                _mark(
                    inputs,
                    "ml.allinone.activations",
                    "present",
                    "100 Hz activations retained",
                )
            else:
                _mark(
                    inputs,
                    "ml.allinone.activations",
                    "absent",
                    "model returned no activations",
                )
            if ml_result.get("embeddings") is not None:
                _mark(inputs, "ml.allinone.embeddings", "present")
            else:
                _mark(
                    inputs,
                    "ml.allinone.embeddings",
                    "absent",
                    "model returned no embeddings",
                )
        else:
            status = "absent" if not ml_error else "failed"
            _mark(
                inputs,
                "ml.allinone.structure",
                status,
                ml_error or "all-in-one unavailable",
            )
            for key in (
                "ml.allinone.metrical",
                "ml.allinone.activations",
                "ml.allinone.embeddings",
            ):
                _mark(inputs, key, "absent", "no ML session")

        stems_mode = cfg.get("analysis.stems.mode", "fusion")
        aio_stems = None
        if ml_result and ml_result.get("stems"):
            import numpy as np

            aio_stems = {
                k: np.asarray(v, dtype=float) for k, v in ml_result["stems"].items()
            }
            _mark(inputs, "ml.stems", "present", "all-in-one separation")
        else:
            _mark(
                inputs,
                "ml.stems",
                "absent",
                "no separation; band proxies used"
                if stems_mode == "fusion"
                else "unavailable",
            )
        stems, stem_source = select_stems(mono, rate, str(stems_mode), aio_stems)
        proxy_here = stem_source == "dsp.stemProxies"
        _mark(
            inputs,
            "dsp.stemProxies",
            "present" if proxy_here else "absent",
            "FFT band proxies" if proxy_here else "real stems used",
        )
        frame_size = int(cfg.get("analysis.frame.size", 2048))
        frame_hop = int(cfg.get("analysis.frame.hop", 512))
        frames: dict = frame_series(
            mono, rate, frame=frame_size, hop=frame_hop, stem_envelopes=stems
        )
        frames["stem_source"] = stem_source  # recorded, stripped before artifact
        _mark(inputs, "dsp.features", "present", "22 spec-18 features")
        chroma = cqt_chroma(mono, rate)
        key = estimate_key(chroma)
        tension_frames = harmonic_tension(chroma, key)
        subdivisions = int(cfg.get("analysis.aggregate.subdivisions", 4))
        agg = aggregate_to_beats(
            {k: v for k, v in frames.items() if k != "stem_source"},
            beat_times,
            rate,
            frame_hop,
            subdivisions,
        )
        tension_beats = _align_like(tension_frames, len(beat_times))

        ml_secs = ml_sections(ml_result["segments"], beat_times) if ml_result else []
        ml_boundaries = {s["startBeat"] for s in ml_secs}
        struct_mode = str(cfg.get("analysis.structure.mode", "fused"))
        fused = fuse_sections(
            phrases,
            ml_secs,
            feature_boundaries=_feature_boundaries(agg),
            mode=struct_mode,
        )
        _mark(inputs, "fusion.structure", "present", struct_mode)

        kinds = [
            next(
                (p["kind"] for p in fused if p["startBeat"] <= b < p["endBeat"]),
                "unknown",
            )
            for b in range(1, n + 1)
        ]
        energy = agg["beat"]["rms"]
        bass = agg["beat"]["stem_bass"]
        drum = agg["beat"]["stem_drum"]
        vocal = agg["beat"]["stem_vocal"]
        fills = [p["startBeat"] for p in fused if p.get("fill")]
        builds = detect_builds(
            list(range(1, n + 1)),
            energy,
            drum,
            kinds,
            centroid=agg["beat"]["centroid"],
            onset_density=agg["beat"]["onset_density"],
            bass=bass,
            tension=tension_beats,
            ml_boundaries=ml_boundaries,
            beat_in_bar=beat_in_bar,
        )
        events = detect_drops(
            list(range(1, n + 1)),
            bass,
            drum,
            energy,
            agg["beat"]["novelty"],
            builds,
            kinds,
            agg["beat"]["silence"],
            ml_boundaries,
            beat_in_bar=beat_in_bar,
            vocal=vocal,
            fills=fills,
            onset=agg["beat"]["onset_strength"],
        )
        # Build intensification: second-half strength jump inside long builds.
        for b in builds:
            span = (b.get("impactBeat", b["beat"]) or b["beat"]) - b["beat"]
            if span >= 16:
                events.append(
                    {
                        "type": "build-intensification",
                        "beat": b["beat"] + span // 2,
                        "endBeat": b.get("impactBeat"),
                        "confidence": min(1.0, b["confidence"]),
                        "strength": b["strength"],
                        "evidence": [*b.get("evidence", []), "build:second-half"],
                    }
                )
        for b in builds:
            events.append(
                {
                    "type": "build-start",
                    "beat": b["beat"],
                    "endBeat": b.get("impactBeat"),
                    "confidence": b["confidence"],
                    "strength": b["strength"],
                    "evidence": b.get("evidence", []),
                }
            )
        events.sort(key=lambda e: e["beat"])
        _mark(
            inputs,
            "events.detectors",
            "present",
            f"{len(events)} events, 19-type vocabulary",
        )

        beat_this = None
        if metrical_mode in ("beat-this", "both"):
            try:
                beat_this = ml_beats(audio_path, invoke, device)
                reason = invoke if beat_this else "no output"
                _mark(
                    inputs,
                    "ml.beatthis",
                    "present" if beat_this else "absent",
                    reason,
                )
            except (
                ImportError,
                OSError,
                ValueError,
                RuntimeError,
                subprocess.CalledProcessError,
            ) as e:
                _mark(inputs, "ml.beatthis", "failed", f"{type(e).__name__}"[:120])
        else:
            _mark(inputs, "ml.beatthis", "absent", f"mode={metrical_mode}")
        aio_metrical = (
            {"beats": ml_result["beats"]}
            if ml_result and ml_result.get("beats")
            else None
        )
        tolerance_ms = cfg.get("analysis.gridWarning.toleranceMs", 50)
        min_anchors = cfg.get("analysis.gridWarning.minAnchors", 32)
        vote = metrical_vote(
            beat_times,
            beat_this,
            aio_metrical,
            metrical_mode,
            tolerance_ms,
            min_anchors,
        )

        beat_features = [
            {"beat": i + 1, **{k: agg["beat"][k][i] for k in agg["beat"]}}
            for i in range(n)
        ]
        feature_ref = _write_features(out, track_id, frames, agg, ml_result, chash)
        model = _model(
            track_id,
            analyzer_v,
            grid,
            fused,
            events,
            inputs,
            duration=duration,
            grid_warnings=vote["warnings"],
            beat_features=beat_features,
            frame_features_ref=feature_ref,
            key=key,
            tempo=ml_result.get("tempo") if ml_result else None,
        )
        problems = validate_track_model(model)
        if problems:
            raise ValueError(f"contract violations: {problems[:3]}")
        return _store(track_id, model, out, audio_path, chash, analyzer_v)
    finally:
        cfg.reset_overrides()


def _mark(
    inputs: dict, key: str, status: str, reason: str = "", version: str = ""
) -> None:
    from autolight_analysis.readiness import input_entry

    inputs[key] = input_entry(status, reason, version)


def _model(
    track_id: str,
    analyzer_v: str,
    grid: list,
    phrases: list,
    events: list,
    inputs: dict,
    duration: float,
    coverage_hint: str = "",
    grid_warnings: list | None = None,
    beat_features: list | None = None,
    frame_features_ref: dict | None = None,
    key: dict | None = None,
    tempo: float | None = None,
) -> dict:
    from autolight_analysis.fusion import build_track_model
    from autolight_analysis.readiness import compute_readiness

    level = compute_readiness(inputs)
    coverage = coverage_hint or level
    if coverage != level:
        coverage = level  # readiness is computed, never set by hand
    model = build_track_model(
        track_id=track_id,
        analyzer_version=analyzer_v,
        duration_seconds=duration,
        beat_grid=grid,
        phrases=phrases,
        musical_events=events,
        coverage=coverage,
        inputs=dict(inputs),
        grid_warnings=grid_warnings,
        beat_features=beat_features,
        frame_features_ref=frame_features_ref,
        key=key,
    )
    if tempo is not None:
        model["tempo"] = tempo
    return model


def _store(
    track_id: str,
    model: dict,
    out: Path,
    audio_path: str | None,
    chash: str,
    analyzer_v: str,
) -> dict:
    from autolight_analysis.artifacts import (
        artifact_name,
        atomic_write,
        source_fingerprint,
    )
    from autolight_analysis.schema import validate_track_model

    problems = validate_track_model(model)
    if problems:
        raise ValueError(f"contract violations: {problems[:3]}")
    try:
        if audio_path and Path(audio_path).is_file():
            fp = source_fingerprint(audio_path)
        else:
            fp = hashlib.sha256(track_id.encode()).hexdigest()
    except OSError:
        fp = hashlib.sha256(track_id.encode()).hexdigest()
    name = artifact_name(fp, 2, analyzer_v, chash)
    path = atomic_write(out / name, json.dumps(model))
    return {"trackId": track_id, "artifactPath": str(path)}


def _failed(
    _track_id: str,
    reason: str,
    _inputs: dict,
    _analyzer_v: str,
    _out: Path,
    _chash: str,
) -> dict:
    raise ValueError(reason)


def _audio_only(
    track_id: str, audio_path: str, out: Path, inputs: dict, analyzer_v: str, chash: str
) -> dict:
    """Readable audio with no ANLZ: full pipeline, ML grid labelled non-DJ."""
    from autolight_analysis import config as cfg
    from autolight_analysis.allinone import analyze_full, select_device
    from autolight_analysis.decode import canonical_pcm

    _mark(inputs, "native.rekordbox.grid", "absent", "no ANLZ")
    resampler = str(cfg.get("analysis.decode.resampler", "soxr"))
    _raw, meta = canonical_pcm(audio_path, out, resampler)
    _mark(
        inputs,
        "source.audio",
        "present",
        version=str(meta.get("ffmpegVersion", "")),
    )
    device = select_device(str(cfg.get("analysis.device", "auto")))
    ml = analyze_full(audio_path, device=device)
    beats = (ml.get("beats") or []) if ml else []
    if not beats:
        # No grid source at all: honest ADAPTIVE with an empty grid.
        model = _model(
            track_id,
            analyzer_v,
            [],
            [],
            [],
            inputs,
            duration=meta["durationSeconds"],
            coverage_hint="adaptive",
        )
        return _store(track_id, model, out, audio_path, chash, analyzer_v)
    if ml is None:  # unreachable: non-empty beats implies an ml result
        msg = "non-empty beats with no ml result"
        raise RuntimeError(msg)
    grid = [
        {
            "index": i,
            "beatInBar": (i % 4) + 1,
            "sourceTimeMs": t * 1000.0,
            "bpm": float(ml.get("tempo") or 120.0),
            "source": "ml (not a DJ grid)",
        }
        for i, t in enumerate(beats)
    ]
    _mark(inputs, "ml.allinone.metrical", "present", "grid source (non-DJ)")
    model = _model(
        track_id, analyzer_v, grid, [], [], inputs, duration=meta["durationSeconds"]
    )
    return _store(track_id, model, out, audio_path, chash, analyzer_v)


def _feature_boundaries(agg: dict) -> list[int]:
    novelty = agg.get("beat", {}).get("novelty", [])
    peaks = [
        i + 1
        for i in range(1, len(novelty) - 1)
        if novelty[i] > novelty[i - 1]
        and novelty[i] >= novelty[i + 1]
        and novelty[i] > 0.5
    ]
    return peaks[:64]


def _align_like(frames: "object", n: int) -> list[float]:
    import numpy as np

    arr = np.atleast_1d(np.asarray(frames, dtype=float))
    if arr.size == n:
        return arr.tolist()
    if arr.size == 0:
        return [0.0] * n
    idx = np.linspace(0, arr.size - 1, n)
    lo, frac = np.floor(idx).astype(int), idx - np.floor(idx)
    hi = np.minimum(lo + 1, arr.size - 1)
    return (arr[lo] * (1 - frac) + arr[hi] * frac).tolist()


def _write_features(
    out: Path, track_id: str, frames: dict, agg: dict, ml: dict | None, chash: str
) -> dict:
    """Frame series + activations/embeddings sidecar (T-ANA-05, T-ANA-09)."""
    import contextlib

    import numpy as np

    feat = {
        k: np.asarray(v, dtype=float).tolist()
        for k, v in frames.items()
        if k != "stem_source"
    }
    ref: dict = {"stemSource": frames.get("stem_source", "dsp.stemProxies")}
    if ml:
        if ml.get("activations") is not None:
            with contextlib.suppress(TypeError, ValueError, AttributeError):
                ref["activations"] = {
                    k: np.asarray(v).tolist()
                    for k, v in dict(ml["activations"]).items()
                }
                ref["activationFps"] = ml.get("activationFps")
        if ml.get("embeddings") is not None:
            with contextlib.suppress(TypeError, ValueError):
                ref["embeddings"] = np.asarray(ml["embeddings"]).tolist()
    digest = hashlib.sha256((track_id + chash).encode()).hexdigest()[:16]
    path = out / f"{digest}.features.json"
    from autolight_analysis.artifacts import atomic_write

    atomic_write(
        path,
        json.dumps(
            {
                "frames": feat,
                "beat": agg["beat"],
                "subbeat": agg["subbeat"],
                "bar": agg["bar"],
                "ml": ref,
            }
        ),
    )
    ref["artifactPath"] = str(path)
    out_ref: dict = {
        "artifactPath": str(path),
        "stemSource": ref["stemSource"],
    }
    if ref.get("activationFps"):
        out_ref["activationFps"] = ref["activationFps"]
    return out_ref


def handle(msg: dict, out_dir: str | Path = "/tmp/autolight-analysis") -> dict:  # noqa: S108 - documented local fallback; production passes userData cache dir
    if msg.get("type") == "analyze":
        try:
            if not msg.get("audioPath"):
                return {
                    "type": "failed",
                    "trackId": msg.get("trackId"),
                    "reason": "audio-missing",
                }
            job = analyze_job(
                msg["trackId"],
                msg["audioPath"],
                msg.get("nativeMetadataPath"),
                out_dir,
                msg.get("config"),
            )
            return {"type": "complete", **job}
        except Exception as e:  # noqa: BLE001 - top-level job guard: any failure becomes a typed failed frame, never a dead worker (§14, §109)
            text = str(e)
            prefixes = ("audio-missing", "native-unreadable", "dsp-fallback")
            reason = text if text.startswith(prefixes) else f"dsp-fallback: {text}"
            return {
                "type": "failed",
                "trackId": msg.get("trackId"),
                "error": text,
                "reason": reason,
            }
    if msg.get("type") == "ping":
        return {"type": "pong"}
    return {"type": "error", "error": f"unknown type {msg.get('type')!r}"}


def main() -> None:
    """Framed loop: stdout is the protocol, prints go to stderr (T-ANA-01)."""
    from autolight_analysis import config as cfg
    from autolight_analysis.protocol import (
        FrameWriter,
        Heartbeat,
        error_frame,
        frame_id,
        log_event,
        parse_frame,
        protect_stdout,
    )

    fd = protect_stdout()
    writer = FrameWriter(fd)
    beat = Heartbeat(writer, int(cfg.get("analysis.worker.heartbeatMs", 5000)))
    beat.start()
    log_event("worker-start", v=1)
    cancelled: set[str] = set()
    try:
        with open("/dev/stdin") as stdin:
            for line in stdin:
                try:
                    msg = parse_frame(line)
                except Exception as e:  # noqa: BLE001 - malformed frame guard: typed error, worker keeps running (T-ANA-01)
                    writer.write(error_frame(None, "malformed-frame", str(e)))
                    continue
                ident = frame_id(msg)
                mtype = msg.get("type")
                if mtype == "cancel":
                    if ident:
                        cancelled.add(ident)
                    writer.write({"v": 1, "id": ident, "type": "cancelled"})
                    continue
                if ident in cancelled:
                    continue
                if mtype == "ping":
                    writer.write({"v": 1, "id": ident, "type": "pong"})
                    continue
                if mtype == "progress":
                    continue
                if mtype == "analyze":
                    writer.write(
                        {"v": 1, "id": ident, "type": "progress", "stage": "start"}
                    )
                    try:
                        no_audio = not msg.get("audioPath")
                        no_native = not msg.get("nativeMetadataPath")
                        if no_audio and no_native:
                            writer.write(
                                {
                                    "v": 1,
                                    "id": ident,
                                    "type": "failed",
                                    "reason": "audio-missing",
                                }
                            )
                            continue
                        default_out = "/tmp/autolight-analysis"  # noqa: S108 - documented local fallback
                        job = analyze_job(
                            msg.get("trackId", msg.get("id", "unknown")),
                            msg.get("audioPath", ""),
                            msg.get("nativeMetadataPath"),
                            msg.get("outDir", default_out),
                            msg.get("config"),
                        )
                        writer.write({"v": 1, "id": ident, "type": "complete", **job})
                    except Exception as e:  # noqa: BLE001 - per-job guard: typed failed frame, loop survives (T-ANA-01, T-ANA-11)
                        writer.write(
                            {
                                "v": 1,
                                "id": ident,
                                "type": "failed",
                                "reason": str(e)[:300],
                            }
                        )
                    continue
                writer.write(
                    error_frame(ident, "unknown-type", f"unknown type {mtype!r}")
                )
    finally:
        beat.stop()
        log_event("worker-stop")


if __name__ == "__main__":
    main()

from autolight_analysis.structure import detect_builds, detect_drops
from autolight_analysis.schema import validate_track_model
from autolight_analysis.fusion import build_track_model


def _flat(n, v=0.1):
    return [v] * n


def test_build_detected_on_ramp_with_pssi():
    beats = [float(i) for i in range(64)]
    energy = [0.1 + 0.02 * i for i in range(64)]
    drum = [0.1 + 0.01 * i for i in range(64)]
    kinds = ["verse"] * 32 + ["build"] * 32
    builds = detect_builds(beats, energy, drum, kinds)
    assert builds, "rising ramp into PSSI build must produce a build event"
    assert all(b["type"] == "build-start" for b in builds)
    assert all("evidence" in b for b in builds)


def test_no_build_on_flat_energy():
    beats = [float(i) for i in range(64)]
    builds = detect_builds(beats, _flat(64), _flat(64), ["verse"] * 64)
    assert builds == []


def test_drop_needs_convergence_not_single_spike():
    beats = [float(i) for i in range(64)]
    bass = _flat(64) + [0.0] * 0
    drum, energy = _flat(64), _flat(64)
    energy[32] = 5.0  # lone spike, no bass/drum/build/boundary support
    drops = detect_drops(beats, bass, drum, energy, _flat(64), [], ["verse"] * 64)
    assert [d for d in drops if d["type"] == "drop"] == []


def test_drop_on_converging_downbeat():
    beats = [float(i) for i in range(64)]
    bass = _flat(64, 0.2)
    drum = _flat(64, 0.2)
    energy = _flat(64, 0.2)
    for arr in (bass, drum, energy):
        for i in range(32, 64):
            arr[i] = 1.0
    kinds = ["verse"] * 32 + ["chorus"] * 32
    builds = [{"impactBeat": 32.0}]
    drops = detect_drops(beats, bass, drum, energy, _flat(64, 0.05), builds, kinds)
    hits = [d for d in drops if d["type"] == "drop" and d["beat"] == 32.0]
    assert hits, "bass+drum+energy jump on build impact + boundary must fire"
    assert hits[0]["confidence"] >= 0.6


def test_drops_deduped_to_one_per_window():
    beats = [float(i) for i in range(64)]
    bass = _flat(64, 0.2)
    drum = _flat(64, 0.2)
    energy = _flat(64, 0.2)
    for arr in (bass, drum, energy):
        for i in range(16, 64):
            arr[i] = 1.0
    kinds = ["chorus"] * 64
    drops = detect_drops(beats, bass, drum, energy, _flat(64, 0.05), [], kinds)
    hits = [d["beat"] for d in drops if d["type"] == "drop"]
    assert all(b - a >= 8 for a, b in zip(hits, hits[1:])), f"machine-gun drops: {hits}"


def test_events_validate_against_contract():
    beats = [float(i) for i in range(64)]
    energy = [0.1 + 0.02 * i for i in range(64)]
    drum = [0.1 + 0.01 * i for i in range(64)]
    kinds = ["verse"] * 32 + ["build"] * 32
    events = detect_builds(beats, energy, drum, kinds)
    model = build_track_model(
        track_id="t", analyzer_version="0.1.0", duration_seconds=150.0,
        beat_grid=[{"index": i, "beatInBar": (i % 4) + 1, "sourceTimeMs": i * 500.0, "bpm": 120.0} for i in range(64)],
        phrases=[{"kind": "verse", "startBeat": 0, "endBeat": 32}, {"kind": "build", "rawLabel": "Up 1", "startBeat": 32, "endBeat": 64}],
        musical_events=events, coverage="full",
    )
    assert validate_track_model(model) == []

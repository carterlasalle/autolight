"""Full 19-event vocabulary on planted tracks (T-ANA-10, T-ANA-16).

Each planted event must be detected within qa.events.toleranceBeats.
Recall and precision per event type are reported; the pass thresholds live
in T-ANA-16 (test_goldens.py). WEAKEN=1 must turn this suite red.
"""
import math

from autolight_analysis.structure import detect_builds, detect_drops
from autolight_analysis.events import EVENT_TYPES_19
from make_tracks import suite

TOL = 1


def _run():
    data, truth = suite()
    builds = detect_builds(data["beats"], data["energy"], data["drum"],
                           data["kinds"], beat_in_bar=data["beat_in_bar"])
    events = detect_drops(
        data["beats"], data["bass"], data["drum"], data["energy"],
        data["novelty"], builds, data["kinds"], data["silence"],
        data["ml_boundaries"], beat_in_bar=data["beat_in_bar"],
        vocal=data["vocal"], fills=data["fills"], onset=data["onset"])
    # The worker emits builds alongside the drop detectors; mirror that here.
    events = [*events, *builds]
    by_type: dict = {}
    for e in events:
        by_type.setdefault(e["type"], []).append(float(e["beat"]))
    return by_type, truth


def _metrics():
    by_type, truth = _run()
    per_type: dict[str, dict] = {}
    for etype in EVENT_TYPES_19:
        planted = [t["beat"] for t in truth if t["type"] == etype]
        found = by_type.get(etype, [])
        tp = sum(1 for p in planted
                 if any(abs(f - p) <= TOL for f in found))
        recall = tp / len(planted) if planted else math.nan
        fp = sum(1 for f in found
                 if not any(abs(f - p) <= TOL for p in planted))
        precision = tp / (tp + fp) if (tp + fp) else math.nan
        per_type[etype] = {"recall": recall, "precision": precision,
                           "planted": len(planted), "found": len(found)}
    return per_type


def test_every_planted_event_detected_in_tolerance():
    by_type, truth = _run()
    missing = [t for t in truth
               if not any(abs(b - t["beat"]) <= TOL
                          for b in by_type.get(t["type"], []))]
    assert missing == [], f"undetected planted events: {missing}"


def test_recall_and_precision_reported():
    per_type = _metrics()
    planted_types = [k for k, v in per_type.items() if v["planted"] > 0]
    assert planted_types, "the generator planted nothing"
    for etype in planted_types:
        assert per_type[etype]["recall"] == 1.0, (etype, per_type[etype])
    tp = sum(v["recall"] * v["planted"] for v in per_type.values()
             if v["planted"] > 0)
    found = sum(v["found"] for v in per_type.values())
    micro_precision = tp / found if found else 0.0
    assert micro_precision >= 0.9, (micro_precision, per_type)


def test_flat_negative_stays_quiet():
    n = 64
    beats = [float(i + 1) for i in range(n)]
    flat = [0.2] * n
    builds = detect_builds(beats, flat, flat, ["verse"] * n)
    events = detect_drops(beats, flat, flat, flat, [0.05] * n, builds,
                          ["verse"] * n, [0.0] * n, set(),
                          beat_in_bar=[(i % 4) + 1 for i in range(n)])
    assert builds == []
    assert events == []

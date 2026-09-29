"""Beat-grid-anchored musical event extraction (§22-25): builds, drops, fake
drops, breakdowns, fills, silence. Consumes native PSSI phrases + DSP beat
envelopes; every event carries provenance (§19). No thresholds fire a drop
alone — converging signals vote (§24).
"""
from __future__ import annotations

from autolight_analysis.events import build_score, drop_score, is_fake_drop
from autolight_analysis.features import energy_slope


def _beat_index(beat: float, beats: list[float]) -> int:
    return min(range(len(beats)), key=lambda i: abs(beats[i] - beat))


def detect_builds(
    beats: list[float],
    energy: list[float],
    drum: list[float],
    pssi_kinds: list[str],
    windows: tuple[int, ...] = (8, 16, 32),
) -> list[dict]:
    """For each downbeat candidate, score trailing windows (§23).

    Overlapping candidates collapse: keep the strongest per impact beat so a
    32-bar ramp yields one build, not a build every 4 beats.
    """
    best_by_impact: dict[float, dict] = {}
    for n in range(0, len(beats), 4):
        best: dict | None = None
        for w in windows:
            if n - w < 0:
                continue
            seg_e, seg_d = energy[n - w : n], drum[n - w : n]
            pssi_up = any(k == "build" for k in pssi_kinds[max(0, n - w) : n])
            s = build_score(seg_e, energy_slope(seg_d), pssi_up)
            if best is None or s["strength"] > best["strength"]:
                best = {**s, "startBeat": beats[n - w], "impactBeat": beats[n]}
        if best is not None and best["strength"] > 0.05 and best["confidence"] >= 0.5:
            prev = best_by_impact.get(best["impactBeat"])
            if prev is None or best["strength"] > prev["strength"]:
                best_by_impact[best["impactBeat"]] = best
    builds = sorted(best_by_impact.values(), key=lambda b: b["startBeat"])
    # Merge builds whose starts are <8 beats apart: one ramp, not stutter.
    merged: list[dict] = []
    for b in builds:
        if merged and b["startBeat"] - merged[-1]["startBeat"] < 8:
            if b["strength"] > merged[-1]["strength"]:
                merged[-1] = b
            merged[-1]["endBeat"] = max(merged[-1].get("impactBeat"), b.get("impactBeat"))
        else:
            merged.append(b)
    return [
        {"type": "build-start", **b, "beat": b["startBeat"]}
        for b in merged
    ]


def _rel_jump(series: list[float], n: int, span: int = 4) -> float:
    base = max(series[n - span], 0.01)
    return (series[n] - base) / base


def detect_drops(
    beats: list[float],
    bass: list[float],
    drum: list[float],
    energy: list[float],
    novelty: list[float],
    builds: list[dict],
    pssi_kinds: list[str],
    silence: list[float] | None = None,
) -> list[dict]:
    """Converging-signal drops + fake-drop pairs (§24-25)."""
    out: list[dict] = []
    build_beats = {b["impactBeat"] for b in builds}
    for n in range(4, len(beats), 4):
        bj, dj, ej = _rel_jump(bass, n), _rel_jump(drum, n), _rel_jump(energy, n)
        if max(bj, dj, ej) < 0.25:
            continue  # flat loudness isn't a drop — need a genuine jump
        on_boundary = pssi_kinds[n] != pssi_kinds[n - 4] if n < len(pssi_kinds) else False
        near_build = any(abs(beats[n] - bb) <= 8 for bb in build_beats)
        if not (on_boundary or near_build):
            continue  # jumps need structural meaning: boundary or build impact
        s = drop_score(
            bj, dj, ej,
            preceded_by_build=beats[n] in build_beats,
            preceded_by_dip=(silence[n - 4] > 0.5) if silence else False,
            on_downbeat=True,
            section_boundary=on_boundary,
        )
        if s["votes"] < 3 or s["confidence"] < 0.6:
            continue
        beat = beats[n]
        # Fake-drop check: expected impact dissolves into silence, real hit lands
        # 1–4 beats later (§25). Emit the pair; planner holds darkness between.
        if silence is not None and n + 16 < len(beats) and silence[n] > 0.5:
            for m in range(n + 4, min(n + 17, len(beats)), 4):
                later = drop_score(_rel_jump(bass, m), _rel_jump(drum, m),
                                   _rel_jump(energy, m), on_downbeat=True)
                if later["votes"] >= 3 and is_fake_drop(beats[m] - beat, True):
                    out.append({"type": "fake-drop", "beat": beat, "endBeat": beats[m],
                                "confidence": s["confidence"], "strength": s["strength"]})
                    out.append({"type": "drop", "beat": beats[m],
                                "confidence": later["confidence"], "strength": later["strength"]})
                    break
            else:
                out.append({"type": "drop", "beat": beat,
                            "confidence": s["confidence"], "strength": s["strength"]})
        else:
            out.append({"type": "drop", "beat": beat,
                        "confidence": s["confidence"], "strength": s["strength"]})
    # Breakdowns: sustained low energy + PSSI breakdown label.
    for n in range(0, len(beats), 4):
        if n < len(pssi_kinds) and pssi_kinds[n] == "breakdown":
            seg = energy[n : n + 16]
            if seg and max(seg) < 0.4 * (max(energy) or 1.0):
                out.append({"type": "breakdown", "beat": beats[n],
                            "endBeat": beats[min(n + 16, len(beats) - 1)],
                            "confidence": 0.7, "strength": 0.3})
    # Silence / final hit.
    if silence is not None:
        for n in range(0, len(beats), 4):
            if silence[n] > 0.8:
                out.append({"type": "silence", "beat": beats[n], "confidence": 0.9})
                break
    # Restraint: one impact per 8-beat window keeps the strongest (§34).
    drops = [e for e in out if e["type"] == "drop"]
    others = [e for e in out if e["type"] != "drop"]
    kept: list[dict] = []
    for e in sorted(drops, key=lambda e: (-e["confidence"], -e.get("strength", 0))):
        if all(abs(e["beat"] - k["beat"]) >= 8 for k in kept):
            kept.append(e)
    return sorted(others + kept, key=lambda e: e["beat"])

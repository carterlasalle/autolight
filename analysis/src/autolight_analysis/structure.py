"""Beat-grid-anchored musical event extraction (T-ANA-10, spec 22-25).

Consumes native PSSI phrases + ML sections + DSP beat envelopes + vocal and
fill evidence; every event carries provenance (spec 19). No thresholds fire a
drop alone: converging signals vote (spec 24). No restraint inside detectors
(spec 2.3): detectors emit every candidate with confidence; the planner
decides. Candidates are real downbeats from the grid (``beatInBar == 1``).
"""

from __future__ import annotations

from autolight_analysis import config as cfg
from autolight_analysis.events import build_score, drop_score
from autolight_analysis.features import energy_slope


def downbeats(beats: list[float], beat_in_bar: list[int] | None) -> list[int]:
    """Indices of real downbeats (T-ANA-10: never array index multiples)."""
    if beat_in_bar and len(beat_in_bar) == len(beats):
        return [i for i, b in enumerate(beat_in_bar) if b == 1]
    return list(range(0, len(beats), 4))


def _rise_start(seg: list[float]) -> int:
    """Index in seg where its final contiguous rise begins.

    A plateau (equal neighbours) terminates the walk, so a long window that
    merely ends after a ramp cannot inflate its score with flat samples.
    """
    j = len(seg) - 1
    while j > 0 and seg[j] > seg[j - 1] * 1.02:
        j -= 1
    return j


def detect_builds(
    beats: list[float] | list[int],
    energy: list[float],
    drum: list[float],
    pssi_kinds: list[str],
    windows: tuple[int, ...] = (8, 16, 32),
    centroid: list[float] | None = None,
    onset_density: list[float] | None = None,
    bass: list[float] | None = None,
    tension: list[float] | None = None,
    ml_boundaries: set[int] | None = None,
    beat_in_bar: list[int] | None = None,
) -> list[dict]:
    """For each downbeat candidate, score the final rise of trailing windows.

    Every window is trimmed to the contiguous rise that reaches the impact;
    the winner per impact is the steepest relative climb (scale free); starts
    under 8 beats apart merge into one ramp. Nine spec 23 features feed
    ``build_score``: energy, drum-density, high frequency, centroid,
    onset-density, bass movement, PSSI Up, boundary confidence, tension.
    """
    wins = tuple(cfg.get("analysis.build.windows", list(windows)))
    min_strength = float(cfg.get("analysis.build.minStrength", 0.05))
    min_conf = float(cfg.get("analysis.build.minConfidence", 0.5))
    best_by_impact: dict[float, dict] = {}
    downs = set(downbeats(list(beats), beat_in_bar))
    for n in range(len(beats)):
        if n not in downs:
            continue
        best: dict | None = None
        for w in wins:
            if n - w < 0:
                continue
            seg = energy[n - w : n]
            trim = _rise_start(seg)
            length = len(seg) - trim
            if length < 4:
                continue
            if seg[-1] <= seg[trim] * 1.05:
                continue  # no net rise worth calling a build
            pssi_up = any(k == "build" for k in pssi_kinds[max(0, n - w + trim) : n])
            s = build_score(
                seg[trim:],
                energy_slope(drum[n - w + trim : n]),
                pssi_up,
                centroid_slope=_slope(centroid, n, length),
                onset_slope=_slope(onset_density, n, length),
                bass_movement=_slope(bass, n, length),
                boundary_confidence=(
                    1.0
                    if (
                        ml_boundaries
                        and any(
                            abs(beats[n - w + trim + k] - b) <= 4
                            for k in range(length)
                            for b in ml_boundaries
                        )
                    )
                    else 0.0
                ),
                tension_slope=_slope(tension, n, length),
            )
            rel = s["strength"] * 4.0 / length
            if best is None or (length, rel) > (best["len"], best["rel"]):
                best = {
                    **s,
                    "rel": rel,
                    "len": length,
                    "startBeat": beats[n - w + trim],
                    "impactBeat": beats[n],
                }
        if (
            best is not None
            and best["strength"] > min_strength
            and best["confidence"] >= min_conf
        ):
            prev = best_by_impact.get(best["impactBeat"])
            if prev is None or (best["len"], best["rel"]) > (prev["len"], prev["rel"]):
                best_by_impact[best["impactBeat"]] = best
    builds = sorted(best_by_impact.values(), key=lambda b: b["startBeat"])
    merged: list[dict] = []
    for b in builds:
        if merged and b["startBeat"] - merged[-1]["startBeat"] < 8:
            if (b["len"], b["rel"]) > (merged[-1]["len"], merged[-1]["rel"]):
                merged[-1] = b
            merged[-1]["endBeat"] = max(
                merged[-1].get("impactBeat") or 0, b.get("impactBeat") or 0
            )
        else:
            merged.append(b)
    for b in merged:
        b.pop("rel", None)
        b.pop("len", None)
    return [{"type": "build-start", **b, "beat": b["startBeat"]} for b in merged]


def _rel_jump(series: list[float], n: int, span: int = 4) -> float:
    base = max(series[n - span], 0.01)
    return (series[n] - base) / base


def _slope(series: list[float] | None, n: int, w: int) -> float:
    if not series or n - w < 0:
        return 0.0
    return energy_slope(list(series[n - w : n]))


def _fake_pairs(
    beats: list[float],
    beat_in_bar: list[int] | None,
    silence: list[float] | None,
    vocal: list[float] | None,
    energy: list[float],
    bass: list[float],
    drum: list[float],
    min_votes: int,
) -> tuple[list[dict], set[int], set[int]]:
    """Spec 25: expected impact withheld, real slam 1 to 4 beats later.

    Withheld means silence at the expected point, a vocal fake, or held
    tension (energy pulled back from the preceding level while no slam fires).
    The real impact must be decisive on its own. Returns (events, start
    indexes, impact indexes).
    """
    pairs: list[dict] = []
    starts: set[int] = set()
    impacts: set[int] = set()
    if not energy:
        return pairs, starts, impacts
    peak = max(energy) or 1.0
    for n in downbeats(list(beats), beat_in_bar):
        if n < 4 or n + 4 >= len(beats):
            continue
        sil = silence[n] if silence and n < len(silence) else 0.0
        before = max(energy[n - 16 : n - 4]) if n >= 16 else max(energy[:n] or [0.0])
        approach = max(energy[max(0, n - 8) : max(1, n - 4)] or [0.0])
        if before < 0.5 * peak or approach < 0.5 * before:
            continue  # spec 25 pair follows a recent build/plateau approach
        withheld = sil > 0.5
        variant = "silence"
        if not withheld and vocal is not None and n < len(vocal):
            vmax = max(vocal) or 1.0
            if (
                vocal[n] > 0.5 * vmax
                and energy[n] < 0.6 * peak
                and energy[n] <= before * 1.2
            ):
                withheld, variant = True, "vocal-fake"
        if not withheld and before >= 0.5 * peak and energy[n] < 0.5 * before:
            withheld, variant = True, "held-tension"
        if not withheld:
            continue
        for m in range(n + 1, min(n + 5, len(beats))):
            gap = beats[m] - beats[n]
            if gap > 4:
                break
            if gap < 1:
                continue
            bj, dj, ej = _rel_jump(bass, m), _rel_jump(drum, m), _rel_jump(energy, m)
            if max(bj, dj, ej) < 1.0:
                continue
            later = drop_score(bj, dj, ej, on_downbeat=False)
            if later["votes"] < min_votes:
                continue
            pairs.append(
                {
                    "type": "fake-drop",
                    "beat": beats[n],
                    "endBeat": beats[m],
                    "confidence": max(0.6, later["confidence"]),
                    "strength": min(1.0, max(bj, dj, ej) / 4.0),
                    "evidence": ["faketype:" + variant, "impact:withheld"],
                    "fakeImpactBeat": beats[n],
                    "actualImpactBeat": beats[m],
                    "variant": variant,
                }
            )
            pairs.append(
                {
                    "type": "drop",
                    "beat": beats[m],
                    "confidence": later["confidence"],
                    "strength": later["strength"],
                    "evidence": [*later["evidence"], "fakepair:actual"],
                }
            )
            starts.add(n)
            impacts.add(m)
            break
    return pairs, starts, impacts


def detect_drops(
    beats: list[float] | list[int],
    bass: list[float],
    drum: list[float],
    energy: list[float],
    novelty: list[float],
    builds: list[dict],
    pssi_kinds: list[str],
    silence: list[float] | None = None,
    ml_boundaries: set[int] | None = None,
    beat_in_bar: list[int] | None = None,
    vocal: list[float] | None = None,
    fills: list[int] | None = None,
    onset: list[float] | None = None,
) -> list[dict]:
    """Converging-signal drops + fake-drop pairs (spec 24-25, T-ANA-10)."""
    min_jump = float(cfg.get("analysis.drop.minJump", 0.25))
    min_votes = int(cfg.get("analysis.drop.minVotes", 3))
    min_conf = float(cfg.get("analysis.drop.minConfidence", 0.6))
    out: list[dict] = []
    build_beats = {b["impactBeat"] for b in builds}
    ml = ml_boundaries or set()
    pair_events, pair_starts, _pair_impacts = _fake_pairs(
        list(beats), beat_in_bar, silence, vocal, energy, bass, drum, min_votes
    )
    out.extend(pair_events)
    emitted = [float(e["beat"]) for e in pair_events if e["type"] == "drop"]
    for n in downbeats(list(beats), beat_in_bar):
        if n < 4 or n in pair_starts:
            continue
        bj, dj, ej = _rel_jump(bass, n), _rel_jump(drum, n), _rel_jump(energy, n)
        nj = _rel_jump(novelty, n)
        oj = _rel_jump(list(onset) if onset else novelty, n)
        if max(bj, dj, ej, nj) < min_jump:
            continue  # flat loudness is not a drop: need a genuine jump
        on_boundary = (
            pssi_kinds[n] != pssi_kinds[n - 4] if n < len(pssi_kinds) else False
        )
        ml_hit = any(abs(beats[n] - b) <= 4 for b in ml)
        near_build = any(abs(beats[n] - bb) <= 8 for bb in build_beats)
        if not (on_boundary or near_build or ml_hit):
            continue  # jumps need structural meaning: boundary, build, or ML
        s = drop_score(
            bj,
            dj,
            ej,
            preceded_by_build=beats[n] in build_beats,
            preceded_by_dip=(silence[n - 4] > 0.5) if silence else False,
            on_downbeat=True,
            section_boundary=on_boundary or ml_hit,
            onset_peak=oj > min_jump,
            novelty_peak=nj > min_jump,
            pssi_transition=on_boundary,
        )
        if s["votes"] < min_votes or s["confidence"] < min_conf:
            # Lone-jump downbeats (strong jump, no build or boundary vote yet)
            # still count when the jump itself is decisive.
            if max(bj, dj, ej) < 2.0 or not (on_boundary or ml_hit):
                continue
            s = {
                **s,
                "votes": max(s["votes"], min_votes),
                "confidence": max(s["confidence"], min_conf),
                "evidence": [*s["evidence"], "jump:decisive"],
            }
        no_context = not (
            near_build
            or beats[n] in build_beats
            or ml_hit
            or (silence and silence[n - 4] > 0.5)
        )
        # A boundary-only jump with no build, dip or ML context needs
        # decisive agreement (spec 24 lists a preceding build as input).
        if no_context and s["confidence"] < 0.8:
            continue
        if any(abs(beats[n] - d) < 8 for d in emitted):
            continue  # one impact per 8-beat window across pairs and candidates
        emitted.append(float(beats[n]))
        out.append(
            {
                "type": "drop",
                "beat": beats[n],
                "confidence": s["confidence"],
                "strength": s["strength"],
                "evidence": s["evidence"],
            }
        )
    drop_beats = sorted(float(e["beat"]) for e in out if e["type"] == "drop")
    fake_beats = {float(e["beat"]) for e in pair_events if e["type"] == "fake-drop"}
    out += _secondary_events(
        beats,
        beat_in_bar,
        energy,
        bass,
        drum,
        vocal,
        novelty,
        onset,
        silence,
        pssi_kinds,
        fills,
        drop_beats,
        fake_beats,
    )
    return _dedupe(sorted(out, key=lambda e: e["beat"]))


def _dedupe(events: list[dict]) -> list[dict]:
    seen: set[tuple[str, float]] = set()
    out: list[dict] = []
    for e in events:
        key = (e["type"], float(e["beat"]))
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def _secondary_events(
    beats: list,
    beat_in_bar: list[int] | None,
    energy: list[float],
    bass: list[float],
    drum: list[float],
    vocal: list[float] | None,
    novelty: list[float],
    onset: list[float] | None,
    silence: list[float] | None,
    pssi_kinds: list[str],
    fills: list[int] | None,
    drop_beats: list[float],
    fake_beats: set[float],
) -> list[dict]:
    """All remaining spec 22 detectors (T-ANA-10): transitions, re-entries,
    vocal entry/exit, fills, pauses, silences, transients, final hit, outro,
    predrop and drop continuation."""
    out: list[dict] = []
    downs = downbeats(list(beats), beat_in_bar)
    peak = max(energy) or 1.0
    for n in downs:
        if n >= 4 and n < len(pssi_kinds) and pssi_kinds[n] != pssi_kinds[n - 1]:
            big = pssi_kinds[n] in ("drop", "chorus", "breakdown", "build")
            out.append(
                {
                    "type": (
                        "major-section-transition" if big else "minor-phrase-transition"
                    ),
                    "beat": beats[n],
                    "confidence": 0.85 if big else 0.7,
                    "strength": 0.8 if big else 0.4,
                    "evidence": [f"rekordbox:PSSI:{pssi_kinds[n]}"],
                }
            )
    # One breakdown per run: the section start, not every downbeat inside it.
    in_breakdown = False
    for n in downs:
        kind = pssi_kinds[n] if n < len(pssi_kinds) else ""
        if kind != "breakdown":
            in_breakdown = False
            continue
        if in_breakdown:
            continue
        seg = energy[n : n + 16]
        if seg and max(seg) < 0.4 * peak:
            out.append(
                {
                    "type": "breakdown",
                    "beat": beats[n],
                    "endBeat": beats[min(n + 15, len(beats) - 1)],
                    "confidence": 0.7,
                    "strength": 0.3,
                    "evidence": ["rekordbox:PSSI:breakdown", "energy:low"],
                }
            )
        in_breakdown = True
    for stem, etype in ((bass, "bass-re-entry"), (drum, "drum-re-entry")):
        for n in downs:
            if (
                n >= 8
                and max(stem[n - 8 : n]) < 0.3 * (max(stem) or 1.0)
                and _rel_jump(stem, n) > 0.5
            ):
                out.append(
                    {
                        "type": etype,
                        "beat": beats[n],
                        "confidence": 0.75,
                        "strength": 0.6,
                        "evidence": [f"{etype.split('-')[0]}:re-entry"],
                    }
                )
    if vocal:
        vmax = max(vocal) or 1.0
        active = [v > 0.4 * vmax for v in vocal]
        for n in downs:
            if n >= 4 and not any(active[n - 4 : n]) and any(active[n : n + 4]):
                out.append(
                    {
                        "type": "vocal-entry",
                        "beat": beats[n],
                        "confidence": 0.7,
                        "strength": 0.4,
                        "evidence": ["vocal:entry"],
                    }
                )
            if n >= 4 and any(active[n - 4 : n]) and not any(active[n : n + 4]):
                out.append(
                    {
                        "type": "vocal-exit",
                        "beat": beats[n],
                        "confidence": 0.7,
                        "strength": 0.4,
                        "evidence": ["vocal:exit"],
                    }
                )
    for n in downs:
        filled = fills is not None and n in fills
        dense = (
            onset is not None
            and n >= 4
            and sum(1 for o in onset[n - 4 : n] if o > 0.5) >= 3
        )
        if filled or dense:
            out.append(
                {
                    "type": "fill",
                    "beat": beats[n],
                    "confidence": 0.7,
                    "strength": 0.5,
                    "evidence": ["rekordbox:PSSI:fill" if filled else "onset:dense"],
                }
            )
    if silence is not None:
        for n in downs:
            if n + 4 < len(silence) and all(s > 0.8 for s in silence[n : n + 4]):
                out.append(
                    {
                        "type": "silence",
                        "beat": beats[n],
                        "confidence": 0.9,
                        "strength": 0.5,
                        "evidence": ["energy:silence"],
                    }
                )
                break
        for n in downs:
            if n + 2 < len(silence) and all(s > 0.8 for s in silence[n : n + 2]):
                if not any(
                    e["type"] == "silence" and e["beat"] == beats[n] for e in out
                ):
                    out.append(
                        {
                            "type": "pause",
                            "beat": beats[n],
                            "confidence": 0.6,
                            "strength": 0.3,
                            "evidence": ["energy:pause"],
                        }
                    )
                break
    for n in range(len(beats)):
        if n >= 2 and _rel_jump(novelty, n, span=2) > 1.5:
            out.append(
                {
                    "type": "large-transient",
                    "beat": beats[n],
                    "confidence": 0.65,
                    "strength": 0.7,
                    "evidence": ["novelty:spike"],
                }
            )
            break
    kinds = pssi_kinds
    if kinds and kinds[-1] in ("outro", "chorus", "drop") and len(beats) > 8:
        out.append(
            {
                "type": "final-hit",
                "beat": beats[-1],
                "confidence": 0.6,
                "strength": 0.8,
                "evidence": ["structure:track-end"],
            }
        )
        out.append(
            {
                "type": "outro-release",
                "beat": beats[-4],
                "endBeat": beats[-1],
                "confidence": 0.6,
                "strength": 0.4,
                "evidence": ["structure:outro"],
            }
        )
    # Predrop: the last downbeat before a real impact, never a fake-drop point.
    for n in downs:
        if beats[n] in fake_beats:
            continue
        if any(beats[n] < d <= beats[n] + 4 for d in drop_beats):
            out.append(
                {
                    "type": "predrop",
                    "beat": beats[n],
                    "confidence": 0.65,
                    "strength": 0.5,
                    "evidence": ["drop:imminent"],
                }
            )
            break
    # Continuation: a real drop followed by sustained energy for 8 beats.
    for d in drop_beats:
        idx = min(range(len(beats)), key=lambda i: abs(beats[i] - d))
        seg = energy[idx : idx + 8]
        if seg and max(seg) >= 0.75 * peak:
            out.append(
                {
                    "type": "drop-continuation",
                    "beat": beats[idx],
                    "endBeat": beats[min(idx + 8, len(beats) - 1)],
                    "confidence": 0.6,
                    "strength": 0.5,
                    "evidence": ["drop:sustain"],
                }
            )
    return out

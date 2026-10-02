"""Build/drop/fake-drop detectors (T-ANA-10, spec 22-25).

Emits every spec 22 event relevant to offline analysis with ``beat``,
``endBeat`` where relevant, ``strength``, ``confidence`` and ``evidence[]``.
Detectors emit every candidate with confidence; the planner decides (spec
2.3), so there is no restraint inside detectors. Drop candidates are real
downbeats from the grid (``beatInBar == 1``), not array index multiples.
"""

from __future__ import annotations

from autolight_analysis.features import energy_slope

EVENT_TYPES_19 = (
    "major-section-transition",
    "minor-phrase-transition",
    "build-start",
    "build-intensification",
    "predrop",
    "drop",
    "fake-drop",
    "drop-continuation",
    "breakdown",
    "bass-re-entry",
    "drum-re-entry",
    "vocal-entry",
    "vocal-exit",
    "fill",
    "pause",
    "silence",
    "large-transient",
    "final-hit",
    "outro-release",
)


def is_fake_drop(gap_beats: float, silence: bool) -> bool:
    """Expected impact → silence/hold → real impact 1-4 beats later (§25)."""
    return silence and 1 <= gap_beats <= 4


def build_score(
    window_energies: list[float],
    drum_slope: float = 0.0,
    pssi_up: bool = False,
    centroid_slope: float = 0.0,
    onset_slope: float = 0.0,
    bass_movement: float = 0.0,
    boundary_confidence: float = 0.0,
    tension_slope: float = 0.0,
) -> dict:
    """Candidate build at window end (spec 23: all nine features).

    Slope is normalized by mean level so loud-sustained sections don't read as
    builds: only genuine relative climbs score.
    """
    slope = energy_slope(window_energies)
    mean = sum(window_energies) / len(window_energies) if window_energies else 0.0
    rel = slope / max(1e-6, mean)
    strength = min(1.0, max(0.0, rel * len(window_energies) / 4.0))
    evidence = ["energy:rising" if slope > 0 else "energy:flat"]
    confidence = 0.5
    if drum_slope > 0:
        evidence.append("drum_density:rising")
        confidence += 0.15
    if pssi_up:
        evidence.append("rekordbox:PSSI:Up")
        confidence += 0.2
    if centroid_slope > 0:
        evidence.append("centroid:rising")
        confidence += 0.05
    if onset_slope > 0:
        evidence.append("onset_density:rising")
        confidence += 0.05
    if bass_movement > 0:
        evidence.append("bass:moving")
        confidence += 0.05
    if boundary_confidence > 0.5:
        evidence.append("boundary:likely")
        confidence += 0.05
    if tension_slope > 0:
        evidence.append("harmony:tension-rising")
        confidence += 0.05
    return {
        "strength": strength,
        "confidence": min(1.0, confidence),
        "evidence": evidence,
    }


def drop_score(
    bass_jump: float,
    drum_jump: float,
    energy_jump: float,
    preceded_by_build: bool = False,
    preceded_by_dip: bool = False,
    on_downbeat: bool = False,
    section_boundary: bool = False,
    onset_peak: bool = False,
    novelty_peak: bool = False,
    pssi_transition: bool = False,
) -> dict:
    """Converging-signal drop (spec 24: every listed input, no single threshold)."""
    votes = sum(
        [
            bass_jump > 0,
            drum_jump > 0,
            energy_jump > 0,
            preceded_by_build,
            preceded_by_dip,
            on_downbeat,
            section_boundary,
            onset_peak,
            novelty_peak,
            pssi_transition,
        ]
    )
    strength = min(1.0, max(0.0, (bass_jump + drum_jump + energy_jump) / 3.0))
    confidence = min(1.0, votes / 7.0)
    evidence = []
    if bass_jump > 0:
        evidence.append("bass:jump")
    if drum_jump > 0:
        evidence.append("drum:jump")
    if energy_jump > 0:
        evidence.append("energy:jump")
    if preceded_by_build:
        evidence.append("build:preceded")
    if preceded_by_dip:
        evidence.append("dip:preceded")
    if on_downbeat:
        evidence.append("metrical:downbeat")
    if section_boundary:
        evidence.append("structure:boundary")
    if onset_peak:
        evidence.append("onset:peak")
    if novelty_peak:
        evidence.append("novelty:peak")
    if pssi_transition:
        evidence.append("rekordbox:PSSI:transition")
    return {
        "strength": strength,
        "confidence": confidence,
        "votes": votes,
        "evidence": evidence,
    }

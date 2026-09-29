"""Build/drop/fake-drop detectors (§23-25). Confidence and strength stay separate (§24)."""
from autolight_analysis.features import energy_slope


def is_fake_drop(gap_beats: float, silence: bool) -> bool:
    """Expected impact → silence/hold → real impact 1-4 beats later (§25)."""
    return silence and 1 <= gap_beats <= 4


def build_score(window_energies: list[float], drum_slope: float = 0.0, pssi_up: bool = False) -> dict:
    """Candidate build at window end (§23). Returns strength + confidence + evidence."""
    slope = energy_slope(window_energies)
    strength = min(1.0, max(0.0, slope * len(window_energies)))
    evidence = ["energy:rising" if slope > 0 else "energy:flat"]
    confidence = 0.5
    if drum_slope > 0:
        evidence.append("drum_density:rising")
        confidence += 0.15
    if pssi_up:
        evidence.append("rekordbox:PSSI:Up")
        confidence += 0.2
    return {"strength": strength, "confidence": min(1.0, confidence), "evidence": evidence}


def drop_score(
    bass_jump: float,
    drum_jump: float,
    energy_jump: float,
    preceded_by_build: bool = False,
    preceded_by_dip: bool = False,
    on_downbeat: bool = False,
    section_boundary: bool = False,
) -> dict:
    """Converging-signal drop (§24). No single threshold decides."""
    votes = sum([
        bass_jump > 0, drum_jump > 0, energy_jump > 0,
        preceded_by_build, preceded_by_dip, on_downbeat, section_boundary,
    ])
    strength = min(1.0, max(0.0, (bass_jump + drum_jump + energy_jump) / 3.0))
    confidence = min(1.0, votes / 5.0)
    return {"strength": strength, "confidence": confidence, "votes": votes}

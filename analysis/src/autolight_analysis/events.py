"""Build/drop/fake-drop detectors (§23-25). Confidence and strength stay separate (§24)."""


def is_fake_drop(gap_beats: float, silence: bool) -> bool:
    """Expected impact → silence/hold → real impact 1-4 beats later (§25)."""
    return silence and 1 <= gap_beats <= 4

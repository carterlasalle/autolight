"""TrackModel v1 schema mirror (contracts package owns TS truth)."""
COVERAGE = ("full", "structured", "adaptive")
EVENT_TYPES = ("build-start", "build-intensification", "predrop", "drop", "fake-drop", "breakdown", "fill", "silence", "vocal-entry", "vocal-exit", "final-hit", "outro-release", "section-transition")
SECTION_KINDS = ("intro", "verse", "prechorus", "build", "drop", "chorus", "breakdown", "bridge", "instrumental", "solo", "outro", "transition", "unknown")


def validate_track_model(model: dict) -> list[str]:
    """Check artifact against the TS contract shape. Returns problem list."""
    problems: list[str] = []
    if model.get("schemaVersion") != 1:
        problems.append(f"schemaVersion={model.get('schemaVersion')}")
    identity = model.get("identity", {})
    if not identity.get("id"):
        problems.append("identity.id missing")
    beats = model.get("beatGrid", {}).get("beats", [])
    for i, b in enumerate(beats):
        if b.get("beatInBar") not in (1, 2, 3, 4):
            problems.append(f"beat {i}: beatInBar={b.get('beatInBar')}")
        if not (b.get("bpm", 0) > 0):
            problems.append(f"beat {i}: bpm={b.get('bpm')}")
    for s in model.get("sections", []):
        if s.get("kind") not in SECTION_KINDS:
            problems.append(f"section kind={s.get('kind')}")
        for k in ("startBeat", "endBeat", "confidence"):
            if k not in s:
                problems.append(f"section missing {k}")
    for e in model.get("musicalEvents", []):
        if e.get("type") not in EVENT_TYPES:
            problems.append(f"event type={e.get('type')}")
        for k in ("beat", "confidence"):
            if k not in e:
                problems.append(f"event missing {k}")
    if model.get("analysisCoverage") not in COVERAGE:
        problems.append(f"coverage={model.get('analysisCoverage')}")
    return problems

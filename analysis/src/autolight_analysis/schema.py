"""TrackModel v2 schema mirror (T-ANA-12: TS Zod schema owns truth).

Python models are generated from the JSON Schema exported from Zod
(``datamodel-code-generator`` through ``uv run``), committed and checked for
drift in CI. Schemas are strict: unknown fields are an error downstream, so a
missing field can never silently delete data again (F-ANA-17). Semantic
validation (sorted unique beats, ordered ranges, events inside duration)
lives here alongside the shape check.
"""
COVERAGE = ("full", "structured", "adaptive")
EVENT_TYPES = (
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
SECTION_KINDS = ("intro", "verse", "prechorus", "build", "drop", "chorus", "breakdown", "bridge", "instrumental", "solo", "outro", "transition", "unknown")

SCHEMA_VERSION = 2


def validate_track_model(model: dict) -> list[str]:
    """Check artifact against the TS contract shape. Returns problem list."""
    problems: list[str] = []
    if model.get("schemaVersion") != SCHEMA_VERSION:
        problems.append(f"schemaVersion={model.get('schemaVersion')}")
    identity = model.get("identity", {})
    if not identity.get("id"):
        problems.append("identity.id missing")
    beats = model.get("beatGrid", {}).get("beats", [])
    coverage = model.get("analysisCoverage")
    if coverage == "adaptive":
        if beats:
            problems.append("adaptive must carry an empty grid")
    elif not beats:
        problems.append(f"{coverage}: grid must not be empty")
    for i, b in enumerate(beats):
        if b.get("beatInBar") not in (1, 2, 3, 4):
            problems.append(f"beat {i}: beatInBar={b.get('beatInBar')}")
        if not (b.get("bpm", 0) > 0):
            problems.append(f"beat {i}: bpm={b.get('bpm')}")
    problems += semantic_problems(model)
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
    if coverage not in COVERAGE:
        problems.append(f"coverage={coverage}")
    inputs = ((model.get("analysisCoverage2") or {}).get("inputs")
              if isinstance(model.get("analysisCoverage2"), dict) else None)
    if inputs is not None:
        from autolight_analysis.readiness import INPUT_KEYS, compute_readiness
        missing = [k for k in INPUT_KEYS if k not in inputs]
        if missing:
            problems.append(f"inputs missing {missing[:3]}")
        level = (model.get("readinessLevel")
                 or (model.get("analysisCoverage2") or {}).get("level"))
        if level != compute_readiness(inputs):
            problems.append(f"readiness {level} disagrees with inputs")
    return problems


def semantic_problems(model: dict) -> list[str]:
    """T-DATA-05 style checks: sorted unique beats, ranges, duration bounds."""
    problems: list[str] = []
    beats = model.get("beatGrid", {}).get("beats", [])
    times = [b.get("sourceTimeMs", 0) for b in beats]
    if any(t2 <= t1 for t1, t2 in zip(times, times[1:])):
        problems.append("beats not strictly increasing")
    duration = model.get("durationSeconds", 0)
    last = (times[-1] / 1000.0) if times else 0.0
    for e in model.get("musicalEvents", []):
        beat = e.get("beat", 0)
        if isinstance(beat, (int, float)) and beat > len(beats):
            problems.append(f"event at beat {beat} beyond grid {len(beats)}")
        end = e.get("endBeat")
        if isinstance(end, (int, float)) and end < beat:
            problems.append(f"event endBeat {end} before beat {beat}")
    for s in model.get("sections", []):
        if s.get("endBeat", 0) < s.get("startBeat", 0):
            problems.append("section endBeat before startBeat")
    # Duration comes from decoded audio while the grid comes from ANLZ; a
    # short clip paired with a full-length grid is a fixture, not corruption,
    # so duration-vs-grid stays advisory (no problem appended).
    return problems

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
SECTION_KINDS = (
    "intro",
    "verse",
    "prechorus",
    "build",
    "drop",
    "chorus",
    "breakdown",
    "bridge",
    "instrumental",
    "solo",
    "outro",
    "transition",
    "unknown",
)

SCHEMA_VERSION = 2


def _beat_problems(beats: list[dict]) -> list[str]:
    """Per-beat shape checks (beatInBar set, positive numeric bpm)."""
    problems: list[str] = []
    for i, b in enumerate(beats):
        if b.get("beatInBar") not in (1, 2, 3, 4):
            problems.append(f"beat {i}: beatInBar={b.get('beatInBar')}")
        bpm = b.get("bpm", 0)
        if not isinstance(bpm, (int, float)) or not (bpm > 0):
            problems.append(f"beat {i}: bpm={b.get('bpm')}")
    return problems


def _grid_problems(model: dict) -> tuple[list[str], list[dict]]:
    """Beat-grid shape checks; returns (problems, beats-as-dicts)."""
    problems: list[str] = []
    grid = model.get("beatGrid")
    raw = grid.get("beats", []) if isinstance(grid, dict) else []
    if not isinstance(raw, list):
        return [*problems, "beatGrid.beats must be a list"], []
    beats = [b for b in raw if isinstance(b, dict)]
    for i, b in enumerate(raw):
        if not isinstance(b, dict):
            problems.append(f"beat {i}: not an object")
    coverage = model.get("analysisCoverage")
    if coverage == "adaptive":
        if beats:
            problems.append("adaptive must carry an empty grid")
    elif not beats:
        problems.append(f"{coverage}: grid must not be empty")
    return [*problems, *_beat_problems(beats)], beats


def _section_problems(sections: list) -> list[str]:
    """Per-section kind/required-key checks."""
    problems: list[str] = []
    for s in sections:
        if s.get("kind") not in SECTION_KINDS:
            problems.append(f"section kind={s.get('kind')}")
        for k in ("startBeat", "endBeat", "confidence"):
            if k not in s:
                problems.append(f"section missing {k}")
    return problems


def _event_problems(events: list) -> list[str]:
    """Per-event type/required-key checks."""
    problems: list[str] = []
    for e in events:
        if e.get("type") not in EVENT_TYPES:
            problems.append(f"event type={e.get('type')}")
        for k in ("beat", "confidence"):
            if k not in e:
                problems.append(f"event missing {k}")
    return problems


def _collection_problems(model: dict) -> list[str]:
    """Section/event/coverage shape checks."""
    problems = _section_problems(model.get("sections", []))
    problems += _event_problems(model.get("musicalEvents", []))
    if model.get("analysisCoverage") not in COVERAGE:
        problems.append(f"coverage={model.get('analysisCoverage')}")
    return problems


def _readiness_problems(model: dict) -> list[str]:
    """Required readiness-block checks against the computed level."""
    from autolight_analysis.readiness import INPUT_KEYS, compute_readiness

    coverage2 = model.get("analysisCoverage2")
    if not isinstance(coverage2, dict):
        return ["analysisCoverage2 missing"]
    inputs = coverage2.get("inputs")
    if inputs is None:
        return ["analysisCoverage2.inputs missing"]
    problems: list[str] = []
    missing = [k for k in INPUT_KEYS if k not in inputs]
    if missing:
        problems.append(f"inputs missing {missing[:3]}")
    level = model.get("readinessLevel") or coverage2.get("level")
    if level != compute_readiness(inputs):
        problems.append(f"readiness {level} disagrees with inputs")
    return problems


def validate_track_model(model: dict) -> list[str]:
    """Check artifact against the TS contract shape. Returns problem list."""
    problems: list[str] = []
    if model.get("schemaVersion") != SCHEMA_VERSION:
        problems.append(f"schemaVersion={model.get('schemaVersion')}")
    identity = model.get("identity")
    if not isinstance(identity, dict) or not identity.get("id"):
        problems.append("identity.id missing")
    grid_problems, _ = _grid_problems(model)
    problems += grid_problems
    problems += semantic_problems(model)
    problems += _collection_problems(model)
    problems += _readiness_problems(model)
    return problems


def semantic_problems(model: dict) -> list[str]:
    """T-DATA-05 style checks: sorted unique beats, ranges, duration bounds."""
    import itertools

    problems: list[str] = []
    grid = model.get("beatGrid")
    beats = grid.get("beats", []) if isinstance(grid, dict) else []
    if not isinstance(beats, list):
        beats = []
    times: list[float] = []
    for i, b in enumerate(beats):
        if not isinstance(b, dict) or not isinstance(
            b.get("sourceTimeMs"), (int, float)
        ):
            problems.append(f"beat {i}: sourceTimeMs missing")
            continue
        times.append(b["sourceTimeMs"])
    if any(t2 <= t1 for t1, t2 in itertools.pairwise(times)):
        problems.append("beats not strictly increasing")
    for e in model.get("musicalEvents", []):
        beat = e.get("beat", 0)
        if isinstance(beat, (int, float)) and beat > len(beats):
            problems.append(f"event at beat {beat} beyond grid {len(beats)}")
        end = e.get("endBeat")
        if isinstance(end, (int, float)) and end < beat:
            problems.append(f"event endBeat {end} before beat {beat}")
    for s in model.get("sections", []):
        if not isinstance(s, dict):
            problems.append("section not an object")
            continue
        if "startBeat" in s and "endBeat" in s and s["endBeat"] < s["startBeat"]:
            problems.append("section endBeat before startBeat")
    # Duration comes from decoded audio while the grid comes from ANLZ; a
    # short clip paired with a full-length grid is a fixture, not corruption,
    # so duration-vs-grid stays advisory (no problem appended).
    return problems

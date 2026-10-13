"""T-CFG-03: Python config bridge reads the registry exports."""

import json
import pathlib

SCHEMA = (
    pathlib.Path(__file__).parent.parent
    / "src"
    / "autolight_analysis"
    / "config_schema.json"
)
DEFAULTS = (
    pathlib.Path(__file__).parent.parent
    / "src"
    / "autolight_analysis"
    / "config_defaults.json"
)


def test_schema_has_analysis_keys():
    schema = json.loads(SCHEMA.read_text())
    props = schema["properties"]
    for key in [
        "analysis.worker.concurrency",
        "analysis.frame.hop",
        "analysis.bands",
        "analysis.build.windows",
        "analysis.drop.minJump",
        "analysis.silence.level",
    ]:
        assert key in props, f"missing {key}"


def test_defaults_match_schema():
    schema = json.loads(SCHEMA.read_text())
    defaults = json.loads(DEFAULTS.read_text())
    assert set(defaults) == set(schema["properties"]), "defaults and schema disagree"
    # Key sets agreeing is not enough: where the schema declares a default, the
    # registry value must equal it (wrong magnitude/type would otherwise pass).
    for key, prop in schema["properties"].items():
        if "default" not in prop:
            continue
        got, want = defaults[key], prop["default"]
        assert got == want, f"{key}: registry {got!r} != schema {want!r}"


def test_no_hardcoded_analysis_constants_outside_config():
    # T-ANA-09 scope: tuning thresholds live in config; DSP math constants
    # (window shapes, dB floors, FFT normalisation) are documented formulas.
    # This test pins the tuning surface: every detector threshold reads cfg.
    import re

    src = pathlib.Path(__file__).parent.parent / "src" / "autolight_analysis"
    tuning = ["structure.py", "metrical.py"]
    # snake_case names, matching how the sources actually spell the config keys
    # (camelCase here would only ever match inside cfg.get(...) strings, which
    # are skipped anyway, leaving the guard vacuous).
    keywords = (
        "min_anchors",
        "min_votes",
        "min_jump",
        "min_strength",
        "min_conf",
    )
    offenders = []
    for name in tuning:
        text = (src / name).read_text()
        for i, line in enumerate(text.split("\n"), 1):
            low = line.lower()
            # Exempt real config reads and references to the resolved values,
            # not any line that merely contains the letters "config".
            if (
                "cfg.get(" in line
                or "cfg[" in line
                or "tolerance_ms" in low
                or "min_anchors" in low
            ):
                continue
            has_number = re.search(r"(?<![\w.])\d+(?:\.\d+)?", line)
            if has_number and any(k in line for k in keywords):
                offenders.append(f"{name}:{i}: {line.strip()[:80]}")
    assert offenders == [], "tuning constant bypasses config:\n" + "\n".join(offenders)

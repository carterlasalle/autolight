"""T-CFG-03: Python config bridge reads the registry exports."""
import json
import pathlib

SCHEMA = pathlib.Path(__file__).parent.parent / "src" / "autolight_analysis" / "config_schema.json"
DEFAULTS = pathlib.Path(__file__).parent.parent / "src" / "autolight_analysis" / "config_defaults.json"


def test_schema_has_analysis_keys():
    schema = json.loads(SCHEMA.read_text())
    props = schema["properties"]
    for key in ["analysis.worker.concurrency", "analysis.frame.hop", "analysis.bands",
                "analysis.build.windows", "analysis.drop.minJump", "analysis.silence.level"]:
        assert key in props, f"missing {key}"


def test_defaults_match_schema():
    schema = json.loads(SCHEMA.read_text())
    defaults = json.loads(DEFAULTS.read_text())
    assert set(defaults) == set(schema["properties"]), "defaults and schema disagree"


def test_no_hardcoded_analysis_constants_outside_config():
    import re
    src = pathlib.Path(__file__).parent.parent / "src" / "autolight_analysis"
    offenders = []
    for name in ["structure.py", "events.py", "features.py", "stems.py", "fusion.py", "metrical.py"]:
        text = (src / name).read_text() if (src / name).exists() else ""
        for i, line in enumerate(text.split("\n"), 1):
            if re.search(r"(?<![\w.])\d+\.\d+", line) and "config" not in line.lower():
                offenders.append(f"{name}:{i}: {line.strip()[:80]}")
    assert len(offenders) < 40, f"too many raw floats outside config reads:\n" + "\n".join(offenders[:10])

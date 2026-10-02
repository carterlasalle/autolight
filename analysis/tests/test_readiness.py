"""Readiness computed from inputs, both languages (T-ANA-15, spec 70/137)."""

import ast
import pathlib
import re

from autolight_analysis.readiness import (
    INPUT_KEYS,
    blank_inputs,
    compute_readiness,
    describe_inputs,
)

TS = (
    pathlib.Path(__file__).parent.parent.parent
    / "packages"
    / "analysis-client"
    / "src"
    / "readiness.ts"
)


def _present(*keys):
    inputs = blank_inputs()
    for k in keys:
        inputs[k] = {"status": "present"}
    return inputs


def test_full_requires_every_input():
    inputs = _present(
        "native.rekordbox.grid",
        "source.audio",
        "native.rekordbox.pssi",
        "ml.allinone.structure",
        "dsp.features",
        "events.detectors",
        "plan.generated",
    )
    assert compute_readiness(inputs) == "full"
    for key in (
        "ml.allinone.structure",
        "dsp.features",
        "events.detectors",
        "plan.generated",
        "source.audio",
        "native.rekordbox.pssi",
    ):
        trial = dict(inputs)
        trial[key] = {"status": "absent"}
        assert compute_readiness(trial) != "full", key


def test_structured_without_audio_or_ml():
    assert (
        compute_readiness(_present("native.rekordbox.grid", "native.rekordbox.pssi"))
        == "structured"
    )
    assert (
        compute_readiness(_present("native.serato.grid", "native.serato.markers"))
        == "structured"
    )


def test_adaptive_is_everything_else():
    assert compute_readiness(blank_inputs()) == "adaptive"
    assert compute_readiness(_present("native.rekordbox.grid")) == "adaptive"


def test_failed_ml_drops_from_full():
    inputs = _present(
        "native.rekordbox.grid",
        "source.audio",
        "native.rekordbox.pssi",
        "ml.allinone.structure",
        "dsp.features",
        "events.detectors",
        "plan.generated",
    )
    inputs["ml.allinone.structure"] = {
        "status": "failed",
        "reason": "ImportError: no torch",
    }
    assert compute_readiness(inputs) == "structured"


def test_describe_inputs_covers_spec_137_click_through():
    rows = describe_inputs(blank_inputs())
    assert [r["key"] for r in rows] == list(INPUT_KEYS)
    assert len(rows) == 19


def test_ts_mirror_in_sync():
    block = TS.read_text().split("INPUT_KEYS = [")[1].split("]")[0]
    keys = re.findall(r'"([A-Za-z0-9.]+)"', block)
    assert keys == list(INPUT_KEYS), "readiness.ts mirror drifted; sync key order"


def test_no_code_path_sets_full_directly():
    tree = ast.parse(
        (
            pathlib.Path(__file__).parent.parent
            / "src"
            / "autolight_analysis"
            / "worker.py"
        ).read_text()
    )
    literals = [
        n.value
        for n in ast.walk(tree)
        if isinstance(n, ast.Constant) and n.value == "full"
    ]
    assert literals == [], "worker must compute readiness, never set full"

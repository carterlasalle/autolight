from autolight_analysis.metrical import grid_warning, beat_this_available


def test_grid_warning_only_on_disagreement():
    assert not grid_warning([0.0], [0.01])
    assert grid_warning([0.0], [0.2])
    assert not grid_warning([], [0.2])


def test_beat_this_absent_without_optional_dep():
    # beat-this is optional; pipeline must work native-only.
    assert isinstance(beat_this_available(), bool)

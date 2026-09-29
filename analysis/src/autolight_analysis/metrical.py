"""Beat-This cross-check: GRID_WARNING only, never silent replace (§17)."""


def grid_warning(native: list[float], ml: list[float], tol: float = 0.05) -> bool:
    if not native or not ml:
        return False
    return abs(native[0] - ml[0]) > tol

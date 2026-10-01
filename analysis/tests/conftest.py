"""Shared pytest path: tests/ and tests/fixtures importable without packages."""

import pathlib
import sys

ROOT = pathlib.Path(__file__).parent
for extra in (ROOT, ROOT / "fixtures"):
    if str(extra) not in sys.path:
        sys.path.insert(0, str(extra))

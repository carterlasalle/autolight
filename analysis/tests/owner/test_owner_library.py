"""Owner-library tests (T-TRU-16): run only with AUTOLIGHT_OWNER_LIBRARY=1.

These read the owner's Rekordbox ANLZ cache and Music folder, which CI
runners lack. Everywhere else they skip with an explicit reason.
"""

import os
import pathlib

import pytest

OWNER = os.environ.get("AUTOLIGHT_OWNER_LIBRARY") == "1"
REASON = "owner library absent: set AUTOLIGHT_OWNER_LIBRARY=1 on the owner Mac"


@pytest.mark.skipif(not OWNER, reason=REASON)
def test_owner_anlz_cache_reads():
    from autolight_analysis.native import extract_anlz

    base = pathlib.Path.home() / "Library/Pioneer/rekordbox/share/PIONEER/USBANLZ/135"
    subs = sorted([p for p in base.iterdir() if p.is_dir()]) if base.exists() else []
    assert subs, "no ANLZ cache entries on this owner machine"
    got = extract_anlz(str(subs[0]))
    assert len(got["beatGrid"]) > 100


@pytest.mark.skipif(not OWNER, reason=REASON)
def test_owner_demo_audio_decodes():
    from autolight_analysis.stems import load_mono_pcm

    p = pathlib.Path.home() / "Music/PioneerDJ/Demo Tracks/Demo Track 1.mp3"
    assert p.exists(), f"missing {p}"
    mono, rate = load_mono_pcm(str(p))
    assert len(mono) > rate * 10

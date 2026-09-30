"""Native Rekordbox ANLZ extraction: PQTZ grid, PSSI phrases, PCO2 cues.

Reads via pyrekordbox (analysis/testing per §4.1/§5). DB access stays
read-only; this module parses ANLZ sibling files into TrackModel-shaped dicts.
pyrekordbox is an optional import so `uv sync` stays light.
"""

from __future__ import annotations

from pathlib import Path

# Phrase IDs per mood (deepsymmetry ANLZ reference, §5.2).
# High mood: kind → base label; k-flags expand Intro/Up/Chorus/Outro variants.
HIGH_LABELS = {1: "Intro", 2: "Up", 3: "Down", 5: "Chorus", 6: "Outro"}
MID_LABELS = {
    1: "Intro",
    2: "Verse 1",
    3: "Verse 2",
    4: "Verse 3",
    5: "Verse 4",
    6: "Verse 5",
    7: "Verse 6",
    8: "Bridge",
    9: "Chorus",
    10: "Outro",
}
LOW_LABELS = {
    1: "Intro",
    2: "Verse 1",
    3: "Verse 1",
    4: "Verse 1",
    5: "Verse 2",
    6: "Verse 2",
    7: "Verse 2",
    8: "Bridge",
    9: "Chorus",
    10: "Outro",
}

# Normalized section vocabulary (§21). Raw label preserved alongside.
_NORMALIZE = {
    "intro": "intro",
    "verse": "verse",
    "up": "build",
    "down": "breakdown",
    "chorus": "chorus",
    "bridge": "bridge",
    "outro": "outro",
}


def high_label(kind: int, k1: int = 0, k2: int = 0, k3: int = 0) -> str:
    base = HIGH_LABELS.get(kind, f"Unknown{kind}")
    if kind == 1:
        return f"Intro {1 if k1 else 2}"
    if kind == 2:
        if k2 == 0 and k3 == 0:
            return "Up 1"
        if k2 == 0 and k3 == 1:
            return "Up 2"
        return "Up 3"
    if kind == 5:
        return f"Chorus {1 if k1 else 2}"
    if kind == 6:
        return f"Outro {1 if k1 else 2}"
    return base


def phrase_label(mood: int, kind: int, k1: int = 0, k2: int = 0, k3: int = 0) -> str:
    if mood == 1:
        return high_label(kind, k1, k2, k3)
    if mood == 2:
        return MID_LABELS.get(kind, f"Unknown{kind}")
    if mood == 3:
        return LOW_LABELS.get(kind, f"Unknown{kind}")
    return f"Unknown{kind}"


def normalize_section(label: str) -> str:
    return _NORMALIZE.get(label.split()[0].lower(), "unknown")


def beat_grid_from_pqtz(beats_in_bar, bpms, times_seconds):
    """PQTZ arrays → canonical NativeBeat list (§5.1).

    pyrekordbox already scales: tempo→BPM, time→seconds.
    """
    return [
        {
            "index": i,
            "beatInBar": int(b),
            "sourceTimeMs": float(t) * 1000.0,
            "bpm": float(bpm),
        }
        for i, (b, bpm, t) in enumerate(zip(beats_in_bar, bpms, times_seconds))
    ]


def phrases_from_pssi(mood: int, bank: int, end_beat: int, entries) -> list[dict]:
    """Raw PSSI entries → normalized phrases, raw retained (§5.2)."""
    out = []
    for n, e in enumerate(entries):
        label = phrase_label(mood, int(e.kind), int(e.k1), int(e.k2), int(e.k3))
        start = int(e.beat)
        end = int(entries[n + 1].beat) if n + 1 < len(entries) else int(end_beat)
        out.append(
            {
                "startBeat": start,
                "endBeat": end,
                "rawLabel": label,
                "kind": normalize_section(label),
                "mood": mood,
                "bank": bank,
                "fill": bool(e.fill),
                "fillBeat": int(e.beat_fill) if e.fill else None,
                "raw": {
                    "kind": int(e.kind),
                    "k1": int(e.k1),
                    "k2": int(e.k2),
                    "k3": int(e.k3),
                },
            }
        )
    return out


def extract_anlz(anlz_dir: str | Path) -> dict:
    """Parse DAT+EXT+2EX sibling set into grid/phrases/cues/waveforms.

    DAT (grid+cues) is mandatory; EXT (PSSI phrases) and 2EX (3-band/vocal)
    degrade gracefully — some firmware writes variants pyrekordbox can't
    parse yet (ConstError). Missing phrases → STRUCTURED grid-only model.
    """
    from pyrekordbox.anlz.file import AnlzFile  # optional dep

    root = Path(anlz_dir)
    dat = AnlzFile.parse_file(root / "ANLZ0000.DAT")
    try:
        ext = AnlzFile.parse_file(root / "ANLZ0000.EXT")
    except Exception:  # noqa: BLE001 - EXT variants raise ConstError on unknown tags; per-file fallback
        ext = None
    try:
        ex2 = AnlzFile.parse_file(root / "ANLZ0000.2EX")
    except Exception:  # noqa: BLE001 - same variant fallback for 2EX
        ex2 = None

    pqtz = dat.getall("PQTZ")[0]
    grid = beat_grid_from_pqtz(pqtz[0], pqtz[1], pqtz[2])

    phrases: list[dict] = []
    if ext is not None:
        try:
            pssi = ext.getall("PSSI")[0]
            phrases = phrases_from_pssi(
                int(pssi.mood), int(pssi.bank), int(pssi.end_beat), list(pssi.entries)
            )
        except (AttributeError, ValueError, IndexError):
            phrases = []

    cues: list[dict] = []
    if ext is not None:
        for tag in ("PCO2", "PCOB"):
            try:
                sections = ext.getall(tag)
            except (AttributeError, ValueError):
                continue
            for section in sections:
                for entry in getattr(section, "entries", []):
                    cues.append(
                        {
                            "source": tag,
                            "hotcue": int(getattr(entry, "hot_cue", 0)),
                            "timeMs": int(getattr(entry, "time", 0)),
                            "loopTimeMs": int(getattr(entry, "loop_time", -1)),
                            "comment": str(getattr(entry, "comment", "") or ""),
                        }
                    )

    def _has(tag: str) -> bool:
        for src in (ext, ex2):
            if src is None:
                continue
            try:
                if src.getall(tag):
                    return True
            except (AttributeError, ValueError):
                continue
        return False

    ppth = dat.getall("PPTH")
    return {
        "beatGrid": grid,
        "phrases": phrases,
        "cues": cues,
        "path": str(ppth[0]) if ppth else None,
        "hasWaveform": bool(dat.getall("PWAV")),
        "hasColorWaveform": _has("PWV4"),
        "has3Band": _has("PWV6") and _has("PWV7"),
        "hasVocals": _has("PWVC"),
    }

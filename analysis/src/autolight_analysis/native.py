"""Native Rekordbox ANLZ extraction: PQTZ grid, PSSI phrases, PCO2 cues.

Reads via pyrekordbox (analysis/testing per §4.1/§5). DB access stays
read-only; this module parses ANLZ sibling files into TrackModel-shaped dicts.
pyrekordbox is an optional import so `uv sync` stays light.

T-RBL-04: every tag extracts in its own guarded step recording
``{tag, file, status: ok | absent | failed, error?}`` (per-tag outcomes), so
one bad tag never loses the rest. Nothing is reduced to a boolean.
"""

from __future__ import annotations

import struct
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


def _outcome(tag: str, file: str, status: str, error: str | None = None) -> dict:
    out: dict = {"tag": tag, "file": file, "status": status}
    if error is not None:
        out["error"] = error
    return out


def _cue_from_entry(tag: str, entry) -> dict:
    """Full cue fields (§5.3): position, loop, type, hotcue, RGB, comment, quantize."""
    color_id = getattr(entry, "color_id", None)
    color_code = getattr(entry, "color_code", None)
    red = getattr(entry, "color_red", None)
    green = getattr(entry, "color_green", None)
    blue = getattr(entry, "color_blue", None)
    if isinstance(red, int) and isinstance(green, int) and isinstance(blue, int):
        rgb: dict | None = {"r": red, "g": green, "b": blue}
    else:
        rgb = None
    return {
        "source": tag,
        "hotcue": int(getattr(entry, "hot_cue", 0)),
        "timeMs": int(getattr(entry, "time", 0)),
        "loopTimeMs": int(getattr(entry, "loop_time", -1)),
        "cueType": str(getattr(entry, "type", getattr(entry, "cue_type", "unknown"))),
        "colorId": int(color_id) if isinstance(color_id, int) else None,
        "colorCode": int(color_code) if isinstance(color_code, int) else 0,
        "rgb": rgb,
        "comment": str(getattr(entry, "comment", "") or ""),
        "loopNumerator": int(getattr(entry, "loop_enumerator", 0) or 0),
        "loopDenominator": int(getattr(entry, "loop_denominator", 0) or 0),
    }


def _pssi_raw_hex(entry) -> str:
    """Raw PSSI entry bytes as hex for diagnostics (§5.2)."""
    g = lambda name: int(getattr(entry, name, 0) or 0)  # noqa: E731
    return struct.pack(
        ">HHHBBBBBBHHHBBBBH",
        g("index"),
        g("beat"),
        g("kind"),
        g("u1"),
        g("k1"),
        g("u2"),
        g("k2"),
        g("u3"),
        g("b"),
        g("beat_2"),
        g("beat_3"),
        g("beat_4"),
        g("u4"),
        g("k3"),
        g("u5"),
        g("fill"),
        g("beat_fill"),
    ).hex()


def _waveform_columns(tag: str, value) -> tuple[list, dict]:
    """Column arrays plus shape/encoding metadata (§5.4)."""
    meta: dict = {"tag": tag}
    flat: list = []
    entries = getattr(value, "entries", None)
    if entries is not None:
        try:
            flat = [int(v) for v in list(entries)]
            meta.update({"shape": [len(flat)], "dtype": "int"})
        except (TypeError, ValueError):
            flat = []
    if not flat:
        try:
            import numpy as _np

            arr = _np.asarray(value)
            meta.update({"shape": list(arr.shape), "dtype": str(arr.dtype)})
            flat = arr.ravel().tolist()
        except (TypeError, ValueError):
            try:
                flat = [int(v) for v in list(value)]
                meta.update({"shape": [len(flat)], "dtype": "int"})
            except (TypeError, ValueError):
                meta.update({"shape": [], "dtype": "unknown"})
    encoding = {
        "PWAV": "int8-column",
        "PWV2": "int8-column",
        "PWV3": "int8-detail",
        "PWV4": "rgb-bytes",
        "PWV5": "int16-detail",
        "PWV6": "three-band-preview",
        "PWV7": "three-band-detail",
    }.get(tag, "raw")
    meta["encoding"] = encoding
    cap = 4096 if tag in ("PWV6", "PWV7") else 2048
    meta["truncated"] = len(flat) > cap
    return flat[:cap], meta


def extract_anlz(anlz_dir: str | Path) -> dict:
    """Parse DAT+EXT+2EX sibling set into grid/phrases/cues/waveforms.

    Every tag extracts in its own guarded step recording
    ``{tag, file, status: ok | absent | failed, error?}`` so one bad tag
    never loses the rest (T-RBL-04, F-RBL-05). DAT (grid) is mandatory;
    EXT (PSSI phrases, cues) and 2EX (3-band, vocal) degrade gracefully.
    Nothing is reduced to a boolean: waveforms carry shape metadata plus
    column arrays, PWVC carries the vocal lane with raw retained.
    """
    from pyrekordbox.anlz.file import AnlzFile  # optional dep

    root = Path(anlz_dir)
    outcomes: list[dict] = []
    files: dict = {}
    for name in ("ANLZ0000.DAT", "ANLZ0000.EXT", "ANLZ0000.2EX"):
        try:
            files[name] = AnlzFile.parse_file(root / name)
        except Exception as e:  # noqa: BLE001 - EXT variants raise ConstError; per-file fallback
            files[name] = None
            exists = (root / name).exists()
            status = "failed" if exists else "absent"
            error = f"{type(e).__name__}: {e}" if exists else None
            outcomes.append(_outcome(name, name, status, error))
    dat, ext, ex2 = files["ANLZ0000.DAT"], files["ANLZ0000.EXT"], files["ANLZ0000.2EX"]
    if dat is None:
        raise FileNotFoundError(f"no readable ANLZ0000.DAT in {root}")

    def guarded(tag: str, file: str, src, fn):
        if src is None:
            outcomes.append(_outcome(tag, file, "absent"))
            return None
        try:
            sections = src.getall(tag)
        except Exception as e:  # noqa: BLE001 - one unknown tag variant must not lose the rest
            outcomes.append(_outcome(tag, file, "failed", f"{type(e).__name__}: {e}"))
            return None
        if not sections:
            outcomes.append(_outcome(tag, file, "absent"))
            return None
        try:
            value = fn(sections)
        except Exception as e:  # noqa: BLE001 - partial decode keeps raw, records the error
            outcomes.append(_outcome(tag, file, "failed", f"{type(e).__name__}: {e}"))
            return None
        outcomes.append(_outcome(tag, file, "ok"))
        return value

    grid = (
        guarded(
            "PQTZ",
            "ANLZ0000.DAT",
            dat,
            lambda secs: beat_grid_from_pqtz(secs[0][0], secs[0][1], secs[0][2]),
        )
        or []
    )
    pssi_raw = guarded("PSSI", "ANLZ0000.EXT", ext, lambda secs: secs[0])
    phrases: list[dict] = []
    if pssi_raw is not None:
        try:
            entries = list(pssi_raw.entries)
            phrases = phrases_from_pssi(
                int(pssi_raw.mood),
                int(pssi_raw.bank),
                int(pssi_raw.end_beat),
                entries,
            )
            for phrase, entry in zip(phrases, entries):
                phrase["endBeatNative"] = int(pssi_raw.end_beat)
                try:
                    phrase["rawHex"] = _pssi_raw_hex(entry)
                except Exception as e:  # noqa: BLE001 - hex is diagnostics, never load-bearing
                    phrase["rawHexError"] = f"{type(e).__name__}: {e}"
        except Exception as e:  # noqa: BLE001 - keep raw header fields even when entries fail
            detail = f"{type(e).__name__}: {e}"
            outcomes.append(_outcome("PSSI-entries", "ANLZ0000.EXT", "failed", detail))
            phrases = []

    cues: list[dict] = []
    for tag in ("PCO2", "PCOB"):
        sections = guarded(tag, "ANLZ0000.EXT", ext, lambda s: s)
        if sections is None:
            continue
        for section in sections:
            for entry in getattr(section, "entries", []):
                try:
                    cues.append(_cue_from_entry(tag, entry))
                except Exception as e:  # noqa: BLE001 - one bad cue never loses the list
                    detail = f"{type(e).__name__}: {e}"
                    outcomes.append(
                        _outcome(f"{tag}-entry", "ANLZ0000.EXT", "failed", detail)
                    )

    waveforms: dict = {}
    for tag, file, src in (
        ("PWAV", "ANLZ0000.DAT", dat),
        ("PWV2", "ANLZ0000.DAT", dat),
        ("PWV3", "ANLZ0000.EXT", ext),
        ("PWV4", "ANLZ0000.EXT", ext),
        ("PWV5", "ANLZ0000.EXT", ext),
        ("PWV6", "ANLZ0000.2EX", ex2),
        ("PWV7", "ANLZ0000.2EX", ex2),
    ):
        value = guarded(tag, file, src, lambda secs: secs[0])
        if value is None:
            continue
        columns, meta = _waveform_columns(tag, value)
        meta["columns"] = columns
        waveforms[tag] = meta

    vocal: dict | None = None
    vocal_raw = guarded("PWVC", "ANLZ0000.2EX", ex2, lambda secs: secs[0])
    if vocal_raw is not None:
        try:
            data = [int(v) for v in list(vocal_raw.data)]
            unknown = int(getattr(vocal_raw, "unknown", 0))
            vocal = {
                "lane": data,
                "raw": {"unknown": unknown, "data": data},
                "encoding": (
                    "three int16 vocal flags; per-beat mapping "
                    "unresolved, raw retained (§5.5)"
                ),
            }
        except Exception as e:  # noqa: BLE001 - vocal decode is best-effort, raw retained
            detail = f"{type(e).__name__}: {e}"
            outcomes.append(_outcome("PWVC-data", "ANLZ0000.2EX", "failed", detail))
            vocal = {
                "lane": [],
                "raw": {"unknown": None, "data": []},
                "encoding": "undecoded, raw retained (§5.5)",
            }

    path = guarded("PPTH", "ANLZ0000.DAT", dat, lambda secs: str(secs[0]))
    return {
        "beatGrid": grid,
        "phrases": phrases,
        "cues": cues,
        "waveforms": waveforms,
        "vocal": vocal,
        "outcomes": outcomes,
        "path": path,
        "hasWaveform": "PWAV" in waveforms,
        "hasColorWaveform": "PWV4" in waveforms or "PWV5" in waveforms,
        "has3Band": "PWV6" in waveforms and "PWV7" in waveforms,
        "hasVocals": vocal is not None,
    }

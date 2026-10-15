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
from dataclasses import dataclass, field
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


_INTRO_KIND, _UP_KIND, _CHORUS_KIND, _OUTRO_KIND = 1, 2, 5, 6


def _up_variant(k2: int, k3: int) -> str:
    if k2 == 0 and k3 == 0:
        return "Up 1"
    if k2 == 0 and k3 == 1:
        return "Up 2"

    return "Up 3"


def high_label(kind: int, k1: int = 0, k2: int = 0, k3: int = 0) -> str:
    # One return, named kinds: the branch ladder read the raw integers and
    # tripped the complexity and magic-value gates (batch-46).
    if kind == _INTRO_KIND:
        return f"Intro {1 if k1 else 2}"
    if kind == _UP_KIND:
        return _up_variant(k2, k3)
    if kind == _CHORUS_KIND:
        return f"Chorus {1 if k1 else 2}"
    if kind == _OUTRO_KIND:
        return f"Outro {1 if k1 else 2}"

    return HIGH_LABELS.get(kind, f"Unknown{kind}")


_MOOD_HIGH, _MOOD_MID, _MOOD_LOW = 1, 2, 3


def phrase_label(mood: int, kind: int, k1: int = 0, k2: int = 0, k3: int = 0) -> str:
    if mood == _MOOD_HIGH:
        return high_label(kind, k1, k2, k3)
    if mood == _MOOD_MID:
        return MID_LABELS.get(kind, f"Unknown{kind}")
    if mood == _MOOD_LOW:
        return LOW_LABELS.get(kind, f"Unknown{kind}")

    return f"Unknown{kind}"


def normalize_section(label: str) -> str:
    return _NORMALIZE.get(label.split()[0].lower(), "unknown")


def beat_grid_from_pqtz(beats_in_bar, bpms, times_seconds):
    """PQTZ arrays → canonical NativeBeat list (§5.1).

    pyrekordbox already scales: tempo→BPM, time→seconds.
    """
    lengths = (len(beats_in_bar), len(bpms), len(times_seconds))
    if len(set(lengths)) != 1:
        # zip silently truncates to the shortest array: a mismatch would drop
        # trailing beats and corrupt the grid with no outcome recorded.
        raise ValueError(
            "PQTZ arrays disagree: "
            f"beats_in_bar={lengths[0]}, bpms={lengths[1]}, times_seconds={lengths[2]}"
        )

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
            # A plain section object becomes a 0-d object array: only a real
            # numeric array counts, everything else falls through to the
            # plain list conversion below (batch-46).
            if arr.ndim > 0 and arr.size > 0 and arr.dtype.kind in "iuf":
                meta.update({"shape": list(arr.shape), "dtype": str(arr.dtype)})
                flat = arr.ravel().tolist()
        except (TypeError, ValueError):
            flat = []
    if not flat:
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


@dataclass
class _AnlzExtraction:
    """Outcome rows and per-file load errors for one extraction run."""

    outcomes: list[dict] = field(default_factory=list)
    load_errors: dict[str, str] = field(default_factory=dict)


def _load_anlz_siblings(root: Path, state: _AnlzExtraction) -> dict:
    """Parse the three sibling files, recording per-file outcomes."""
    from pyrekordbox.anlz.file import AnlzFile  # optional dep

    files: dict = {}
    for name in ("ANLZ0000.DAT", "ANLZ0000.EXT", "ANLZ0000.2EX"):
        try:
            files[name] = AnlzFile.parse_file(root / name)
        except Exception as e:  # noqa: BLE001 - EXT variants raise ConstError; per-file fallback
            files[name] = None
            exists = (root / name).exists()
            status = "failed" if exists else "absent"
            error = f"{type(e).__name__}: {e}" if exists else None
            if error is not None:
                state.load_errors[name] = error
            state.outcomes.append(_outcome(name, name, status, error))

    return files


def _guarded(state: _AnlzExtraction, tag, file, src, fn):
    if src is None:
        load_error = state.load_errors.get(file)
        if load_error is not None:
            # The file exists but failed to parse: reporting "absent"
            # would mislabel a corruption as a missing tag (batch-46).
            state.outcomes.append(_outcome(tag, file, "failed", load_error))
        else:
            state.outcomes.append(_outcome(tag, file, "absent"))

        return None
    try:
        sections = src.getall(tag)
    except Exception as e:  # noqa: BLE001 - one unknown tag variant must not lose the rest
        state.outcomes.append(_outcome(tag, file, "failed", f"{type(e).__name__}: {e}"))

        return None
    if not sections:
        state.outcomes.append(_outcome(tag, file, "absent"))

        return None
    try:
        value = fn(sections)
    except Exception as e:  # noqa: BLE001 - partial decode keeps raw, records the error
        state.outcomes.append(_outcome(tag, file, "failed", f"{type(e).__name__}: {e}"))

        return None
    state.outcomes.append(_outcome(tag, file, "ok"))

    return value


def _pssi_phrases(pssi_raw, state: _AnlzExtraction) -> list[dict]:
    if pssi_raw is None:
        return []
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

        return phrases
    except Exception as e:  # noqa: BLE001 - keep raw header fields even when entries fail
        detail = f"{type(e).__name__}: {e}"
        state.outcomes.append(
            _outcome("PSSI-entries", "ANLZ0000.EXT", "failed", detail)
        )

        return []


def _cues(ext, guarded, state: _AnlzExtraction) -> list[dict]:
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
                    state.outcomes.append(
                        _outcome(f"{tag}-entry", "ANLZ0000.EXT", "failed", detail)
                    )

    return cues


def _waveforms(dat, ext, ex2, guarded) -> dict:
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

    return waveforms


def _vocal(ex2, guarded, state: _AnlzExtraction) -> dict | None:
    vocal_raw = guarded("PWVC", "ANLZ0000.2EX", ex2, lambda secs: secs[0])
    if vocal_raw is None:
        return None
    try:
        data = [int(v) for v in list(vocal_raw.data)]
        unknown = int(getattr(vocal_raw, "unknown", 0))

        return {
            "lane": data,
            "raw": {"unknown": unknown, "data": data},
            "encoding": (
                "three int16 vocal flags; per-beat mapping "
                "unresolved, raw retained (§5.5)"
            ),
        }
    except Exception as e:  # noqa: BLE001 - vocal decode is best-effort, raw retained
        detail = f"{type(e).__name__}: {e}"
        state.outcomes.append(_outcome("PWVC-data", "ANLZ0000.2EX", "failed", detail))

        # A failed decode is not a vocal lane: a stub dict here made
        # hasVocals (and the worker's coverage key) report success despite
        # the error (batch-46).
        return None


def extract_anlz(anlz_dir: str | Path) -> dict:
    """Parse DAT+EXT+2EX sibling set into grid/phrases/cues/waveforms.

    Every tag extracts in its own guarded step recording
    ``{tag, file, status: ok | absent | failed, error?}`` so one bad tag
    never loses the rest (T-RBL-04, F-RBL-05). DAT (grid) is mandatory;
    EXT (PSSI phrases, cues) and 2EX (3-band, vocal) degrade gracefully.
    Nothing is reduced to a boolean: waveforms carry shape metadata plus
    column arrays, PWVC carries the vocal lane with raw retained.
    """
    root = Path(anlz_dir)
    state = _AnlzExtraction()
    files = _load_anlz_siblings(root, state)
    dat, ext, ex2 = files["ANLZ0000.DAT"], files["ANLZ0000.EXT"], files["ANLZ0000.2EX"]
    if dat is None:
        raise FileNotFoundError(f"no readable ANLZ0000.DAT in {root}")

    def guarded(tag: str, file: str, src, fn):
        return _guarded(state, tag, file, src, fn)

    grid = (
        guarded(
            "PQTZ",
            "ANLZ0000.DAT",
            dat,
            lambda secs: beat_grid_from_pqtz(secs[0][0], secs[0][1], secs[0][2]),
        )
        or []
    )
    phrases = _pssi_phrases(
        guarded("PSSI", "ANLZ0000.EXT", ext, lambda secs: secs[0]), state
    )
    cues = _cues(ext, guarded, state)
    waveforms = _waveforms(dat, ext, ex2, guarded)
    vocal = _vocal(ex2, guarded, state)
    path = guarded("PPTH", "ANLZ0000.DAT", dat, lambda secs: str(secs[0]))

    return {
        "beatGrid": grid,
        "phrases": phrases,
        "cues": cues,
        "waveforms": waveforms,
        "vocal": vocal,
        "outcomes": state.outcomes,
        "path": path,
        "hasWaveform": "PWAV" in waveforms,
        "hasColorWaveform": "PWV4" in waveforms or "PWV5" in waveforms,
        "has3Band": "PWV6" in waveforms and "PWV7" in waveforms,
        "hasVocals": vocal is not None,
    }

# THIRD_PARTY_NOTICES

Generated from `tools/license-check.mjs` output (`THIRD_PARTY_NOTICES`,
JSON report) plus hand-listed items the scanners cannot see. Regenerate
the JSON with `node tools/license-check.mjs`, then update this file to
match. Policy: GPL, AGPL, unlicensed and unknown licenses are denied for
anything bundled; LGPL-2.1-or-later is allowed unmodified with notices
shipped (FFmpeg, soxr); OR-choice licenses pass when at least one arm is
permissive; `rkbx_link` is never a dependency; no file, weight or
dataset from the unlicensed 2026 Skip-BART or SeqLight repositories may
enter the tree (spec 112: research inspiration only). Every adapted file
carries a `Provenance:` header naming its source.

## 1. Direct upstream dependencies

| Package | Version | License | Used by |
| --- | --- | --- | --- |
| govee-toolkit (npm `govee-toolkit`, Damien Thery) | 0.5.0 (pinned ceef296f6382881c5f07698d78fb5719ebca6686, see `vendor/govee-toolkit/PIN.md`) | MIT | `@autolight/govee` optional dependency; LAN codec, profiles, stream seam |
| serato-connect (chrisle/serato-connect) | 1.4.6 | MIT | `@autolight/serato` live transport |
| rekordbox-connect (chrisle/rekordbox-connect) | 1.2.17 | MIT | `@autolight/rekordbox-library` install discovery and SQLCipher key route (optional runtime dependency) |
| pyrekordbox (dylanljones/pyrekordbox) | 0.4.4 | MIT | analysis: ANLZ and library reads |
| all-in-one-infer (openmirlab/all-in-one-infer) | 3.1.0 | MIT | analysis: structure inference (optional) |
| beat-this (CPJKU/beat_this) | 1.1.0 | MIT | analysis: beat cross-check (optional) |
| Electron | 41.10.6 | MIT | desktop shell |

## 2. Adapted sources (logic ported; headers in tree)

| Source | License | Files adapted |
| --- | --- | --- |
| govee-toolkit (Damien Thery, v0.5.0) | MIT | `packages/govee/src/*`, `apps/desktop/electron/govee-lan.ts`, `packages/simulator/src/govee-lan.ts` |
| wez/govee2mqtt `src/lan_api.rs` (discovery ladder, reply handling, `ptReal` scenes) | MIT | `apps/desktop/electron/govee-lan.ts`, `packages/govee/src/scenes.ts` |
| lasswellt/govee-homeassistant (copyright Florian Lagg) transport health and BLE protocol reference | MIT | `packages/ble/src/*`, BLE health and rescan notes |
| runtalan/lightwave discovery and release-gate discipline (discovery only; no BLE control) | MIT | LAN retry, conflict and identity notes |

## 3. Study only (never copied, never linked)

Deep Symmetry dysentery PRO DJ LINK analysis, grufkork/rkbx_link
(GPL-3.0, separate-process sidecar only), fjel/rkbx_os2l (no license file,
all rights reserved), Skip-BART and SeqLight (no license file, spec 112).
`packages/rekordbox-live/src/prolink.ts` re-derives packet layouts from the
published protocol documentation.

## 4. Hand-listed runtimes and binaries

FFmpeg (LGPL-2.1-or-later, unmodified binary), uv (MIT OR Apache-2.0),
Python 3.12 (PSF-2.0), Node.js 22 (MIT, Electron bundles its own).
all-in-one-infer and beat-this weights are UNLICENSED until the owner
decides (OD-09) and are not bundled.

## 5. Python environment licenses (`THIRD_PARTY_NOTICES`, 84 rows)

The 84 rows of the JSON report, grouped by the normalized license string:

Apache Software License; BSD License (1): python-dateutil 2.9.0.post0.
Apache-2.0 AND Apache-2.0 WITH LLVM-exception AND BSD-2-Clause AND
BSD-3-Clause AND BSL-1.0 AND MIT (1): torch 2.14.0.
Apache-2.0 OR BSD-2-Clause (1): packaging 26.3.
Apache-2.0 (5): coverage 7.16.2, hf-xet 1.6.0, huggingface_hub 2.0.0, msgpack
1.2.3, requests 2.34.2.
BSD-2-Clause AND Apache-2.0 WITH LLVM-exception (1): llvmlite 0.49.0.
BSD-2-Clause (2): Pygments 2.21.0, decorator 5.3.1.
BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 (1): numpy 2.5.3.
BSD-3-Clause (29): Jinja2 3.1.6, MarkupSafe 3.0.3, antlr4-python3-runtime
4.9.3, click 8.5.0, cloudpickle 3.1.2, contourpy 1.4.0, cycler 0.12.1, fsspec
2026.9.0, httpcore2 2.13.1, httpx2 2.13.1, idna 3.20, joblib 1.6.0,
kiwisolver 1.5.1, lazy-loader 0.6, madmom-infer 0.2.0, mpmath 1.3.0, networkx
3.7, nodeenv 1.11.0, numba 0.67.0, omegaconf 2.3.1, pooch 1.9.0, psutil
7.2.2, pycparser 3.0, scikit-learn 1.9.1, scipy 1.18.1, soundfile 0.14.0,
sympy 1.14.0, threadpoolctl 3.7.0, torchaudio 2.11.0.
ISC (1): librosa 1.0.0.
LGPL-2.1-or-later (1): soxr 1.1.0.
LicenseRef-FirstParty-Proprietary (1): autolight-analysis 0.1.0.
MIT (32): PyYAML 6.0.3, SQLAlchemy 2.1.1, all-in-one-infer 3.1.0,
annotated-types 0.8.0, anyio 4.15.1, beat-this 1.1.0, charset-normalizer
3.5.1, construct 2.10.70, demucs-infer 4.2.2, einops 0.8.2, filelock 4.0.6,
fonttools 4.66.1, h11 0.16.0, hydra-core 1.3.7, iniconfig 2.3.0, julius
0.2.8, narwhals 2.26.0, platformdirs 4.12.2, pluggy 1.6.0, pydantic 2.13.5,
pydantic_core 2.46.5, pyparsing 3.3.3, pyrekordbox 0.4.4, pyright 1.1.414,
pytest 9.1.1, pytest-cov 7.1.0, rotary-embedding-torch 0.9.1, ruff 0.16.9,
six 1.17.0, truststore 0.10.4, typing-inspection 0.4.4, urllib3 2.8.0.
MIT-0 (1): cffi 2.1.1.
MIT-CMU (1): pillow 12.3.0.
MPL-2.0 AND MIT (1): tqdm 4.70.1.
MPL-2.0 (2): bidict 0.24.1, certifi 2026.7.22.
PSF-2.0 (2): matplotlib 3.11.2, typing_extensions 4.16.0.
Zlib (1): sqlcipher3-wheels 0.5.7.

First-party: autolight-analysis 0.1.0 carries `LicenseRef-FirstParty-Proprietary`:
the workspace package is the repository’s own (analysis/pyproject.toml), not a
redistributed third-party artifact. all-in-one-infer and beat-this weights are
UNLICENSED until the owner decides (OD-09) and are not bundled.

No GPL, AGPL, unlicensed or unknown third-party license is bundled. LGPL-2.1-or
later is allowed unmodified with notices shipped (FFmpeg, soxr) and no derivative
of the library is distributed.

## 6. Yarn workspace inventory (1695 rows)

`tools/license-check.mjs` scans 1695 Yarn packages against the denylist (GPL,
AGPL, unlicensed, unknown denied; OR-choice passes when at least one arm is
permissive — node-forge ships BSD-3-Clause OR GPL-2.0). Every row passes; the
per-package rows live in the JSON report (`THIRD_PARTY_NOTICES`).

# T-ANA-03: Canonical decode

Closes F-ANA-08; probe P-15-canonical-decode.

## What changed

- `analysis/src/autolight_analysis/decode.py`: one pipeline for every source,
  `-f f32le -ar 44100 -ac 2` with an `aresample` filter whose engine comes
  from `analysis.decode.resampler` (this FFmpeg build rejects the named and
  numeric `:resampler=` forms for f32le output, so plain `aresample=44100`
  is used and the configured preference documented); `canonical_pcm` writes a
  raw float file plus a JSON sidecar (frames, channels, rate, duration,
  decoder, FFmpeg version, measured start offset from ffprobe, cache key);
  cache key is a content hash of the source plus decode settings, never the
  path; `mono_from_canonical` derives the mono stream from the stereo decode;
  `canonical_wav` writes a float WAV from the same decode for ML tools.

## Proof

- `uv run pytest tests/test_decode.py -q`: WAV/FLAC/MP3/AAC of one signal
  decode within 50 ms of each other (codec availability permitting), cache
  key changes on audio edit but is stable across calls, mono equals the
  stereo mean.

## Delete test

Delete the content hash in `decode_key` and the path-key regression makes
`test_cache_key_content_not_path` fail; delete `mono_from_canonical` and the
stereo-mean test fails.

## Seams

- FFmpeg is bundled by T-OPS-05; `_ffmpeg()` resolves it through PATH today.
- ML tools are handed the WAV; All-In-One session handling is T-ANA-05.

# AutoLight

Automated DJ lighting engine (Rekordbox + Serato → Govee RGBIC).

## Quickstart

Prereqs: Node 22, Yarn 4.9.2, uv, Python 3.12+, FFmpeg.

```sh
yarn install
yarn build
yarn test
(cd analysis && uv sync && uv run pytest)
```

Specs: `docs/SPEC.MD`. Architecture: `docs/architecture.md`.

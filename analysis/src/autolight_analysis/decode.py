"""Canonical decode: 44.1kHz float PCM via FFmpeg (§15). Original untouched."""


def ffmpeg_args(src: str, dst: str) -> list[str]:
    return ["ffmpeg", "-y", "-i", src, "-ar", "44100", "-f", "f32le", "-ac", "2", dst]

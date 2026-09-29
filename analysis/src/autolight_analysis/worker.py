"""Framed-JSON stdio worker (§14). Large artifacts via cache files, never IPC blobs."""
import json
import sys


def handle(msg: dict) -> dict:
    if msg.get("type") == "analyze":
        return {"type": "accepted", "trackId": msg.get("trackId")}
    if msg.get("type") == "ping":
        return {"type": "pong"}
    return {"type": "error", "error": f"unknown type {msg.get('type')!r}"}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        print(json.dumps(handle(json.loads(line))), flush=True)


if __name__ == "__main__":
    main()

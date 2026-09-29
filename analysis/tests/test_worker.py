from autolight_analysis.worker import handle


def test_ping():
    assert handle({"type": "ping"}) == {"type": "pong"}


def test_unknown():
    assert handle({"type": "nope"})["type"] == "error"

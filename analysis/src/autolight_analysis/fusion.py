"""Native/ML fusion with provenance (§19)."""


def fuse(label: str, evidence: list[str], confidence: float) -> dict:
    return {"type": label, "evidence": evidence, "confidence": confidence}

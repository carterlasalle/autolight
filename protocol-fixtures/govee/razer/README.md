# Razer fixtures (T-GOV-02)

Generated from the verified native codec by the T-GOV-14 agent after hand-checking the pinned arm vector `bb 00 01 b1 01 0a` (xor over all preceding bytes including BB). Each JSON row carries the byte-exact hex plus base64 envelope payload. The govee tests load every fixture, assert all vectors re-encode byte-exact, and run a decode(encode(x)) property round trip with checksum validation.

# Security Policy

## Supported versions

AutoLight is pre-release software. Security fixes target the latest `main`; no older release lines are maintained yet.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| older   | :x:                |

When releases are cut, this table will list the supported release lines.

## Reporting a vulnerability

**Do not open a public issue for a suspected vulnerability.**

Email **carterlasalle@gmail.com** with:

- what you found and where (file, commit, or release tag);
- steps to reproduce or a minimal proof of concept;
- the impact as you understand it (what an attacker could do with it);
- your contact details for follow-up.

Expect an acknowledgement within 72 hours. Fixes land as soon as a correct patch is verified; you will be credited unless you ask not to be.

## Scope and trust boundaries

The boundaries that matter most in this repository:

- **Rekordbox library access is read-only.** Any write path to the DJ library is a defect — report it.
- **Govee LAN control is unauthenticated by design** (vendor protocol). Bind only necessary local interfaces; never expose a control listener to a WAN or bridge commands externally.
- **No music upload.** Analysis runs locally; the app must never exfiltrate track files or library data.
- **Secrets** (Govee API keys, Wi-Fi credentials) live in OS-protected storage / `safeStorage`, never in Git, logs, fixtures, or HAR artifacts.
- **Renderer isolation.** The Electron renderer gets no direct Node filesystem/network privileges; all privileged work goes through the narrow typed IPC surface (`apps/desktop/electron/ipc.ts`).
- **Hollow-core rule.** Critical show paths must run through the real implementation — placeholders behind a working UI are treated as defects, not missing features.

## Safe disclosure

- Do not publish exploit details before a fix is available.
- Do not include real credentials, tokens, session cookies, or user library data in reports.
- Sanitize HAR files, protocol captures, and logs before sharing; keep sensitive artifacts local and git-ignored.
- Revoke any credential you believe is exposed, then report.

## What happens next

Valid reports are fixed on `main` with a regression test, and the fix is described in the release notes. Out-of-scope reports (unsupported versions, third-party vendor firmware behavior) still get a response explaining why and what, if anything, changes.

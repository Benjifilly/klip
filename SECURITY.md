# Security Policy

Klip's security model (what is encrypted, what the relay can and cannot see,
and the threat model) is documented in the [README](README.md#security-model).

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

- Preferred: use GitHub's private vulnerability reporting —
  **Security → Report a vulnerability** on this repository.
- You should receive an acknowledgement within a few days. Please give us a
  reasonable window to ship a fix before any public disclosure.

There is no bug bounty — this is a free, open-source project — but reports are
credited in the release notes unless you prefer otherwise.

## Scope

In scope:

- The E2EE design and its implementation (`client/electron/crypto.cjs`):
  key derivation, encryption, authentication, fingerprints.
- The relay (`server/src/`): anything that lets a client read another room's
  traffic, crash the server, or exhaust its memory past the documented limits.
- The desktop client (`client/`): sandbox escapes, IPC abuse, file
  exfiltration, clipboard handling of sensitive data.

Out of scope:

- Anyone who knows your session code can join your session — that is by
  design; codes must be treated like passwords.
- Denial of service against *your own* self-hosted relay with settings you
  loosened yourself.
- Vulnerabilities in dependencies that are already published (please report
  upstream), unless Klip uses the dependency in an unsafe way.

## Supported versions

Only the latest release is supported. The desktop app checks GitHub releases
for updates (electron-updater); self-hosted relays should track `main`.

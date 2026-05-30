# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries marked **BREAKING** require action when upgrading — read them before
deploying an update to a configured machine.

## [Unreleased]

### Changed

- **BREAKING — log directory consolidation** ([#16]). All suite processes
  (launcher, gateway, hal_reader, hal_watchdog) now log to a single directory,
  `<install-dir>/runlogs`, derived from the install location (the same dir
  `restart.sh` already used). Previously logs split between
  `~/linuxcnc/lcnc-suite/logs/` and `runlogs/` depending on the process.
  - The log-directory overrides were **renamed** (no backward-compatible
    aliases): env `LCNC_WEBUI_LOG_DIR` → `LCNC_LOG_DIR`, INI
    `[DISPLAY] WEBUI_LOG_DIR` → `[DISPLAY] LOG_DIR`. **If your config sets the
    old names, rename them** — the old names are now ignored and logs fall back
    to the default location.
  - Both overrides remain optional; unset means `<install-dir>/runlogs`.
  - **Action:** none required for a default install. Logs move from
    `~/linuxcnc/lcnc-suite/logs/` to `<install-dir>/runlogs/`; old logs are left
    in place (no automatic migration) and can be deleted manually.

### Removed

- The silent `/tmp/lcnc-suite/` fallback. An unwritable log directory is now a
  hard, loud failure: the `lcnc-suite` launcher write-tests the resolved
  directory and aborts at startup (before any process runs) rather than silently
  redirecting logs to `/tmp`. The previous free-disk < 500 MB fallback trigger
  was also removed (log size is already bounded by rotation to ~275 MB).

### Fixed

- Forensic safety-trip bundles, the timing log, and the watchdog heartbeat probe
  no longer silently scatter to `/tmp` when the trace log directory is
  unavailable — they surface a loud error event instead, so a lost forensic
  record can't go unnoticed.

[Unreleased]: https://github.com/bildobodo/lcnc-suite/compare/main...development
[#16]: https://github.com/bildobodo/lcnc-suite/issues/16

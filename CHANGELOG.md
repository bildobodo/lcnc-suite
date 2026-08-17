# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries marked **BREAKING** require action when upgrading — read them before
deploying an update to a configured machine.

## [Unreleased]

### Security

- **BREAKING — `WEBUI_TOKEN` required for LAN-bound installs** ([#17]). Any
  install with `WEBUI_HOST` set to a non-loopback address (e.g. `0.0.0.0`)
  must now set `WEBUI_TOKEN` in the INI `[DISPLAY]` section or via the
  `LCNC_WEBUI_TOKEN` env var. The launcher refuses to start without it
  ("Refusing to start an unauthenticated machine-control surface").
  - **Action:** generate a token
    (`python3 -c "import secrets; print(secrets.token_urlsafe(32))"`) and add
    `WEBUI_TOKEN = <token>` to the `[DISPLAY]` section of your machine INI.
  - Loopback-only installs (`WEBUI_HOST=127.0.0.1`) are unaffected.
  - The token is auto-injected into pages the gateway serves, so browsers
    pointed at the gateway keep working without manual entry; it gates the
    WebSocket and REST mutation routes against cross-origin/unauthenticated
    access on the LAN.

### Changed

- **BREAKING — heartbeat trip latch moved into the HAL servo thread** ([#34]).
  The `webui-safety.trip-latch` pin **no longer exists**: `hal_watchdog.py`'s
  100 ms Python edge detector could lose the race against the ~1 ms oneshot
  re-arm and silently auto-recover from ESTOP. The sticky latch is now a
  servo-thread `estop_latch` component named `webui-hb-latch`, which latches in
  the same servo cycle the oneshot expires and survives gateway *and* watchdog
  freezes. The safety HAL also gained `loadusr -Wn webui-reader hal_reader.py`
  (all gateway HAL reads go through it; the gateway never imports `hal`).
  - **Action:** if your HAL was written from the old README snippet (it netted
    `webui-safety.trip-latch => and2.2.in1`), LinuxCNC will fail to load with
    "Pin 'webui-safety.trip-latch' does not exist". Re-copy
    `examples/sim_config/hallib/lcnc_webui.hal` (or apply its `estop_latch`
    block: `loadrt estop_latch names=webui-hb-latch`, `ok-in` from
    `oneshot.0.out`, `ok-out` into the chain, `reset` from
    `webui-safety.trip-reset-out`). The gateway now banners a missing latch
    at runtime (`safety_chain_incomplete`).

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
[#17]: https://github.com/bildobodo/lcnc-suite/issues/17
[#34]: https://github.com/bildobodo/lcnc-suite/issues/34

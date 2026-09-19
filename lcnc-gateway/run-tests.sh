#!/usr/bin/env bash
# Run the off-machine backend unit tests (issue #26).
#
# Uses the gateway venv so fastapi/msgspec (real deps) are importable; the fake
# linuxcnc (fake_linuxcnc.install(), invoked at the top of test_command_dispatch
# and via conftest.py) lets gateway.py import without the real binding, so the
# command dispatch / policy / validation run deterministically off-machine.
#
# Excludes test_viewer_init.py — that's a subprocess integration test that
# launches a real gateway and is run separately.
set -euo pipefail
cd "$(dirname "$0")"

PY=.venv/bin/python3
[ -x "$PY" ] || PY=python3

# pyproject.toml owns discovery and the on-machine exclusion. A hand-written
# list silently omitted new test files (including most TWP regression tests).
exec "$PY" -m pytest "$@"

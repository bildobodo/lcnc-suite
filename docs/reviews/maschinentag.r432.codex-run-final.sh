#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r432/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r432/head
"$py" -m pytest -v scripts/test_r432_codex.py > /tmp/r432/native-probes-final.txt 2>&1
printf 'R432 final probes exit: %s\n' "$?"
"$py" -m pytest -v scripts/test_native_stage.py -k 'the_window_is_the_gateways_stream or a_window_rotated_within or a_window_is_framed_only or a_slow_confirmed_read_back' > /tmp/r432/frame-guards.txt 2>&1
printf 'frame guards exit: %s\n' "$?"

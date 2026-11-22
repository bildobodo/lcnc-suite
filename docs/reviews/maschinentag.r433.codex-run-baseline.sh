#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r433/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r433/head
"$py" -m pytest -v scripts/test_native_stage.py -k 'parse_basis or parse_nice or pb_owed or quiet_wait or r430 or r431 or r432 or the_window_is_the_gateways_stream or a_window_rotated_within or a_window_is_framed_only or a_slow_confirmed_read_back' > /tmp/r433/native-baseline.txt 2>&1
printf 'native baseline exit: %s\n' "$?"
"$py" -m pytest -v scripts/test_r431_codex.py scripts/test_r432_codex.py > /tmp/r433/prior-unchanged.txt 2>&1
printf 'unchanged prior probes exit: %s\n' "$?"

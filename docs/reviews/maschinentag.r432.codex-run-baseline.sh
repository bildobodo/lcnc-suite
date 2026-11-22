#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r432/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r432/head
"$py" -m pytest -v scripts/test_native_stage.py -k 'parse_basis or parse_nice or pb_owed or quiet_wait or r431' > /tmp/r432/native-baseline.txt 2>&1
printf 'native baseline exit: %s\n' "$?"
"$py" -m pytest -v scripts/test_r431_codex.py > /tmp/r432/r431-unchanged.txt 2>&1
printf 'unchanged R431 exit: %s\n' "$?"

#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r432/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r432/head
"$py" -m pytest -v scripts/test_r432_codex.py > /tmp/r432/native-probes-final.txt 2>&1
printf 'R432 final probes exit: %s\n' "$?"

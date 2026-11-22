#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r431/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r431/head
"$py" -m pytest -v scripts/test_r431_codex.py > /tmp/r431/native-probes.txt 2>&1
r=$?
printf 'native probes: %s\n' "$r"
"$py" /tmp/r431/native-reeval.py > /tmp/r431/native-reeval.json
r=$?
printf 'stored run: %s\n' "$r"

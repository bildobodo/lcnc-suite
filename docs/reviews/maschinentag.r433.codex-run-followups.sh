#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r433/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r433/head
"$py" -m pytest -v scripts/test_r433_codex.py > /tmp/r433/native-probes.txt 2>&1
printf 'new probes exit: %s\n' "$?"
"$py" /tmp/r433/native-reeval.py > /tmp/r433/native-reeval.json
printf 'saved native run exit: %s\n' "$?"

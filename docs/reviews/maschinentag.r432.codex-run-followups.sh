#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r432/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r432/head
"$py" -m pytest -v scripts/test_native_stage.py -k 'r430 or frame_window' > /tmp/r432/native-related.txt 2>&1
printf 'related native guards exit: %s\n' "$?"
"$py" -m pytest -v scripts/test_r432_codex.py > /tmp/r432/native-probes.txt 2>&1
printf 'R432 probes exit: %s\n' "$?"
"$py" /tmp/r432/native-reeval.py > /tmp/r432/native-reeval.json
printf 'saved run re-evaluation exit: %s\n' "$?"

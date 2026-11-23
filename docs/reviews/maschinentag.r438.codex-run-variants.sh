#!/bin/bash
set -u
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r438/logs
py=/home/cnc/lcnc-suite-p4ui/lcnc-gateway/.venv/bin/python
cd /tmp/r438/head/lcnc-gateway
"$py" /tmp/r438/error-variants.py > /tmp/r438/error-variants.json
printf 'error variants exit=%s\n' "$?"
"$py" -m pytest -p no:cacheprovider -o addopts='--ignore=test_viewer_init.py' -v test_r438_codex_deadlines.py > /tmp/r438/reset-boundaries.txt 2>&1
printf 'deadline variants exit=%s\n' "$?"

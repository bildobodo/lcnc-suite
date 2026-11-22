#!/bin/bash
set -eu
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r431/logs
py=/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python
cd /tmp/r431/head/lcnc-gateway
"$py" -m pytest -o addopts='--ignore=test_viewer_init.py' -q test_toolsetter_basis.py test_bulk_pipeline.py > /tmp/r431/backend-baseline.txt 2>&1
cd /tmp/r431/head
"$py" -m pytest -q scripts/test_native_stage.py -k 'parse_basis or parse_nice or pb_owed or pb_quiet' > /tmp/r431/native-baseline.txt 2>&1

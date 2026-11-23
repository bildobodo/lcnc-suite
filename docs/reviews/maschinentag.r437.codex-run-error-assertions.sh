#!/bin/bash
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r437/logs
cd /tmp/r437/head/lcnc-gateway
/home/cnc/lcnc-suite-p4ui/lcnc-gateway/.venv/bin/python -m pytest -p no:cacheprovider -o addopts='--ignore=test_viewer_init.py' -v test_r437_codex_error_line.py > /tmp/r437/error-assertions.txt 2>&1

#!/bin/bash
set -eu
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r435/logs
/home/cnc/lcnc-suite-p2a/lcnc-gateway/.venv/bin/python /tmp/r435/native-reeval.py > /tmp/r435/native-reeval.json

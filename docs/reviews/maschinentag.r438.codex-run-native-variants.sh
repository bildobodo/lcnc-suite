#!/bin/bash
export PYTHONDONTWRITEBYTECODE=1 LCNC_LOG_DIR=/tmp/r438/logs
/home/cnc/lcnc-suite-p4ui/lcnc-gateway/.venv/bin/python /tmp/r438/error-variants.py > /tmp/r438/error-variants.json 2> /tmp/r438/error-variants-driver.stderr.txt

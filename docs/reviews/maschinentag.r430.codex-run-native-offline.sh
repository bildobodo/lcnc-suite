#!/bin/bash
set -eu
export PYTHONDONTWRITEBYTECODE=1
py=/home/cnc/lcnc-suite-p1b/lcnc-gateway/.venv/bin/python
"$py" /tmp/r430/native-probe.py > /tmp/r430/native-probe.json
"$py" /tmp/r430/native-reeval.py > /tmp/r430/native-reeval.json
cd /tmp/r430/p2a
"$py" -m pytest -q scripts/test_native_stage.py::test_parse_nice_needs_a_traced_drift_parse > /tmp/r430/p2a-native-nice.txt 2>&1

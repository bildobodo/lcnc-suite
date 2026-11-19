#!/bin/bash
set -eu
cd /tmp/codex-r404-replay
PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest scripts/inventory/test_coverage.py scripts/test_select/test_replay.py -q -p no:cacheprovider > /tmp/r404-pytest.txt 2>&1
python3 -B /tmp/r404-class-probe.py > /tmp/r404-class-probe.txt
python3 -B /tmp/r404-result-probe.py > /tmp/r404-result-probe.txt
python3 -B /tmp/r404-reference-probe.py > /tmp/r404-reference-probe.txt

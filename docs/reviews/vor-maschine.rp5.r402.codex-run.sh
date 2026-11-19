#!/bin/bash
set -eu
cd /tmp/codex-r402-replay
PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest scripts/inventory/test_coverage.py scripts/test_select/test_replay.py -q -p no:cacheprovider > /tmp/r402-pytest.txt 2>&1
python3 -B /tmp/r401-probes.py --root /tmp/codex-r402-replay --gate /tmp/r401-input/gate-merge.json --out /tmp/r402-probes.json > /tmp/r402-probes.txt
python3 -B /tmp/r402-result-probe.py > /tmp/r402-result-probe.txt
python3 -B /tmp/r402-class-probe.py > /tmp/r402-class-probe.txt

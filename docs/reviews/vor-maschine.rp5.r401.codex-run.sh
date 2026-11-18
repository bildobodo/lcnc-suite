#!/bin/bash
set -eu
cd /tmp/codex-r401-replay
PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest scripts/inventory/test_coverage.py scripts/test_select/test_replay.py -q -p no:cacheprovider > /tmp/r401-pytest.txt 2>&1
python3 -B /tmp/r401-probes.py --root /tmp/codex-r401-replay --gate /tmp/r401-input/gate-merge.json --out /tmp/r401-probes.json > /tmp/r401-probes.txt
python3 -B /tmp/r401-duplicate-probe.py > /tmp/r401-duplicate-probe.txt

#!/bin/bash
set -eu
cd /tmp/codex-r398-Ts0ULELL
PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest scripts/inventory/test_coverage.py scripts/test_select/test_replay.py -q -p no:cacheprovider > /tmp/r398-pytest.txt 2>&1
cd lcnc-webui
npx vitest list --config r398.config.ts --json=/tmp/r398-vitest-list.json > /tmp/r398-vitest-list.txt 2>&1
npx vitest run --config r398.config.ts --reporter=json --outputFile=/tmp/r398-vitest-report.json > /tmp/r398-vitest-console.txt 2>&1

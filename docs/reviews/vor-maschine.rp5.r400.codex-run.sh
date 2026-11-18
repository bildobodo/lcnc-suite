#!/bin/bash
set -eu
cd /tmp/codex-r400
PYTHONDONTWRITEBYTECODE=1 /home/cnc/lcnc-suite/lcnc-gateway/.venv/bin/python -m pytest scripts/inventory/test_coverage.py scripts/test_select/test_replay.py -q -p no:cacheprovider > /tmp/r400-pytest.txt 2>&1
cd lcnc-webui
npx vitest list src/r398-fixtures src/lcnc.test.ts src/permissions.test.ts --json=/tmp/r400-vitest-list.json > /tmp/r400-vitest-list.txt 2>&1
LCNC_VITEST_OPTIONS_OUT=/tmp/r400-vitest-options.json npx vitest run src/r398-fixtures src/lcnc.test.ts src/permissions.test.ts --maxWorkers=1 --allowOnly=false --retry=0 --reporter=json --reporter=/tmp/codex-r400/scripts/test_select/vitest_options_reporter.mjs --outputFile.json=/tmp/r400-vitest-report.json > /tmp/r400-vitest-console.txt 2>&1

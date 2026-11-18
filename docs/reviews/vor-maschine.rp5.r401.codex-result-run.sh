#!/bin/bash
set -eu
cd /tmp/codex-r401-hold/lcnc-webui
npx vitest list src/r401-duplicate.test.ts --json=/tmp/r401-result-list.json > /tmp/r401-result-list.txt 2>&1
set +e
LCNC_VITEST_OPTIONS_OUT=/tmp/r401-result-options.json npx vitest run src/r401-duplicate.test.ts --maxWorkers=1 --allowOnly=false --retry=0 --reporter=json --reporter=/tmp/codex-r401-replay/scripts/test_select/vitest_options_reporter.mjs --outputFile.json=/tmp/r401-result-report.json > /tmp/r401-result-console.txt 2>&1
rc=$?
set -e
printf '%s\n' "$rc" > /tmp/r401-result-exit.txt
test "$rc" = 1
python3 -B /tmp/r401-result-probe.py > /tmp/r401-result-probe.txt

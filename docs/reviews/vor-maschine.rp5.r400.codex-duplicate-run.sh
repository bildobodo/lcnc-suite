#!/bin/bash
set -eu
cd /tmp/codex-r400/lcnc-webui
npx vitest list src/r398-fixtures/duplicate.test.ts --json=/tmp/r400-duplicate-list.json > /tmp/r400-duplicate-list.txt 2>&1
LCNC_VITEST_OPTIONS_OUT=/tmp/r400-duplicate-options.json npx vitest run src/r398-fixtures/duplicate.test.ts --maxWorkers=1 --allowOnly=false --retry=0 --reporter=json --reporter=/tmp/codex-r400/scripts/test_select/vitest_options_reporter.mjs --outputFile.json=/tmp/r400-duplicate-report.json > /tmp/r400-duplicate-console.txt 2>&1

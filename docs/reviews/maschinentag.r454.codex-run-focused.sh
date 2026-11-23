#!/bin/bash
set +e
cd /tmp/r454/tree/lcnc-gateway
/home/cnc/lcnc-suite-p2bf/lcnc-gateway/.venv/bin/python -B -m pytest -p no:cacheprovider -o addopts= -q test_program_identity.py test_preview_wait.py test_calc_lifetime_gateway.py test_bulk_pipeline.py test_codex_r452.py > /tmp/r454/backend.txt 2>&1
printf 'backend exit=%s\n' "$?"
cd /tmp/r454/tree/lcnc-webui
node node_modules/vitest/vitest.mjs run src/ws/bulkData.test.ts src/previewWait.test.ts src/viewer/checkBasis.test.ts src/ws/codexR452.test.ts src/previewWorker.codexR452.test.ts > /tmp/r454/frontend.txt 2>&1
printf 'frontend exit=%s\n' "$?"
node node_modules/vite/bin/vite.js build > /tmp/r454/build.txt 2>&1
build_rc=$?
printf 'build exit=%s\n' "$build_rc"
if [ "$build_rc" -ne 0 ]; then exit "$build_rc"; fi
CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r454-focused LCNC_E2E_SELECTION=/tmp/r454/selection.json npm exec -- playwright test -c playwright.select.config.ts --reporter=json > /tmp/r454/browser.json 2> /tmp/r454/browser-console.txt
printf 'browser exit=%s\n' "$?"

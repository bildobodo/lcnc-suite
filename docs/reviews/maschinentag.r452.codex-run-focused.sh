#!/bin/bash
set +e
cd /tmp/r452/tree/lcnc-gateway
/home/cnc/lcnc-suite-p2bf/lcnc-gateway/.venv/bin/python -B -m pytest -p no:cacheprovider -o addopts= -q test_program_identity.py test_preview_wait.py test_calc_lifetime_gateway.py test_bulk_pipeline.py > /tmp/r452/backend-existing.txt 2>&1
printf 'existing backend exit=%s\n' "$?"
/home/cnc/lcnc-suite-p2bf/lcnc-gateway/.venv/bin/python -B -m pytest -p no:cacheprovider -o addopts= -q test_codex_r452.py > /tmp/r452/backend-probe.txt 2>&1
printf 'backend probe exit=%s\n' "$?"
cd /tmp/r452/tree/lcnc-webui
node node_modules/vitest/vitest.mjs run src/ws/bulkData.test.ts src/previewWait.test.ts src/viewer/checkBasis.test.ts src/ws/codexR452.test.ts > /tmp/r452/frontend-focused.txt 2>&1
printf 'frontend exit=%s\n' "$?"
node node_modules/vite/bin/vite.js build > /tmp/r452/build.txt 2>&1
printf 'build exit=%s\n' "$?"

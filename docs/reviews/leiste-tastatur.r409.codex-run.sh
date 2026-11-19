#!/bin/bash
set -eu
cd /tmp/codex-r409/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r409 LCNC_E2E_EVENTS=/tmp/r409-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r409-replay LCNC_E2E_HTTP_DIR=/tmp/r409-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r409-browser.json
npx playwright test e2e/strip-fit.spec.ts --grep '3axis-xyz @ touch-fullhd — no overflow|error note' --workers=1 --reporter=line,json > /tmp/r409-browser.txt 2>&1
export LCNC_E2E_RUN=codex-r409-probe LCNC_E2E_EVENTS=/tmp/r409-probe-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r409-probe-replay LCNC_E2E_HTTP_DIR=/tmp/r409-probe-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r409-probe.json
npx playwright test e2e/r409-codex.spec.ts --grep '3axis-xyz @ touch-fullhd — no overflow|the unbroken 372 error note over a loaded tool|approved wrapped type' --workers=1 --reporter=line,json > /tmp/r409-probe.txt 2>&1
python3 /tmp/r409-mutant.py

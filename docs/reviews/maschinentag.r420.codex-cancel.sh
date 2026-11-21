#!/bin/bash
set -eu
cd /tmp/codex-r420/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r420-cancel LCNC_E2E_EVENTS=/tmp/r420/cancel-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r420/cancel-replay LCNC_E2E_HTTP_DIR=/tmp/r420/cancel-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r420/cancel.json
npx playwright test e2e/r420-cancel.spec.ts --workers=1 --reporter=line,json > /tmp/r420/cancel.txt 2>&1

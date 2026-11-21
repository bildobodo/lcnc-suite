#!/bin/bash
set -eu
cd /tmp/codex-r420-base/lcnc-webui
npm run build > /tmp/r420/base-build.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r420-base LCNC_E2E_EVENTS=/tmp/r420/base-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r420/base-replay LCNC_E2E_HTTP_DIR=/tmp/r420/base-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r420/base.json
npx playwright test e2e/r420-base.spec.ts --workers=1 --reporter=line,json > /tmp/r420/base.txt 2>&1

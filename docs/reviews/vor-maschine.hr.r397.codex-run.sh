#!/bin/bash
set -eu
cd /tmp/codex-r397-iR7ap2oV/lcnc-webui
npm run build > /tmp/r397-build.txt 2>&1
export LCNC_E2E_SELECTION=/tmp/r397-selection.json LCNC_E2E_RUN=codex-r397 LCNC_E2E_EVENTS=/tmp/r397-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r397-replay LCNC_E2E_HTTP_DIR=/tmp/r397-http LCNC_E2E_WORKERS=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r397-browser.json
npx playwright test -c playwright.select.config.ts --reporter=line,json > /tmp/r397-console.txt 2>&1

#!/bin/bash
set -eu
cd /tmp/codex-r397-iR7ap2oV/lcnc-webui
export LCNC_E2E_SELECTION=/tmp/r397-deadline-selection.json LCNC_E2E_RUN=codex-r397-deadline LCNC_E2E_EVENTS=/tmp/r397-deadline-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r397-deadline-replay LCNC_E2E_HTTP_DIR=/tmp/r397-deadline-http LCNC_E2E_WORKERS=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r397-deadline-browser.json
npx playwright test -c playwright.select.config.ts --reporter=line,json > /tmp/r397-deadline-console.txt 2>&1

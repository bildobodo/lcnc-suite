#!/bin/bash
set -eu
cd /tmp/codex-r402-hold/lcnc-webui
npx vitest run src/holdGesture.test.ts src/realTimeHolds.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/r402-hold-unit.json > /tmp/r402-hold-unit.txt 2>&1
npm run build > /tmp/r402-build.txt 2>&1
export LCNC_E2E_SELECTION=/tmp/r402-selection.json LCNC_E2E_RUN=codex-r402-chromium LCNC_E2E_EVENTS=/tmp/r402-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r402-replay LCNC_E2E_HTTP_DIR=/tmp/r402-http LCNC_E2E_WORKERS=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r402-browser.json
npx playwright test -c playwright.select.config.ts --grep 'no real tap|a hold across|mouse:|the macro bar is dense' --reporter=line,json > /tmp/r402-browser-console.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r402-firefox LCNC_E2E_EVENTS=/tmp/r402-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r402-ff-replay LCNC_E2E_HTTP_DIR=/tmp/r402-ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r402-firefox.json
npx playwright test -c playwright.firefox.config.ts hold-stall-mouse --reporter=line,json > /tmp/r402-firefox-console.txt 2>&1

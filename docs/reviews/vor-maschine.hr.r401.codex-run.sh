#!/bin/bash
set -eu
cd /tmp/codex-r401-hold/lcnc-webui
npx vitest run src/holdGesture.test.ts src/realTimeHolds.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/r401-hold-unit.json > /tmp/r401-hold-unit.txt 2>&1
npm run build > /tmp/r401-build.txt 2>&1
export LCNC_E2E_SELECTION=/tmp/r401-selection.json LCNC_E2E_RUN=codex-r401-chromium LCNC_E2E_EVENTS=/tmp/r401-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r401-replay LCNC_E2E_HTTP_DIR=/tmp/r401-http LCNC_E2E_WORKERS=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r401-browser.json
npx playwright test -c playwright.select.config.ts --reporter=line,json > /tmp/r401-browser-console.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r401-firefox LCNC_E2E_EVENTS=/tmp/r401-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r401-ff-replay LCNC_E2E_HTTP_DIR=/tmp/r401-ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r401-firefox.json
npx playwright test -c playwright.firefox.config.ts hold-stall-mouse --reporter=line,json > /tmp/r401-firefox-console.txt 2>&1

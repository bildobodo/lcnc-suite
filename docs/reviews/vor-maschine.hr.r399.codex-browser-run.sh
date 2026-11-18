#!/bin/bash
set -eu
cd /tmp/codex-r399/hold/lcnc-webui
npx vitest run src/holdGesture.test.ts --maxWorkers=1 --reporter=json --outputFile=/tmp/r399-hold-unit.json > /tmp/r399-hold-unit.txt 2>&1
npm run build > /tmp/r399-build.txt 2>&1
export LCNC_E2E_SELECTION=/tmp/r399-selection.json LCNC_E2E_RUN=codex-r399 LCNC_E2E_EVENTS=/tmp/r399-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r399-replay LCNC_E2E_HTTP_DIR=/tmp/r399-http LCNC_E2E_WORKERS=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r399-browser.json
npx playwright test -c playwright.select.config.ts --reporter=line,json > /tmp/r399-browser-console.txt 2>&1

#!/bin/bash
set -eu
cd /tmp/codex-r401-hold/lcnc-webui
export LCNC_E2E_SELECTION=/tmp/r401-hint-selection.json LCNC_E2E_RUN=codex-r401-hint LCNC_E2E_EVENTS=/tmp/r401-hint-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r401-hint-replay LCNC_E2E_HTTP_DIR=/tmp/r401-hint-http LCNC_E2E_WORKERS=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r401-hint.json
npx playwright test -c playwright.select.config.ts --reporter=line,json > /tmp/r401-hint-console.txt 2>&1

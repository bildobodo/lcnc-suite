#!/bin/bash
set -eu
cd /tmp/codex-r410/lcnc-webui
npm run build > /tmp/r410-build.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r410 LCNC_E2E_EVENTS=/tmp/r410-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r410-replay LCNC_E2E_HTTP_DIR=/tmp/r410-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r410-browser.json
npx playwright test e2e/strip-fit.spec.ts e2e/r410-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r410-browser.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r410-ff LCNC_E2E_EVENTS=/tmp/r410-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r410-ff-replay LCNC_E2E_HTTP_DIR=/tmp/r410-ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r410-ff.json
npx playwright test -c playwright.firefox.config.ts e2e/strip-fit.spec.ts --workers=1 --reporter=line,json > /tmp/r410-ff.txt 2>&1

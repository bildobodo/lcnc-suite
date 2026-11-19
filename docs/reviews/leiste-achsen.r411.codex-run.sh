#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
npm run build > /tmp/r411/build.txt 2>&1
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r411 LCNC_E2E_EVENTS=/tmp/r411/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r411/replay LCNC_E2E_HTTP_DIR=/tmp/r411/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r411/browser.json
npx playwright test e2e/r411-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r411/browser.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r411-ff LCNC_E2E_EVENTS=/tmp/r411/ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r411/ff-replay LCNC_E2E_HTTP_DIR=/tmp/r411/ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r411/ff.json
npx playwright test -c playwright.r411-ff.config.ts --workers=1 --reporter=line,json > /tmp/r411/ff.txt 2>&1

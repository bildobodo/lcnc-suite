#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r412 LCNC_E2E_EVENTS=/tmp/r412/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r412/replay LCNC_E2E_HTTP_DIR=/tmp/r412/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r412/chromium.json
npx playwright test e2e/r412-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r412/chromium.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r412-ff LCNC_E2E_EVENTS=/tmp/r412/ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r412/ff-replay LCNC_E2E_HTTP_DIR=/tmp/r412/ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r412/firefox.json
npx playwright test -c playwright.r412-ff.config.ts --workers=1 --reporter=line,json > /tmp/r412/firefox.txt 2>&1

#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r416 LCNC_E2E_EVENTS=/tmp/r416/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r416/replay LCNC_E2E_HTTP_DIR=/tmp/r416/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r416/chromium.json SHOT_DIR=/tmp/r416 STAGE_B=b2
npx playwright test e2e/r416-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r416/chromium.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r416-ff LCNC_E2E_EVENTS=/tmp/r416/ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r416/ff-replay LCNC_E2E_HTTP_DIR=/tmp/r416/ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r416/firefox.json
npx playwright test -c playwright.r416-ff.config.ts --workers=1 --reporter=line,json > /tmp/r416/firefox.txt 2>&1

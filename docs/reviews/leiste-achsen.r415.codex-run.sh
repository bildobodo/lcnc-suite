#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r415 LCNC_E2E_EVENTS=/tmp/r415/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r415/replay LCNC_E2E_HTTP_DIR=/tmp/r415/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r415/chromium.json SHOT_DIR=/tmp/r415 STAGE_B=b2
npx playwright test e2e/r415-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r415/chromium.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r415-ff LCNC_E2E_EVENTS=/tmp/r415/ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r415/ff-replay LCNC_E2E_HTTP_DIR=/tmp/r415/ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r415/firefox.json
npx playwright test -c playwright.r415-ff.config.ts --workers=1 --reporter=line,json > /tmp/r415/firefox.txt 2>&1

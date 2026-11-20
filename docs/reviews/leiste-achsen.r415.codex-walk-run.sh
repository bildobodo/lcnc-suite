#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r415-walk LCNC_E2E_EVENTS=/tmp/r415/walk-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r415/walk-replay LCNC_E2E_HTTP_DIR=/tmp/r415/walk-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r415/walk-chromium.json SHOT_DIR=/tmp/r415 STAGE_B=b2
npx playwright test e2e/r415-dialog-walk.spec.ts --workers=1 --reporter=line,json > /tmp/r415/walk-chromium.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r415-walk-ff LCNC_E2E_EVENTS=/tmp/r415/walk-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r415/walk-ff-replay LCNC_E2E_HTTP_DIR=/tmp/r415/walk-ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r415/walk-firefox.json
npx playwright test -c playwright.r415-walk-ff.config.ts --workers=1 --reporter=line,json > /tmp/r415/walk-firefox.txt 2>&1

#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r413-v2 LCNC_E2E_EVENTS=/tmp/r413/v2-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r413/replay LCNC_E2E_HTTP_DIR=/tmp/r413/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r413/chromium.json SHOT_DIR=/tmp/r413 STAGE_B=b2
npx playwright test e2e/r413-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r413/chromium.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r413-ff-v2 LCNC_E2E_EVENTS=/tmp/r413/v2-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r413/ff-replay LCNC_E2E_HTTP_DIR=/tmp/r413/ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r413/firefox.json
npx playwright test -c playwright.r413-ff.config.ts --workers=1 --reporter=line,json > /tmp/r413/firefox.txt 2>&1

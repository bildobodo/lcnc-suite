#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r414 LCNC_E2E_EVENTS=/tmp/r414/events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r414/replay LCNC_E2E_HTTP_DIR=/tmp/r414/http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r414/chromium.json SHOT_DIR=/tmp/r414 STAGE_B=b2
npx playwright test e2e/r414-codex.spec.ts --workers=1 --reporter=line,json > /tmp/r414/chromium.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r414-ff LCNC_E2E_EVENTS=/tmp/r414/ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r414/ff-replay LCNC_E2E_HTTP_DIR=/tmp/r414/ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r414/firefox.json
npx playwright test -c playwright.r414-ff.config.ts --workers=1 --reporter=line,json > /tmp/r414/firefox.txt 2>&1

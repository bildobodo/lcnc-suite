#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r413-mut LCNC_E2E_EVENTS=/tmp/r413/mut-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r413/mut-replay LCNC_E2E_HTTP_DIR=/tmp/r413/mut-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r413/mutation-chromium.json SHOT_DIR=/tmp/r413 STAGE_B=b2
npx playwright test e2e/r413-mutation.spec.ts --workers=1 --reporter=line,json > /tmp/r413/mutation-chromium.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r413-mut-ff LCNC_E2E_EVENTS=/tmp/r413/mut-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r413/mut-ff-replay LCNC_E2E_HTTP_DIR=/tmp/r413/mut-ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r413/mutation-firefox.json
npx playwright test -c playwright.r413-mut-ff.config.ts --workers=1 --reporter=line,json > /tmp/r413/mutation-firefox.txt 2>&1

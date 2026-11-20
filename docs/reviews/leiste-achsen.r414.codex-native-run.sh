#!/bin/bash
set -eu
cd /tmp/codex-r411/lcnc-webui
export CI=1 LCNC_E2E_WORKERS=1 LCNC_E2E_RUN=codex-r414-native-v2 LCNC_E2E_EVENTS=/tmp/r414/native-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r414/native-replay LCNC_E2E_HTTP_DIR=/tmp/r414/native-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r414/native-chromium.json SHOT_DIR=/tmp/r414 STAGE_B=b2
npx playwright test e2e/r414-native-tab.spec.ts --workers=1 --reporter=line,json > /tmp/r414/native-chromium.txt 2>&1
export LCNC_FIREFOX=$(python3 -I ../scripts/fetch_firefox.py path)
export LCNC_E2E_RUN=codex-r414-native-ff-v2 LCNC_E2E_EVENTS=/tmp/r414/native-ff-events.jsonl LCNC_E2E_REPLAY_DIR=/tmp/r414/native-ff-replay LCNC_E2E_HTTP_DIR=/tmp/r414/native-ff-http PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/r414/native-firefox.json
npx playwright test -c playwright.r414-native-ff.config.ts --workers=1 --reporter=line,json > /tmp/r414/native-firefox.txt 2>&1
